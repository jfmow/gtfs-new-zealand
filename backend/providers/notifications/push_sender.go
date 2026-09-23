package notifications

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

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
	// Kind tags the push for the app ("journey" = a get-on/get-off moment
	// of a tracked journey, which the app hides while its tracker is on
	// screen because it shows the same alert in-app). Empty for others.
	Kind string
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
	sharedAPNsVal      *apnsSender // nil if APNs isn't configured - same condition sharedNotifier logs
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
			sharedAPNsVal = apnsNotifier
		}
		sharedNotifierVal = platformNotifier{byPlatform: byPlatform}
	})
	return sharedNotifierVal
}

// sharedAPNsSender exposes the concrete *apnsSender (rather than the plain
// Notifier interface) for Live Activity pushes, which use their own
// SendLiveActivityUpdate method with a different payload shape from
// Notifier.Send's alert-style one. nil if APNs isn't configured - callers
// skip Live Activity delivery in that case, same as regular iOS push does.
func sharedAPNsSender() *apnsSender {
	sharedNotifier() // ensures the Once has run
	return sharedAPNsVal
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

// SendLiveActivityUpdate pushes a content-state update (or, with
// dismissalDate set, an end event) to one Live Activity's own push token.
// With alert set it also plays a sound and shows a banner - reserved for the
// one-off journey moments (time to leave, get off next...) - and goes at
// priority 10; routine updates go at 5 so they don't eat into the per-app
// high-priority budget iOS enforces for Live Activities.
func (s *apnsSender) SendLiveActivityUpdate(pushToken, env string, contentState any, alert *activityAlert, staleDate, dismissalDate *time.Time) error {
	if pushToken == "" {
		return errors.New("live activity has no push token")
	}
	aps, priority := liveActivityUpdateAPS(contentState, alert, staleDate, dismissalDate, time.Now())
	return s.pushLiveActivity(pushToken, env, aps, priority)
}

// liveActivityUpdateAPS builds the aps dictionary (and APNs priority) for a
// Live Activity update or end push.
func liveActivityUpdateAPS(contentState any, alert *activityAlert, staleDate, dismissalDate *time.Time, now time.Time) (map[string]any, int) {
	aps := map[string]any{
		"timestamp":     now.Unix(),
		"content-state": contentState,
		"event":         "update",
	}
	if staleDate != nil {
		aps["stale-date"] = staleDate.Unix()
	}
	if dismissalDate != nil {
		aps["event"] = "end"
		aps["dismissal-date"] = dismissalDate.Unix()
	}
	priority := apns2.PriorityLow
	if alert != nil {
		// For Live Activity pushes the sound lives *inside* alert - a
		// top-level aps.sound is ignored, which made these alerts silent.
		a := map[string]string{"title": alert.Title, "body": alert.Body}
		if alert.Sound {
			a["sound"] = "default"
		}
		aps["alert"] = a
		priority = apns2.PriorityHigh
	}
	if dismissalDate != nil {
		priority = apns2.PriorityHigh
	}
	return aps, priority
}

// SendLiveActivityStart starts a journey Live Activity remotely
// (push-to-start, iOS 17.2+) using the device's push-to-start token. The
// app is then woken briefly in the background to register the new
// activity's own update token (LiveActivityCoordinator.observeNewActivities).
func (s *apnsSender) SendLiveActivityStart(pushToStartToken, env string, attributes map[string]any, contentState any, alert activityAlert, staleDate time.Time) error {
	if pushToStartToken == "" {
		return errors.New("device has no push-to-start token")
	}
	aps := map[string]any{
		"timestamp":       time.Now().Unix(),
		"event":           "start",
		"content-state":   contentState,
		"attributes-type": "JourneyActivityAttributes",
		"attributes":      attributes,
		"alert":           map[string]string{"title": alert.Title, "body": alert.Body, "sound": "default"},
		"stale-date":      staleDate.Unix(),
	}
	return s.pushLiveActivity(pushToStartToken, env, aps, apns2.PriorityHigh)
}

func (s *apnsSender) pushLiveActivity(token, env string, aps map[string]any, priority int) error {
	n := &apns2.Notification{
		DeviceToken: token,
		Topic:       s.bundleID + ".push-type.liveactivity",
		Payload:     map[string]any{"aps": aps},
		PushType:    apns2.PushTypeLiveActivity,
		Priority:    priority,
	}
	res, err := s.clientFor(env).Push(n)
	if err != nil {
		return fmt.Errorf("apns live activity push: %w", err)
	}
	if !res.Sent() {
		return fmt.Errorf("apns live activity push rejected: %d %s", res.StatusCode, res.Reason)
	}
	return nil
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
	if p.Kind != "" {
		aps["thread-id"] = p.Kind
	}
	payload := map[string]any{"aps": aps}
	if p.URL != "" {
		payload["url"] = p.URL
	}
	if p.Kind != "" {
		payload["kind"] = p.Kind
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

	env := client.ApnsEnv
	res, err := s.clientFor(env).Push(n)
	if err != nil {
		return fmt.Errorf("apns push: %w", err)
	}

	// A BadDeviceToken almost always means the token belongs to the *other*
	// APNs environment (a Release build run from Xcode is still sandbox; a
	// TestFlight build is production), not that the device is gone. Retry
	// once on the other host and, if that works, remember it.
	if !res.Sent() && res.Reason == apns2.ReasonBadDeviceToken {
		otherEnv := otherApnsEnv(env)
		if retry, retryErr := s.clientFor(otherEnv).Push(n); retryErr == nil && retry.Sent() {
			log.Printf("notifications: apns env for client %d corrected %s -> %s", client.Id, env, otherEnv)
			if client.db != nil {
				client.db.setIOSDeviceApns(client.Id, client.ApnsToken, otherEnv)
			}
			return nil
		}
	}

	if !res.Sent() {
		log.Printf("notifications: apns push to client %d rejected: %d %s", client.Id, res.StatusCode, res.Reason)
		// Clear just the token - never delete the device row, which also
		// owns every stop/route subscription and reminder. The app sends a
		// fresh token on its next launch.
		if res.Reason == apns2.ReasonUnregistered || res.Reason == apns2.ReasonBadDeviceToken {
			if client.db != nil {
				client.db.setIOSDeviceApns(client.Id, "", env)
			}
		}
		return fmt.Errorf("apns push rejected: %d %s", res.StatusCode, res.Reason)
	}
	return nil
}

func (s *apnsSender) clientFor(env string) *apns2.Client {
	if env == "sandbox" {
		return s.sandbox
	}
	return s.production
}

func otherApnsEnv(env string) string {
	if env == "sandbox" {
		return "production"
	}
	return "sandbox"
}
