package notifications

import (
	"testing"
	"time"
)

func TestReminderURLFollowsSwitchedPlan(t *testing.T) {
	r := JourneyReminder{Deeplink: "/journey?id=old-plan&region=auckland", PlanID: "new plan"}
	if got, want := reminderURL(r), "/journey?id=new+plan&region=auckland"; got != want {
		t.Fatalf("reminderURL = %q, want %q", got, want)
	}
	r.PlanID = ""
	if got := reminderURL(r); got != r.Deeplink {
		t.Fatalf("without a plan id reminderURL = %q, want the deeplink", got)
	}
	recurring := JourneyReminder{Deeplink: "/plan?startLat=1", PlanID: "p"}
	if got := reminderURL(recurring); got != recurring.Deeplink {
		t.Fatalf("recurring reminderURL = %q, want the planner link", got)
	}
}

// A bus on the road running 4 min early: the reminder's leave time is the
// Live Activity's (not clamped to 3 min early), so "leave in 5" and the
// card's countdown agree (2026-09-30).
func TestPlanLiveLeaveMatchesLiveActivity(t *testing.T) {
	plan := testPlan(base)
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, DepartureDelay: -240, ArrivalDelay: -240}})
	dep, leave, ok := planLiveLeave(plan, live, "trip-70")
	if !ok {
		t.Fatal("want a leave time")
	}
	state := computeJourneyActivityState(plan, base.Add(-10*time.Minute), live, noHint)
	if int64(state.TargetUnix) != leave.Unix() {
		t.Errorf("reminder leave %v, card leave-by %v", leave.UTC(), time.Unix(int64(state.TargetUnix), 0).UTC())
	}
	if !dep.Equal(base.Add(4 * time.Minute)) {
		t.Errorf("depart = %v, want 9:04 (4 min early, unclamped)", dep.UTC())
	}
	if _, _, ok := planLiveLeave(plan, live, "another-trip"); ok {
		t.Error("a switched boarding trip must fall back to the reminder's own maths")
	}
}
