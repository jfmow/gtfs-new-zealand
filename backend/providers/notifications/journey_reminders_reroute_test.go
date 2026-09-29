package notifications

import "testing"

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
