package notifications

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"time"
)

var (
	// ErrDeviceSecretMismatch is returned when a device id is already
	// registered under a different secret - the caller isn't the device that
	// created that id, so every write/read through it is refused.
	ErrDeviceSecretMismatch = errors.New("device secret mismatch")
	// ErrDeviceNotRegistered is returned when an endpoint that requires an
	// already-registered iOS device (everything except POST /devices/register)
	// is called with a device id that's never been registered.
	ErrDeviceNotRegistered = errors.New("device not registered")
)

// apnsTokenPattern matches a raw APNs device token, hex-encoded. Apple
// documents the token as variable-length: physical devices currently send
// 32 bytes, but the iOS simulator sends 80 - the old exact-64-character check
// rejected those outright ("invalid apns token"), so this accepts any
// even-length hex string from 32 to 200 bytes.
var apnsTokenPattern = regexp.MustCompile(`^(?:[0-9a-fA-F]{2}){32,200}$`)

func validDeviceID(id string) bool {
	return len(id) >= 8 && len(id) <= 128
}

func hashDeviceSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func validateApnsFields(apnsToken, apnsEnv string) error {
	if apnsToken != "" && !apnsTokenPattern.MatchString(apnsToken) {
		return errors.New("invalid apns token")
	}
	if apnsEnv != "" && apnsEnv != "sandbox" && apnsEnv != "production" {
		return errors.New("invalid apns environment")
	}
	return nil
}

// RegisterIOSDevice creates a new iOS device client, or - if deviceID already
// exists and secret matches what it was created with - refreshes its push
// tokens. A reinstall or an app relaunch after an OS-issued token rotation
// calls this again with the same deviceID+secret the app generated and
// stored in the Keychain the first time.
//
// A deviceID already held by a different secret is refused
// (ErrDeviceSecretMismatch), so one device can't take over another's
// subscriptions/reminders just by sending its id.
func (v *Database) RegisterIOSDevice(deviceID, secret, apnsToken, apnsEnv, pushToStartToken string) (*NotificationClient, error) {
	if !validDeviceID(deviceID) {
		return nil, errors.New("invalid device id")
	}
	if len(secret) < 16 {
		return nil, errors.New("invalid device secret")
	}
	if apnsEnv != "sandbox" && apnsEnv != "production" {
		return nil, errors.New("invalid apns environment")
	}
	if err := validateApnsFields(apnsToken, apnsEnv); err != nil {
		return nil, err
	}

	secretHash := hashDeviceSecret(secret)
	now := int(time.Now().In(v.timeZone).Unix())

	existing, err := v.findIOSDeviceClient(deviceID)
	if err != nil && !errors.Is(err, ErrClientNotFound) {
		return nil, err
	}
	if err == nil {
		if subtle.ConstantTimeCompare([]byte(existing.deviceSecretHash), []byte(secretHash)) != 1 {
			return nil, ErrDeviceSecretMismatch
		}
		// The app re-registers on every launch, usually before iOS has
		// handed it this launch's APNs token - so an empty token here means
		// "not known yet", not "clear it". Overwriting with "" silently
		// disabled every push to the device until the next token callback.
		newApnsToken := existing.ApnsToken
		if apnsToken != "" {
			newApnsToken = apnsToken
		}
		newPushToStart := existing.PushToStartToken
		if pushToStartToken != "" {
			newPushToStart = pushToStartToken
		}
		if _, err := v.execContext(
			`UPDATE notifications SET apns_token = ?, apns_env = ?, push_to_start_token = ? WHERE id = ?`,
			nullableString(newApnsToken), apnsEnv, nullableString(newPushToStart), existing.Id,
		); err != nil {
			return nil, fmt.Errorf("update device: %w", err)
		}
		return v.findIOSDeviceClient(deviceID)
	}

	if _, err := v.execContext(
		`INSERT INTO notifications (platform, device_id, device_secret_hash, apns_token, apns_env, push_to_start_token, created)
         VALUES ('ios', ?, ?, ?, ?, ?, ?)`,
		deviceID, secretHash, nullableString(apnsToken), apnsEnv, nullableString(pushToStartToken), now,
	); err != nil {
		return nil, fmt.Errorf("create device: %w", err)
	}
	return v.findIOSDeviceClient(deviceID)
}

// UpdateIOSDeviceTokens rotates a registered device's APNs/push-to-start
// tokens (APNs tokens can change - e.g. after a restore) without touching
// its secret. Fields left empty ("") keep their current value.
func (v *Database) UpdateIOSDeviceTokens(deviceID, secret, apnsToken, apnsEnv, pushToStartToken string) (*NotificationClient, error) {
	client, err := v.FindIOSDeviceClient(deviceID, secret)
	if err != nil {
		return nil, err
	}
	if err := validateApnsFields(apnsToken, apnsEnv); err != nil {
		return nil, err
	}

	newApnsToken := client.ApnsToken
	if apnsToken != "" {
		newApnsToken = apnsToken
	}
	newApnsEnv := client.ApnsEnv
	if apnsEnv != "" {
		newApnsEnv = apnsEnv
	}
	newPushToStart := client.PushToStartToken
	if pushToStartToken != "" {
		newPushToStart = pushToStartToken
	}

	if _, err := v.execContext(
		`UPDATE notifications SET apns_token = ?, apns_env = ?, push_to_start_token = ? WHERE id = ?`,
		nullableString(newApnsToken), newApnsEnv, nullableString(newPushToStart), client.Id,
	); err != nil {
		return nil, fmt.Errorf("update device tokens: %w", err)
	}
	return v.findIOSDeviceClient(deviceID)
}

// setIOSDeviceApns overwrites a device's stored APNs token/env directly -
// used by the APNs sender to correct a wrong environment, or to clear a
// token APNs reports as unregistered, without deleting the device row (and
// with it every stop/route subscription and reminder the device owns).
func (v *Database) setIOSDeviceApns(clientID int, apnsToken, apnsEnv string) error {
	if v == nil {
		return nil
	}
	_, err := v.execContext(
		`UPDATE notifications SET apns_token = ?, apns_env = ? WHERE id = ? AND platform = 'ios'`,
		nullableString(apnsToken), apnsEnv, clientID,
	)
	return err
}

// FindIOSDeviceClient resolves a client from its device id + secret, as sent
// via the X-Device-Id/X-Device-Secret request headers. Returns
// ErrClientNotFound if no such device is registered, ErrDeviceSecretMismatch
// if the secret is wrong - callers should treat both as "unauthenticated",
// the distinction is only useful for logging/metrics.
func (v *Database) FindIOSDeviceClient(deviceID, secret string) (*NotificationClient, error) {
	client, err := v.findIOSDeviceClient(deviceID)
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(client.deviceSecretHash), []byte(hashDeviceSecret(secret))) != 1 {
		return nil, ErrDeviceSecretMismatch
	}
	return client, nil
}

// findIOSDeviceClient looks a device up by id alone (no secret check) -
// used internally by RegisterIOSDevice/UpdateIOSDeviceTokens, which verify
// the secret themselves against the hash this returns.
// getClientByID loads a client by its row id (e.g. a Live Activity's owner).
func (v *Database) getClientByID(id int) (*NotificationClient, error) {
	row, cancel := v.queryRowContext(`SELECT `+clientCoreColumns("n")+` FROM notifications n WHERE n.id = ?`, id)
	defer cancel()
	client, err := scanClientRow(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrClientNotFound
		}
		return nil, fmt.Errorf("get client %d: %w", id, err)
	}
	client.db = v
	return &client, nil
}

func (v *Database) findIOSDeviceClient(deviceID string) (*NotificationClient, error) {
	query := `SELECT ` + clientCoreColumns("n") + `, n.device_secret_hash
              FROM notifications n WHERE n.device_id = ? AND n.platform = 'ios'`
	row, cancel := v.queryRowContext(query, deviceID)
	defer cancel()

	var secretHash sql.NullString
	client, err := scanClientRow(row, &secretHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrClientNotFound
		}
		return nil, fmt.Errorf("find ios device: %w", err)
	}

	client.deviceSecretHash = secretHash.String
	client.db = v
	client.RecentNotifications = pruneRecentNotificationEntries(client.RecentNotifications, time.Now().In(v.timeZone))

	return &client, nil
}
