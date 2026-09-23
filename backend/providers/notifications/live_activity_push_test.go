package notifications

import (
	"testing"
	"time"

	"github.com/sideshow/apns2"
)

func TestLiveActivityAlertSoundIsInsideAlert(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	aps, priority := liveActivityUpdateAPS(map[string]any{}, &activityAlert{Key: "k", Title: "Get off at the next stop", Body: "Newmarket", Sound: true}, nil, nil, now)
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

	aps, _ = liveActivityUpdateAPS(map[string]any{}, &activityAlert{Key: "k", Title: "t", Body: "b"}, nil, nil, now)
	if _, ok := aps["alert"].(map[string]string)["sound"]; ok {
		t.Fatal("no sound when the regular notification already carried it")
	}

	aps, priority = liveActivityUpdateAPS(map[string]any{}, nil, nil, nil, now)
	if _, ok := aps["alert"]; ok || priority != apns2.PriorityLow {
		t.Fatal("routine updates are silent and low priority")
	}
}
