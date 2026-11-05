package notifications

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const testFcmToken = "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:APA91b_example"

func TestRegisterAndroidDevice_CreateUpdateAndPlatformIsolation(t *testing.T) {
	db := newTestDatabase(t)
	const id = "22222222-2222-2222-2222-222222222222"
	const secret = "android-secret-long-enough"

	client, err := db.RegisterAndroidDevice(id, secret, testFcmToken)
	if err != nil {
		t.Fatalf("RegisterAndroidDevice: %v", err)
	}
	if client.Platform != "android" || client.FcmToken != testFcmToken {
		t.Fatalf("got platform %q token %q", client.Platform, client.FcmToken)
	}
	if client.isExpiringWeb() {
		t.Errorf("an android device must not be subject to the 30-day web push expiry")
	}

	// Re-registering with no token keeps the stored one.
	again, err := db.RegisterAndroidDevice(id, secret, "")
	if err != nil || again.Id != client.Id || again.FcmToken != testFcmToken {
		t.Fatalf("re-register: %+v %v", again, err)
	}

	// Headers resolve an Android device the same way as an iOS one.
	resolved, err := db.ResolveClient(ClientIdentity{DeviceID: id, DeviceSecret: secret}, "")
	if err != nil || resolved.Id != client.Id {
		t.Fatalf("ResolveClient: %+v %v", resolved, err)
	}

	newToken := "fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:rotated"
	updated, err := db.UpdateAndroidDeviceToken(id, secret, newToken)
	if err != nil || updated.FcmToken != newToken {
		t.Fatalf("UpdateAndroidDeviceToken: %+v %v", updated, err)
	}

	if _, err := db.RegisterAndroidDevice(id, "a-different-secret-entirely", ""); !errors.Is(err, ErrDeviceSecretMismatch) {
		t.Errorf("wrong secret: err = %v, want ErrDeviceSecretMismatch", err)
	}
	// An iOS registration can't take over the Android row, or the reverse.
	if _, err := db.RegisterIOSDevice(id, secret, "", "sandbox", ""); !errors.Is(err, ErrDeviceSecretMismatch) {
		t.Errorf("ios over android: err = %v, want ErrDeviceSecretMismatch", err)
	}
	if _, err := db.UpdateIOSDeviceTokens(id, secret, "", "sandbox", ""); !errors.Is(err, ErrDeviceSecretMismatch) {
		t.Errorf("ios token update on android row: err = %v, want ErrDeviceSecretMismatch", err)
	}
	if _, err := db.RegisterAndroidDevice(id, secret, "not a token!"); err == nil {
		t.Errorf("an invalid fcm token was accepted")
	}
}

func TestFcmMessage_ShapeAndPriority(t *testing.T) {
	msg := fcmMessage("tok", Payload{Title: "Get off next", Body: "Ellerslie", URL: "/journey?id=1", Kind: "journey", Urgency: "high"})["message"].(map[string]any)
	if msg["token"] != "tok" {
		t.Errorf("token = %v", msg["token"])
	}
	android := msg["android"].(map[string]any)
	if android["priority"] != "HIGH" {
		t.Errorf("priority = %v, want HIGH", android["priority"])
	}
	note := android["notification"].(map[string]any)
	if note["channel_id"] != "journey" || note["tag"] != "journey" {
		t.Errorf("android notification = %v", note)
	}
	data := msg["data"].(map[string]string)
	if data["url"] != "/journey?id=1" || data["kind"] != "journey" {
		t.Errorf("data = %v", data)
	}

	plain := fcmMessage("tok", Payload{Title: "Alert", Body: "b"})["message"].(map[string]any)
	if plain["android"].(map[string]any)["priority"] != "NORMAL" {
		t.Errorf("default priority should be NORMAL")
	}
	if plain["android"].(map[string]any)["notification"].(map[string]any)["channel_id"] != "alerts" {
		t.Errorf("default channel should be alerts")
	}
	if _, ok := plain["data"]; ok {
		t.Errorf("no data block expected without url/kind")
	}
}

func TestFcmTokenGone(t *testing.T) {
	if !fcmTokenGone(404, []byte(`{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`)) {
		t.Errorf("UNREGISTERED should clear the token")
	}
	if !fcmTokenGone(400, []byte(`{"error":{"message":"The registration token is not a valid FCM registration token"}}`)) {
		t.Errorf("an invalid registration token should clear it")
	}
	if fcmTokenGone(500, []byte(`internal`)) || fcmTokenGone(429, []byte(`QUOTA_EXCEEDED`)) {
		t.Errorf("server errors and quota must keep the token")
	}
}

// fakeFCM serves the OAuth token endpoint and messages:send, recording what it gets.
func fakeFCM(t *testing.T, sendStatus int, sendBody string) (*fcmSender, *atomic.Int32, *atomic.Value) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	var tokenCalls atomic.Int32
	var lastSend atomic.Value
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		tokenCalls.Add(1)
		if r.FormValue("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" || r.FormValue("assertion") == "" {
			http.Error(w, "bad grant", http.StatusBadRequest)
			return
		}
		w.Write([]byte(`{"access_token":"access-1","expires_in":3600}`))
	})
	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access-1" {
			http.Error(w, "unauthorised", http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(r.Body)
		lastSend.Store(string(body))
		w.WriteHeader(sendStatus)
		w.Write([]byte(sendBody))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	sa, _ := json.Marshal(map[string]string{
		"project_id": "transit-test", "client_email": "push@transit-test.iam.gserviceaccount.com",
		"private_key": string(keyPEM), "token_uri": server.URL + "/token",
	})
	sender, err := newFCMSenderFromJSON(sa)
	if err != nil {
		t.Fatalf("newFCMSenderFromJSON: %v", err)
	}
	sender.sendURL = server.URL + "/send"
	return sender, &tokenCalls, &lastSend
}

func TestFcmSender_SendsAndCachesToken(t *testing.T) {
	sender, tokenCalls, lastSend := fakeFCM(t, http.StatusOK, `{"name":"projects/transit-test/messages/1"}`)
	client := NotificationClient{Id: 1, Platform: "android", FcmToken: testFcmToken}

	for i := 0; i < 2; i++ {
		if err := sender.Send(client, Payload{Title: "T", Body: "B", URL: "/trip?tripId=x"}); err != nil {
			t.Fatalf("Send: %v", err)
		}
	}
	if tokenCalls.Load() != 1 {
		t.Errorf("token minted %d times, want 1 (cached)", tokenCalls.Load())
	}
	if body, _ := lastSend.Load().(string); !strings.Contains(body, testFcmToken) || !strings.Contains(body, "/trip?tripId=x") {
		t.Errorf("send body = %s", body)
	}
}

func TestFcmSender_UnregisteredClearsStoredToken(t *testing.T) {
	db := newTestDatabase(t)
	registered, err := db.RegisterAndroidDevice("33333333-3333-3333-3333-333333333333", "android-secret-long-enough", testFcmToken)
	if err != nil {
		t.Fatal(err)
	}
	sender, _, _ := fakeFCM(t, http.StatusNotFound, `{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}`)

	if err := sender.Send(*registered, Payload{Title: "T", Body: "B"}); err == nil {
		t.Fatalf("expected an error for an unregistered token")
	}
	after, err := db.FindIOSDeviceClient("33333333-3333-3333-3333-333333333333", "android-secret-long-enough")
	if err != nil {
		t.Fatal(err)
	}
	if after.FcmToken != "" {
		t.Errorf("token = %q, want cleared", after.FcmToken)
	}
	if after.Id != registered.Id {
		t.Errorf("the device row must survive (it owns subscriptions)")
	}
}

func TestFcmSender_NoTokenIsAnError(t *testing.T) {
	sender, tokenCalls, _ := fakeFCM(t, http.StatusOK, `{}`)
	if err := sender.Send(NotificationClient{Platform: "android"}, Payload{Title: "T"}); err == nil {
		t.Errorf("expected an error with no fcm token")
	}
	if tokenCalls.Load() != 0 {
		t.Errorf("should not mint a token for a client with nothing to send to")
	}
}
