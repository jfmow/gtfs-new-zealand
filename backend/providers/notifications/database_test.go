package notifications

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
)

// legacyNotificationsSchema is the pre-migration `notifications` table - a
// web-push-only client table with NOT NULL columns and a table-level UNIQUE
// constraint, exactly as it existed before device identity was added. Tests
// below build a DB file in this shape and confirm newDatabaseAtPath rebuilds
// it in place without losing data or breaking the `stops` FK.
const legacyNotificationsSchema = `
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    recent_notifications TEXT NOT NULL DEFAULT '[]',
    created INTEGER NOT NULL,
    expiry_warning_sent INTEGER NOT NULL DEFAULT 0,
    UNIQUE(endpoint, p256dh, auth)
);
CREATE TABLE stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientId INTEGER NOT NULL,
    parent_stop TEXT NOT NULL,
    routes TEXT,
    UNIQUE(clientId, parent_stop),
    FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
);
`

func seedLegacyDatabase(t *testing.T, dbPath string) (clientID int64) {
	t.Helper()

	raw, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	defer raw.Close()

	if _, err := raw.Exec(legacyNotificationsSchema); err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}

	res, err := raw.Exec(
		`INSERT INTO notifications (endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?)`,
		"https://push.example/abc", "p256dh-value", "auth-value", time.Now().Unix(),
	)
	if err != nil {
		t.Fatalf("seed client: %v", err)
	}
	clientID, err = res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}

	if _, err := raw.Exec(`INSERT INTO stops (clientId, parent_stop) VALUES (?, ?)`, clientID, "stop-1"); err != nil {
		t.Fatalf("seed stop subscription: %v", err)
	}

	return clientID
}

func TestMigrateNotificationsDeviceIdentity_PreservesLegacyRowsAndFKs(t *testing.T) {
	tz := mustNZ(t)
	dbPath := filepath.Join(t.TempDir(), "notifications.db")
	legacyID := seedLegacyDatabase(t, dbPath)

	db, err := newDatabaseAtPath(dbPath, tz, "test@example.com", "test")
	if err != nil {
		t.Fatalf("newDatabaseAtPath: %v", err)
	}
	defer db.Close()

	cols, err := db.columnNames(context.Background(), "notifications")
	if err != nil {
		t.Fatalf("columnNames: %v", err)
	}
	for _, want := range []string{"platform", "device_id", "device_secret_hash", "apns_token", "apns_env", "push_to_start_token"} {
		if !cols[want] {
			t.Errorf("expected migrated notifications table to have column %q", want)
		}
	}

	client, err := db.FindNotificationClient("https://push.example/abc", "p256dh-value", "auth-value", "")
	if err != nil {
		t.Fatalf("FindNotificationClient after migration: %v", err)
	}
	if client.Id != int(legacyID) {
		t.Errorf("id = %d, want %d", client.Id, legacyID)
	}
	if client.Platform != "web" {
		t.Errorf("platform = %q, want %q", client.Platform, "web")
	}
	if !client.isExpiringWeb() {
		t.Errorf("a migrated web client should still be subject to the 30-day expiry")
	}

	// The stops FK survives the notifications table rebuild.
	clients, err := db.GetNotificationClientsByStop("stop-1", "", 10, 0)
	if err != nil {
		t.Fatalf("GetNotificationClientsByStop: %v", err)
	}
	if len(clients) != 1 || clients[0].Id != int(legacyID) {
		t.Fatalf("GetNotificationClientsByStop = %+v, want one client with id %d", clients, legacyID)
	}

	// ON DELETE CASCADE still fires after the rebuild.
	if err := client.DeleteNotificationClient(""); err != nil {
		t.Fatalf("DeleteNotificationClient: %v", err)
	}
	remaining, err := db.GetNotificationClientsByStop("stop-1", "", 10, 0)
	if err != nil {
		t.Fatalf("GetNotificationClientsByStop after delete: %v", err)
	}
	if len(remaining) != 0 {
		t.Errorf("expected the stop subscription to cascade-delete, got %+v", remaining)
	}
}

func TestMigrateNotificationsDeviceIdentity_IdempotentOnAlreadyMigratedDB(t *testing.T) {
	tz := mustNZ(t)
	dbPath := filepath.Join(t.TempDir(), "notifications.db")
	seedLegacyDatabase(t, dbPath)

	db, err := newDatabaseAtPath(dbPath, tz, "test@example.com", "test")
	if err != nil {
		t.Fatalf("newDatabaseAtPath: %v", err)
	}
	defer db.Close()

	// Running the migration again against an already-migrated table must be a
	// no-op, not an error - ensureSchema runs on every process start.
	if err := db.ensureSchema(context.Background()); err != nil {
		t.Fatalf("second ensureSchema: %v", err)
	}

	client, err := db.FindNotificationClient("https://push.example/abc", "p256dh-value", "auth-value", "")
	if err != nil {
		t.Fatalf("FindNotificationClient after second migration: %v", err)
	}
	if client.Platform != "web" {
		t.Errorf("platform = %q, want %q", client.Platform, "web")
	}
}

func newTestDatabase(t *testing.T) *Database {
	t.Helper()
	tz := mustNZ(t)
	db, err := newDatabaseAtPath(filepath.Join(t.TempDir(), "notifications.db"), tz, "test@example.com", "test")
	if err != nil {
		t.Fatalf("newDatabaseAtPath: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestRegisterIOSDevice_CreateFindAndSecretMismatch(t *testing.T) {
	db := newTestDatabase(t)

	apnsToken := "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
	client, err := db.RegisterIOSDevice("11111111-1111-1111-1111-111111111111", "correct-horse-battery-staple", apnsToken, "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}
	if client.Platform != "ios" {
		t.Errorf("platform = %q, want ios", client.Platform)
	}
	if client.isExpiringWeb() {
		t.Errorf("an ios device must not be subject to the 30-day web push expiry")
	}

	found, err := db.FindIOSDeviceClient("11111111-1111-1111-1111-111111111111", "correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("FindIOSDeviceClient: %v", err)
	}
	if found.Id != client.Id {
		t.Errorf("found id %d, want %d", found.Id, client.Id)
	}

	if _, err := db.FindIOSDeviceClient("11111111-1111-1111-1111-111111111111", "wrong-secret"); !errors.Is(err, ErrDeviceSecretMismatch) {
		t.Errorf("wrong secret: err = %v, want ErrDeviceSecretMismatch", err)
	}

	if _, err := db.FindIOSDeviceClient("no-such-device-------------------------", "anything"); !errors.Is(err, ErrClientNotFound) {
		t.Errorf("unknown device: err = %v, want ErrClientNotFound", err)
	}
}

func TestRegisterIOSDevice_ReRegisterUpdatesTokenAndRefusesWrongSecret(t *testing.T) {
	db := newTestDatabase(t)
	deviceID := "22222222-2222-2222-2222-222222222222"
	secret := "another-long-enough-secret-value"
	tokenA := "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"
	tokenB := "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

	if _, err := db.RegisterIOSDevice(deviceID, secret, tokenA, "sandbox", ""); err != nil {
		t.Fatalf("first register: %v", err)
	}

	// Re-registering with the same id+secret (e.g. after a reinstall) updates
	// the token rather than erroring or creating a second row.
	updated, err := db.RegisterIOSDevice(deviceID, secret, tokenB, "production", "push-to-start-tok")
	if err != nil {
		t.Fatalf("second register: %v", err)
	}
	if updated.ApnsToken != tokenB {
		t.Errorf("apns token = %q, want %q", updated.ApnsToken, tokenB)
	}
	if updated.ApnsEnv != "production" {
		t.Errorf("apns env = %q, want production", updated.ApnsEnv)
	}

	if _, err := db.RegisterIOSDevice(deviceID, "someone-elses-secret-value", tokenA, "sandbox", ""); !errors.Is(err, ErrDeviceSecretMismatch) {
		t.Errorf("register with wrong secret: err = %v, want ErrDeviceSecretMismatch", err)
	}
}

func TestRegisterIOSDevice_ReRegisterWithEmptyTokenKeepsStoredTokens(t *testing.T) {
	db := newTestDatabase(t)
	deviceID := "55555555-5555-5555-5555-555555555555"
	secret := "relaunch-secret-long-enough-value"
	token := "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

	if _, err := db.RegisterIOSDevice(deviceID, secret, token, "sandbox", "pts-1"); err != nil {
		t.Fatalf("first register: %v", err)
	}

	// Every app launch re-registers before iOS hands back the APNs token -
	// that must not wipe the token stored from the previous launch.
	relaunched, err := db.RegisterIOSDevice(deviceID, secret, "", "sandbox", "")
	if err != nil {
		t.Fatalf("relaunch register: %v", err)
	}
	if relaunched.ApnsToken != token {
		t.Errorf("apns token = %q, want it kept as %q", relaunched.ApnsToken, token)
	}
	if relaunched.PushToStartToken != "pts-1" {
		t.Errorf("push-to-start token = %q, want it kept as pts-1", relaunched.PushToStartToken)
	}
}

func TestValidateApnsFields_AcceptsVariableLengthTokens(t *testing.T) {
	device := strings.Repeat("ab", 32)    // physical iPhone: 32 bytes
	simulator := strings.Repeat("cd", 80) // iOS simulator: 80 bytes
	for _, tok := range []string{device, simulator} {
		if err := validateApnsFields(tok, "sandbox"); err != nil {
			t.Errorf("token of %d hex chars rejected: %v", len(tok), err)
		}
	}
	for _, bad := range []string{"abc", strings.Repeat("zz", 32), strings.Repeat("ab", 16), strings.Repeat("a", 65)} {
		if err := validateApnsFields(bad, "sandbox"); err == nil {
			t.Errorf("token %q accepted, want rejected", bad)
		}
	}
}

func TestUpdateIOSDeviceTokens_PartialUpdateKeepsOtherFields(t *testing.T) {
	db := newTestDatabase(t)
	deviceID := "33333333-3333-3333-3333-333333333333"
	secret := "yet-another-long-enough-secret"
	tokenA := "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"

	if _, err := db.RegisterIOSDevice(deviceID, secret, tokenA, "sandbox", "pts-1"); err != nil {
		t.Fatalf("register: %v", err)
	}

	// Empty fields mean "leave unchanged".
	updated, err := db.UpdateIOSDeviceTokens(deviceID, secret, "", "", "pts-2")
	if err != nil {
		t.Fatalf("UpdateIOSDeviceTokens: %v", err)
	}
	if updated.ApnsToken != tokenA {
		t.Errorf("apns token changed unexpectedly: %q", updated.ApnsToken)
	}
	if updated.ApnsEnv != "sandbox" {
		t.Errorf("apns env changed unexpectedly: %q", updated.ApnsEnv)
	}
	if updated.PushToStartToken != "pts-2" {
		t.Errorf("push-to-start token = %q, want pts-2", updated.PushToStartToken)
	}
}

func TestResolveClientAndResolveOrCreateClient_IOSVsWeb(t *testing.T) {
	db := newTestDatabase(t)
	deviceID := "44444444-4444-4444-4444-444444444444"
	secret := "device-secret-long-enough-value"
	if _, err := db.RegisterIOSDevice(deviceID, secret, "", "sandbox", ""); err != nil {
		t.Fatalf("register: %v", err)
	}

	// A registered device resolves through ResolveClient/ResolveOrCreateClient.
	deviceIdentity := ClientIdentity{DeviceID: deviceID, DeviceSecret: secret}
	if _, err := db.ResolveClient(deviceIdentity, ""); err != nil {
		t.Fatalf("ResolveClient(registered device): %v", err)
	}
	if _, err := db.ResolveOrCreateClient(deviceIdentity, gtfs.Database{}); err != nil {
		t.Fatalf("ResolveOrCreateClient(registered device): %v", err)
	}

	// An unregistered device id can't be conjured into existence - unlike the
	// web path, there's no APNs token to create it with.
	unregistered := ClientIdentity{DeviceID: "55555555-5555-5555-5555-555555555555", DeviceSecret: "whatever-secret-value"}
	if _, err := db.ResolveClient(unregistered, ""); !errors.Is(err, ErrClientNotFound) {
		t.Errorf("ResolveClient(unregistered device): err = %v, want ErrClientNotFound", err)
	}
	if _, err := db.ResolveOrCreateClient(unregistered, gtfs.Database{}); !errors.Is(err, ErrDeviceNotRegistered) {
		t.Errorf("ResolveOrCreateClient(unregistered device): err = %v, want ErrDeviceNotRegistered", err)
	}

	// The web path is unaffected: ResolveOrCreateClient still creates on
	// first use.
	webIdentity := ClientIdentity{Endpoint: "https://push.example/xyz", P256dh: "p256dh-value-2", Auth: "auth-value-2"}
	client, err := db.ResolveOrCreateClient(webIdentity, gtfs.Database{})
	if err != nil {
		t.Fatalf("ResolveOrCreateClient(web): %v", err)
	}
	if client.Platform != "web" {
		t.Errorf("platform = %q, want web", client.Platform)
	}
}
