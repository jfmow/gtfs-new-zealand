package notifications

import (
	"encoding/json"
	"testing"
	"time"
)

func TestActivityEnvFor(t *testing.T) {
	android := &NotificationClient{Platform: "android"}
	ios := &NotificationClient{Platform: "ios", ApnsEnv: "production"}
	cases := []struct {
		client    *NotificationClient
		requested string
		want      string
	}{
		{android, "", fcmActivityEnv},
		{android, "sandbox", fcmActivityEnv},
		{ios, "sandbox", "sandbox"},
		{ios, "", "production"},
		// An iOS device can't make its activity an FCM one.
		{ios, fcmActivityEnv, "production"},
	}
	for _, c := range cases {
		if got := activityEnvFor(c.client, c.requested); got != c.want {
			t.Errorf("activityEnvFor(%s, %q) = %q, want %q", c.client.Platform, c.requested, got, c.want)
		}
	}
}

func TestFcmLiveMessage(t *testing.T) {
	away := 2
	state := tripActivityState{Version: 1, Phase: "coming", TargetUnix: 1000, StopsAway: &away}
	end := time.Unix(1234, 0)
	msg, err := fcmLiveMessage(testFcmToken, activityKindTrip, "android-trip-1", state, &activityAlert{Title: "Get off next stop", Body: "Ponsonby", Silent: true}, &end)
	if err != nil {
		t.Fatal(err)
	}
	m := msg["message"].(map[string]any)
	if _, has := m["notification"]; has {
		t.Fatalf("a live update must be data-only, so the app draws it")
	}
	data := m["data"].(map[string]string)
	if data["transit"] != "live" || data["kind"] != "trip" || data["activityId"] != "android-trip-1" {
		t.Fatalf("data = %v", data)
	}
	if data["alertTitle"] != "Get off next stop" || data["alertSilent"] != "1" || data["end"] != "1234" {
		t.Fatalf("alert/end = %v", data)
	}
	var back tripActivityState
	if err := json.Unmarshal([]byte(data["state"]), &back); err != nil || back.Phase != "coming" || back.StopsAway == nil || *back.StopsAway != 2 {
		t.Fatalf("state round trip = %+v, %v", back, err)
	}
	android := m["android"].(map[string]any)
	if android["priority"] != "HIGH" || android["collapse_key"] != "live-android-trip-1" {
		t.Fatalf("android = %v", android)
	}

	// No alert, no end: neither key is sent.
	msg, _ = fcmLiveMessage(testFcmToken, activityKindJourney, "a", state, nil, nil)
	data = msg["message"].(map[string]any)["data"].(map[string]string)
	for _, k := range []string{"alertTitle", "alertBody", "alertSilent", "end"} {
		if _, has := data[k]; has {
			t.Errorf("unexpected %q in %v", k, data)
		}
	}
}

// An Android activity row is pushed with the device's FCM token as it is
// now - a rotated token reaches running activities without re-registering.
func TestAndroidActivityUsesDevicesCurrentFcmToken(t *testing.T) {
	db := newTestDatabase(t)
	client, err := db.RegisterAndroidDevice("33333333-3333-3333-3333-333333333333", "android-secret-long-enough", testFcmToken)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.CreateLiveActivity(client.Id, "at", "plan-1", "android-journey-1", "fcm", activityEnvFor(client, "")); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateTripLiveActivity(TripLiveActivity{ClientId: client.Id, Region: "at", TripId: "trip-1", StopId: "stop-1", Kind: "arrival", ActivityId: "android-trip-1", PushToken: "fcm", ApnsEnv: fcmActivityEnv}); err != nil {
		t.Fatal(err)
	}

	check := func(want string) {
		t.Helper()
		journeys, err := db.GetActiveLiveActivitiesForRegion("at")
		if err != nil || len(journeys) != 1 {
			t.Fatalf("journeys = %v, %v", journeys, err)
		}
		if journeys[0].PushToken != want || journeys[0].ApnsEnv != fcmActivityEnv {
			t.Errorf("journey token %q env %q, want %q fcm", journeys[0].PushToken, journeys[0].ApnsEnv, want)
		}
		trip, ok := db.TripLiveActivityFor(client.Id, "trip-1")
		if !ok || trip.PushToken != want || trip.ApnsEnv != fcmActivityEnv {
			t.Errorf("trip = %+v, want token %q", trip, want)
		}
	}
	check(testFcmToken)

	rotated := testFcmToken + "-rotated"
	if err := db.setAndroidDeviceFcm(client.Id, rotated); err != nil {
		t.Fatal(err)
	}
	check(rotated)

	// Token cleared (dead): nothing to push to - the crons skip an empty token.
	if err := db.setAndroidDeviceFcm(client.Id, ""); err != nil {
		t.Fatal(err)
	}
	check("")
}
