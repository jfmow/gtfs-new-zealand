package notifications

import (
	"testing"
	"time"

	"github.com/sideshow/apns2"
)

func TestLiveActivityAlertSoundIsInsideAlert(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	aps, priority := liveActivityUpdateAPS(map[string]any{}, &activityAlert{Key: "k", Title: "Get off at the next stop", Body: "Newmarket"}, nil, nil, now)
	if priority != apns2.PriorityHigh {
		t.Fatalf("alert push priority = %d, want high", priority)
	}
	if _, ok := aps["sound"]; ok {
		t.Fatal("sound must not be top-level on a Live Activity push (iOS ignores it there)")
	}
	alert, _ := aps["alert"].(map[string]string)
	if alert["sound"] != "default" {
		t.Fatalf("alert.sound = %q, want default", alert["sound"])
	}

	aps, priority = liveActivityUpdateAPS(map[string]any{}, nil, nil, nil, now)
	if _, ok := aps["alert"]; ok || priority != apns2.PriorityLow {
		t.Fatal("routine updates are silent and low priority")
	}
}

func TestQueueLiveActivityAlert(t *testing.T) {
	db := newTestDatabase(t)
	client, err := db.RegisterIOSDevice("22222222-2222-2222-2222-222222222222", "correct-horse-battery-staple", "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}

	reminder := activityAlert{Key: "reminder-leave-5", Title: "Leave in 5 min", Body: "Walk to Newmarket"}
	if db.QueueLiveActivityAlert(client.Id, "plan-1", reminder) {
		t.Fatal("queued with no Live Activity running - the reminder must go out as a banner instead")
	}

	if err := db.CreateLiveActivity(client.Id, "at", "plan-1", "act-1", "token", "sandbox"); err != nil {
		t.Fatalf("CreateLiveActivity: %v", err)
	}
	if !db.QueueLiveActivityAlert(client.Id, "plan-1", reminder) {
		t.Fatal("not queued with the plan's Live Activity running")
	}

	activities, _ := db.GetActiveLiveActivitiesForRegion("at")
	if len(activities) != 1 {
		t.Fatalf("got %d activities, want 1", len(activities))
	}
	got := activities[0].pendingAlert()
	if got == nil || *got != reminder {
		t.Fatalf("pendingAlert = %+v, want %+v", got, reminder)
	}

	// A newer reminder queued after the cron read the old one survives the clear.
	sent := activities[0].PendingAlert
	db.QueueLiveActivityAlert(client.Id, "plan-1", activityAlert{Key: "reminder-leave-0", Title: "Leave now"})
	db.clearPendingAlert(activities[0].Id, sent)
	activities, _ = db.GetActiveLiveActivitiesForRegion("at")
	if got := activities[0].pendingAlert(); got == nil || got.Key != "reminder-leave-0" {
		t.Fatalf("pendingAlert after clear = %+v, want the newer reminder", got)
	}
	db.clearPendingAlert(activities[0].Id, activities[0].PendingAlert)
	activities, _ = db.GetActiveLiveActivitiesForRegion("at")
	if activities[0].pendingAlert() != nil {
		t.Fatal("pending alert not cleared once sent")
	}
}
