package notifications

import (
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
)

func TestIsValidPushEndpoint(t *testing.T) {
	accept := []string{
		"https://fcm.googleapis.com/fcm/send/abc:def",
		"https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
		"https://web.push.apple.com/QAbc",
		"https://db5p.notify.windows.com/w/?token=abc",
	}
	for _, u := range accept {
		if !isValidPushEndpoint(u) {
			t.Errorf("rejected real push endpoint %q", u)
		}
	}
	reject := []string{
		"http://fcm.googleapis.com/fcm/send/abc",       // not https
		"https://fcm.googleapis.com:8443/fcm/send/abc", // explicit port
		"https://user@fcm.googleapis.com/fcm/send/abc", // userinfo
		"https://fcm.googleapis.com.example.org/x",     // suffix trick
		"https://notify.windows.com.example.org/x",
		"https://127.0.0.1/x",
		"https://localhost/x",
		"https://169.254.169.254/latest",
		"https://10.0.0.5/",
		"https://192.168.1.1/",
		"https://push.example/abc",
		"ftp://fcm.googleapis.com/x",
		"https://fcm.googleapis.com/" + strings.Repeat("a", maxPushEndpointLen),
	}
	for _, u := range reject {
		if isValidPushEndpoint(u) {
			t.Errorf("accepted non-push endpoint %q", u)
		}
	}
}

func TestCreateAndRefreshRejectNonPushEndpoints(t *testing.T) {
	db := newTestDatabase(t)
	if _, err := db.CreateNotificationClient("https://127.0.0.1/x", "p256dh-value-1", "auth-value-1", gtfs.Database{}); err == nil {
		t.Fatal("CreateNotificationClient accepted a loopback endpoint")
	}

	client, err := db.CreateNotificationClient("https://fcm.googleapis.com/fcm/send/ok", "p256dh-value-1", "auth-value-1", gtfs.Database{})
	if err != nil {
		t.Fatalf("CreateNotificationClient(real endpoint): %v", err)
	}
	for _, bad := range []Notification{
		{Endpoint: "https://10.0.0.5/x", P256dh: "p256dh-value-2", Auth: "auth-value-2"},
		{Endpoint: "https://fcm.googleapis.com/fcm/send/new", P256dh: "not base64!!", Auth: "auth-value-2"},
		{Endpoint: "", P256dh: "", Auth: ""},
	} {
		if err := client.RefreshSubscription(bad); err == nil {
			t.Errorf("RefreshSubscription accepted %+v", bad)
		}
	}
	if err := client.RefreshSubscription(Notification{Endpoint: "https://fcm.googleapis.com/fcm/send/new", P256dh: "p256dh-value-2", Auth: "auth-value-2"}); err != nil {
		t.Errorf("RefreshSubscription(real endpoint): %v", err)
	}
}

func TestInputLimitHelpers(t *testing.T) {
	if got := truncateRunes(strings.Repeat("é", 300), maxReminderLabelRunes); len([]rune(got)) != maxReminderLabelRunes {
		t.Errorf("truncateRunes kept %d runes", len([]rune(got)))
	}
	if got := truncateRunes("Britomart", maxReminderLabelRunes); got != "Britomart" {
		t.Errorf("truncateRunes changed a short label: %q", got)
	}

	for _, p := range []string{"/journey?id=abc", "/plan"} {
		if !isAppPath(p) {
			t.Errorf("isAppPath(%q) = false", p)
		}
	}
	for _, p := range []string{"//evil.example/x", "/\\evil.example", "https://evil.example", "plan", "/" + strings.Repeat("a", maxDeeplinkBytes)} {
		if isAppPath(p) {
			t.Errorf("isAppPath(%q) = true", p)
		}
	}

	if validLatLon(math.NaN(), 174) || validLatLon(-36, math.Inf(1)) || validLatLon(91, 0) || validLatLon(0, 181) {
		t.Error("validLatLon accepted an invalid coordinate")
	}
	if !validLatLon(-36.84, 174.76) {
		t.Error("validLatLon rejected Auckland")
	}

	if ClampMaxWalkKm(1000) != MaxPlannerWalkKm || ClampMaxWalkKm(math.NaN()) != MaxPlannerWalkKm || ClampMaxWalkKm(2) != 2 {
		t.Error("ClampMaxWalkKm")
	}
	if ClampMaxTransfers(1000) != MaxPlannerTransfers || ClampMaxTransfers(3) != 3 {
		t.Error("ClampMaxTransfers")
	}
}

// One client's backlog must not fill the whole per-tick resolve budget.
func TestGetJourneyRemindersToResolve_RoundRobinsClients(t *testing.T) {
	db := newTestDatabase(t)
	base := time.Now()

	heavy, err := db.CreateNotificationClient("https://fcm.googleapis.com/fcm/send/heavy", "p256dh-heavy-1", "auth-heavy-1", gtfs.Database{})
	if err != nil {
		t.Fatal(err)
	}
	light, err := db.CreateNotificationClient("https://fcm.googleapis.com/fcm/send/light", "p256dh-light-1", "auth-light-1", gtfs.Database{})
	if err != nil {
		t.Fatal(err)
	}
	add := func(clientID int, key string, target time.Time) {
		t.Helper()
		if _, err := db.UpsertJourneyReminder(JourneyReminder{
			ClientId: clientID, Region: "at", DedupKey: key, Kind: "journey_request", Status: "pending_resolve",
			TimeType: "departat", Offsets: []int{15}, Deeplink: "/plan", TargetUnix: target.Unix(),
		}); err != nil {
			t.Fatalf("UpsertJourneyReminder: %v", err)
		}
	}
	for i := 0; i < 10; i++ {
		add(heavy.Id, fmt.Sprintf("heavy-%d", i), base.Add(time.Duration(10+i)*time.Minute))
	}
	add(light.Id, "light", base.Add(90*time.Minute))

	// Past the 600 s per-row throttle.
	rows, err := db.GetJourneyRemindersToResolve("at", base.Add(11*time.Minute), 4*3600, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	clients := map[int]bool{rows[0].ClientId: true, rows[1].ClientId: true}
	if !clients[light.Id] || !clients[heavy.Id] {
		t.Errorf("resolve batch = clients %v, want one row each from heavy (%d) and light (%d)", clients, heavy.Id, light.Id)
	}
}
