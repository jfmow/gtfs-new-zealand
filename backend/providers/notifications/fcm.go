package notifications

import (
	"bytes"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ─────────────────────────────────  FCM  ─────────────────────────────────
//
// Android push goes through Firebase Cloud Messaging's HTTP v1 API,
// authenticated as a service account. Configured from one env var:
//
//	FCM_SERVICE_ACCOUNT_JSON   the service account key file's full JSON
//	                           (Firebase console > Project settings >
//	                           Service accounts > Generate new private key)
//
// If it's missing, newFCMSender fails and Android push is left out of
// sharedNotifier's platform map, like APNs.

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging"

type fcmServiceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

type fcmSender struct {
	projectID   string
	clientEmail string
	tokenURI    string
	key         *rsa.PrivateKey
	http        *http.Client
	// sendURL is the v1 messages:send endpoint; a field so tests can point it at a fake server.
	sendURL string

	mu          sync.Mutex
	accessToken string
	expires     time.Time
}

func newFCMSender() (*fcmSender, error) {
	raw := os.Getenv("FCM_SERVICE_ACCOUNT_JSON")
	if raw == "" {
		return nil, errors.New("FCM_SERVICE_ACCOUNT_JSON missing")
	}
	return newFCMSenderFromJSON([]byte(raw))
}

func newFCMSenderFromJSON(raw []byte) (*fcmSender, error) {
	var sa fcmServiceAccount
	if err := json.Unmarshal(raw, &sa); err != nil {
		return nil, fmt.Errorf("parse FCM service account: %w", err)
	}
	if sa.ProjectID == "" || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, errors.New("FCM service account is missing project_id, client_email or private_key")
	}
	key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(sa.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("parse FCM private key: %w", err)
	}
	tokenURI := sa.TokenURI
	if tokenURI == "" {
		tokenURI = "https://oauth2.googleapis.com/token"
	}
	return &fcmSender{
		projectID:   sa.ProjectID,
		clientEmail: sa.ClientEmail,
		tokenURI:    tokenURI,
		key:         key,
		http:        &http.Client{Timeout: 10 * time.Second},
		sendURL:     "https://fcm.googleapis.com/v1/projects/" + url.PathEscape(sa.ProjectID) + "/messages:send",
	}, nil
}

// token returns a cached OAuth access token, minting a new one from a signed
// JWT assertion when it's within a minute of expiring.
func (s *fcmSender) token() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accessToken != "" && time.Now().Before(s.expires.Add(-time.Minute)) {
		return s.accessToken, nil
	}

	now := time.Now()
	assertion, err := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":   s.clientEmail,
		"scope": fcmScope,
		"aud":   s.tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}).SignedString(s.key)
	if err != nil {
		return "", fmt.Errorf("sign FCM assertion: %w", err)
	}

	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	resp, err := s.http.PostForm(s.tokenURI, form)
	if err != nil {
		return "", fmt.Errorf("FCM token request: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil || resp.StatusCode != http.StatusOK || body.AccessToken == "" {
		return "", fmt.Errorf("FCM token request failed: status %d", resp.StatusCode)
	}
	s.accessToken = body.AccessToken
	s.expires = now.Add(time.Duration(body.ExpiresIn) * time.Second)
	return s.accessToken, nil
}

// fcmAndroidChannel picks the Android notification channel the app creates
// at launch ("journey" for get-on/get-off moments, "alerts" otherwise), so a
// rider can mute one kind without the other.
func fcmAndroidChannel(p Payload) string {
	if p.Kind == "journey" {
		return "journey"
	}
	return "alerts"
}

// fcmMessage builds the v1 `message` body for a payload. The data block
// carries the deep link and kind so the app can route a tap, the same keys
// the APNs payload uses.
func fcmMessage(token string, p Payload) map[string]any {
	data := map[string]string{}
	if p.URL != "" {
		data["url"] = p.URL
	}
	if p.Kind != "" {
		data["kind"] = p.Kind
	}
	priority := "NORMAL"
	if p.Urgency == "high" {
		priority = "HIGH"
	}
	android := map[string]any{
		"priority": priority,
		"notification": map[string]any{
			"channel_id": fcmAndroidChannel(p),
		},
	}
	if p.Kind != "" {
		android["notification"].(map[string]any)["tag"] = p.Kind
	}
	msg := map[string]any{
		"token":        token,
		"notification": map[string]string{"title": p.Title, "body": p.Body},
		"android":      android,
	}
	if len(data) > 0 {
		msg["data"] = data
	}
	return map[string]any{"message": msg}
}

// fcmTokenGone reports whether an FCM error means the registration token is
// dead (app uninstalled, token rotated): UNREGISTERED, or INVALID_ARGUMENT
// about the token itself.
func fcmTokenGone(status int, body []byte) bool {
	text := string(body)
	if status == http.StatusNotFound || strings.Contains(text, "UNREGISTERED") {
		return true
	}
	return status == http.StatusBadRequest && strings.Contains(text, "registration token")
}

// post sends one v1 message body - status 200 is success; anything else
// comes back with FCM's error body for fcmTokenGone.
func (s *fcmSender) post(message map[string]any) (int, []byte, error) {
	access, err := s.token()
	if err != nil {
		return 0, nil, err
	}
	body, err := json.Marshal(message)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(http.MethodPost, s.sendURL, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("fcm push: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return http.StatusOK, nil, nil
	}
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	return resp.StatusCode, respBody, nil
}

// fcmLiveTTL: a live update that can't be delivered within this is out of
// date - the next one replaces it anyway (same collapse key).
const fcmLiveTTL = "300s"

// fcmLiveMessage is a live-update push - Android's Live Activity. A data
// message (no `notification` block) so the app's TransitMessagingService
// draws it itself, as the same ongoing notification the app writes while
// it's open. `state` is the activity's content state - the same JSON the
// iOS activity gets. Collapsible per activity: a phone that was offline
// gets only the latest.
func fcmLiveMessage(token, kind, activityID string, state any, alert *activityAlert, dismissal *time.Time) (map[string]any, error) {
	encoded, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	data := map[string]string{
		"transit":    "live",
		"kind":       kind,
		"activityId": activityID,
		"state":      string(encoded),
	}
	if alert != nil {
		data["alertTitle"] = alert.Title
		data["alertBody"] = alert.Body
		if alert.Silent {
			data["alertSilent"] = "1"
		}
	}
	if dismissal != nil {
		data["end"] = strconv.FormatInt(dismissal.Unix(), 10)
	}
	return map[string]any{"message": map[string]any{
		"token": token,
		"data":  data,
		"android": map[string]any{
			// High: a normal-priority data message waits for the phone to
			// leave Doze, and this updates something the rider is looking at.
			"priority":     "HIGH",
			"ttl":          fcmLiveTTL,
			"collapse_key": "live-" + activityID,
		},
	}}, nil
}

// SendLiveUpdate pushes a journey or trip activity's state to an Android
// device. A dead token comes back as errLiveActivityBadToken, like APNs.
func (s *fcmSender) SendLiveUpdate(token, kind, activityID string, state any, alert *activityAlert, dismissal *time.Time) error {
	if token == "" {
		return errors.New("live activity has no fcm token")
	}
	message, err := fcmLiveMessage(token, kind, activityID, state, alert, dismissal)
	if err != nil {
		return err
	}
	status, body, err := s.post(message)
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		return nil
	}
	if fcmTokenGone(status, body) {
		return fmt.Errorf("%w (fcm %d)", errLiveActivityBadToken, status)
	}
	return fmt.Errorf("fcm live update rejected: %d", status)
}

func (s *fcmSender) Send(client NotificationClient, p Payload) error {
	if client.FcmToken == "" {
		return errors.New("client has no fcm token")
	}
	status, respBody, err := s.post(fcmMessage(client.FcmToken, p))
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		return nil
	}
	log.Printf("notifications: fcm push to client %d rejected: %d", client.Id, status)
	// Like APNs: clear just the token, never the device row (it owns every
	// subscription and reminder). The app sends a fresh token next launch.
	if fcmTokenGone(status, respBody) && client.db != nil {
		client.db.setAndroidDeviceFcm(client.Id, "")
	}
	return fmt.Errorf("fcm push rejected: %d", status)
}
