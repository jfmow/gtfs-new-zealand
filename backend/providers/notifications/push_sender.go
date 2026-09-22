package notifications

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"
)

// Payload is delivery-channel-agnostic push content, built once per
// notification and handed to whichever Notifier a client's platform maps to.
type Payload struct {
	Title   string
	Body    string
	URL     string // deeplink path, e.g. "/vehicles?tripId=..."
	Urgency webpush.Urgency
}

// Notifier delivers a Payload to a client over one specific channel. Send is
// responsible for deleting a client the channel reports as gone (web push's
// 410, APNs' Unregistered/BadDeviceToken) - callers don't need to know the
// channel-specific way that's signalled.
type Notifier interface {
	Send(client NotificationClient, p Payload) error
}

// platformNotifier dispatches a Payload to the Notifier registered for a
// client's Platform. A channel that isn't configured (e.g. no VAPID keys, no
// APNs key) returns an error instead of panicking, so a deployment can run
// with only one channel available.
type platformNotifier struct {
	byPlatform map[string]Notifier
}

func (m platformNotifier) Send(client NotificationClient, p Payload) error {
	platform := client.Platform
	if platform == "" {
		platform = "web"
	}
	notifier, ok := m.byPlatform[platform]
	if !ok {
		return fmt.Errorf("no notifier configured for platform %q", platform)
	}
	return notifier.Send(client, p)
}

var (
	sharedNotifierOnce sync.Once
	sharedNotifierVal  Notifier
)

// sharedNotifier builds the process-wide Notifier once, from environment
// config - shared across regions the same way sharedDatabase is, since VAPID
// and APNs credentials aren't per-region.
func sharedNotifier() Notifier {
	sharedNotifierOnce.Do(func() {
		byPlatform := map[string]Notifier{"web": &webPushSender{}}
		if apnsNotifier, err := newAPNsSender(); err != nil {
			log.Printf("notifications: APNs not configured, iOS push disabled: %v", err)
		} else {
			byPlatform["ios"] = apnsNotifier
		}
		sharedNotifierVal = platformNotifier{byPlatform: byPlatform}
	})
	return sharedNotifierVal
}

// ─────────────────────────────── web push ───────────────────────────────

type webPushSender struct{}

func (s *webPushSender) Send(client NotificationClient, p Payload) error {
	publicKey, foundPub := os.LookupEnv("WP_PUB")
	privateKey, foundPriv := os.LookupEnv("WP_PRIV")
	if !foundPub || !foundPriv {
		return errors.New("web push not configured (WP_PUB/WP_PRIV missing)")
	}

	payloadBytes, err := json.Marshal(map[string]any{
		"title": p.Title,
		"body":  p.Body,
		"data":  map[string]string{"url": p.URL},
	})
	if err != nil {
		return err
	}

	resp, err := webpush.SendNotification(payloadBytes, &client.Notification, &webpush.Options{
		Subscriber:      "hi@suddsy.dev",
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             30,
		Urgency:         p.Urgency,
	})
	if err != nil {
		if resp != nil && resp.StatusCode == 410 {
			client.DeleteNotificationClient("")
		}
		return err
	}
	if resp != nil {
		defer resp.Body.Close()
	}
	return nil
}

// ─────────────────────────────────  APNs  ─────────────────────────────────
//
// Configured from four env vars, all required:
//
//	APNS_KEY_ID      the .p8 key's Key ID (Apple Developer > Keys)
//	APNS_TEAM_ID     the Apple Developer Team ID
//	APNS_BUNDLE_ID   the app's bundle id (used as the APNs topic)
//	APNS_KEY_P8      the .p8 key file's full PEM contents
//
// If any are missing, newAPNsSender fails and iOS push is simply left out of
// sharedNotifier's platform map (web push keeps working on its own).

type apnsSender struct {
	sandbox    *apns2.Client
	production *apns2.Client
	bundleID   string
}

func newAPNsSender() (*apnsSender, error) {
	keyID := os.Getenv("APNS_KEY_ID")
	teamID := os.Getenv("APNS_TEAM_ID")
	bundleID := os.Getenv("APNS_BUNDLE_ID")
	keyPEM := os.Getenv("APNS_KEY_P8")
	if keyID == "" || teamID == "" || bundleID == "" || keyPEM == "" {
		return nil, errors.New("missing one of APNS_KEY_ID/APNS_TEAM_ID/APNS_BUNDLE_ID/APNS_KEY_P8")
	}

	authKey, err := token.AuthKeyFromBytes([]byte(keyPEM))
	if err != nil {
		return nil, fmt.Errorf("parse APNS_KEY_P8: %w", err)
	}
	tok := &token.Token{AuthKey: authKey, KeyID: keyID, TeamID: teamID}

	return &apnsSender{
		sandbox:    apns2.NewTokenClient(tok).Development(),
		production: apns2.NewTokenClient(tok).Production(),
		bundleID:   bundleID,
	}, nil
}

func (s *apnsSender) Send(client NotificationClient, p Payload) error {
	if client.ApnsToken == "" {
		return errors.New("client has no apns token")
	}

	aps := map[string]any{
		"alert": map[string]string{"title": p.Title, "body": p.Body},
		"sound": "default",
	}
	if p.Urgency == "high" {
		aps["interruption-level"] = "time-sensitive"
	}
	payload := map[string]any{"aps": aps}
	if p.URL != "" {
		payload["url"] = p.URL
	}

	n := &apns2.Notification{
		DeviceToken: client.ApnsToken,
		Topic:       s.bundleID,
		Payload:     payload,
		PushType:    apns2.PushTypeAlert,
	}
	if p.Urgency == "high" {
		n.Priority = apns2.PriorityHigh
	} else {
		n.Priority = apns2.PriorityLow
	}

	apnsClient := s.production
	if client.ApnsEnv == "sandbox" {
		apnsClient = s.sandbox
	}

	res, err := apnsClient.Push(n)
	if err != nil {
		return fmt.Errorf("apns push: %w", err)
	}
	if !res.Sent() {
		if res.Reason == apns2.ReasonUnregistered || res.Reason == apns2.ReasonBadDeviceToken {
			client.DeleteNotificationClient("")
		}
		return fmt.Errorf("apns push rejected: %d %s", res.StatusCode, res.Reason)
	}
	return nil
}
