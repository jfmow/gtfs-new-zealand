package notifications

import (
	"testing"
	"time"

	"github.com/jfmow/gtfs/realtime/proto"
)

func mustNZ(t *testing.T) *time.Location {
	t.Helper()
	tz, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Fatalf("load tz: %v", err)
	}
	return tz
}

func TestHHMMToUnix(t *testing.T) {
	tz := mustNZ(t)
	got, err := hhmmToUnix("20260904", "09:30", tz)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := time.Date(2026, 9, 4, 9, 30, 0, 0, tz).Unix()
	if got != want {
		t.Fatalf("got %d want %d", got, want)
	}
}

func TestRecurrenceMatches(t *testing.T) {
	tz := mustNZ(t)
	weekdays := "1111100" // Mon..Fri
	fri := time.Date(2026, 9, 4, 12, 0, 0, 0, tz)
	sat := time.Date(2026, 9, 5, 12, 0, 0, 0, tz)
	if !recurrenceMatches(weekdays, fri) {
		t.Errorf("Friday should match weekdays mask")
	}
	if recurrenceMatches(weekdays, sat) {
		t.Errorf("Saturday should not match weekdays mask")
	}
}

func TestFirstJourneyReminderOccurrence(t *testing.T) {
	tz := mustNZ(t)
	// Friday 07:00 - a weekday reminder for 09:00 should fire today.
	now := time.Date(2026, 9, 4, 7, 0, 0, 0, tz)
	sd, tu, err := firstJourneyReminderOccurrence("1111100", "09:00", now, tz)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if sd != "20260904" {
		t.Errorf("service date = %s, want 20260904", sd)
	}
	if tu != time.Date(2026, 9, 4, 9, 0, 0, 0, tz).Unix() {
		t.Errorf("target unix wrong")
	}

	// Friday 10:00 - past today's 09:00, next weekday is Monday.
	now = time.Date(2026, 9, 4, 10, 0, 0, 0, tz)
	sd, _, err = firstJourneyReminderOccurrence("1111100", "09:00", now, tz)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if sd != "20260907" {
		t.Errorf("service date = %s, want 20260907 (Mon)", sd)
	}

	// One-off at 10:00 with target 09:00 today -> tomorrow.
	now = time.Date(2026, 9, 4, 10, 0, 0, 0, tz)
	sd, _, err = firstJourneyReminderOccurrence("", "09:00", now, tz)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if sd != "20260905" {
		t.Errorf("one-off service date = %s, want 20260905", sd)
	}
}

func TestNextJourneyReminderOccurrence(t *testing.T) {
	tz := mustNZ(t)
	r := JourneyReminder{
		Recurrence:  "1111100",
		TargetHHMM:  "09:00",
		ServiceDate: "20260904", // Friday
	}
	sd, tu := nextJourneyReminderOccurrence(r, tz)
	if sd != "20260907" { // Monday
		t.Fatalf("next = %s, want 20260907", sd)
	}
	if tu != time.Date(2026, 9, 7, 9, 0, 0, 0, tz).Unix() {
		t.Errorf("next target unix wrong")
	}

	// Past the recurrence end date -> series over.
	r.RecurrenceUntil = "20260905"
	if sd, _ := nextJourneyReminderOccurrence(r, tz); sd != "" {
		t.Errorf("expected empty (series ended), got %s", sd)
	}
}

func TestJourneyReminderDedupKey(t *testing.T) {
	a := journeyReminderDedupKey(1, -36.84, 174.76, -36.85, 174.77, "arriveat", "09:00", "", "20260904")
	b := journeyReminderDedupKey(1, -36.84, 174.76, -36.85, 174.77, "arriveat", "09:00", "", "20260905")
	if a == b {
		t.Errorf("one-off keys should differ by service date")
	}
	c := journeyReminderDedupKey(1, -36.84, 174.76, -36.85, 174.77, "arriveat", "09:00", "1111100", "20260904")
	d := journeyReminderDedupKey(1, -36.84, 174.76, -36.85, 174.77, "arriveat", "09:00", "1111100", "20260905")
	if c != d {
		t.Errorf("recurring keys should ignore service date")
	}
}

func TestClampJRDelay(t *testing.T) {
	if got := clampJRDelay(5 * 60 * 60); got != jrMaxTrustedDelaySeconds {
		t.Errorf("clamp high: got %d", got)
	}
	if got := clampJRDelay(-30 * 60); got != jrMinTrustedDelaySeconds {
		t.Errorf("clamp low: got %d", got)
	}
	if got := clampJRDelay(120); got != 120 {
		t.Errorf("in-range: got %d", got)
	}
}

func TestBoardStopDelay(t *testing.T) {
	seq := func(n uint32) *uint32 { return &n }
	d := func(n int32) *proto.TripUpdate_StopTimeEvent { return &proto.TripUpdate_StopTimeEvent{Delay: &n} }

	tu := &proto.TripUpdate{
		StopTimeUpdate: []*proto.TripUpdate_StopTimeUpdate{
			{StopSequence: seq(1), Departure: d(30)},
			{StopSequence: seq(5), Departure: d(90)},
			{StopSequence: seq(9), Departure: d(150)},
		},
	}
	// exact match
	if got, skipped := boardStopDelay(tu, 5, ""); got != 90 || skipped {
		t.Errorf("exact seq: got %d skipped=%v", got, skipped)
	}
	// no exact match -> carried from the most recent earlier stop
	if got, _ := boardStopDelay(tu, 7, ""); got != 90 {
		t.Errorf("carried: got %d want 90", got)
	}
	// skipped board stop
	skip := proto.TripUpdate_StopTimeUpdate_SKIPPED
	tu.StopTimeUpdate[1].ScheduleRelationship = &skip
	if _, skipped := boardStopDelay(tu, 5, ""); !skipped {
		t.Errorf("expected skipped=true")
	}
}

func TestLeaveCopy(t *testing.T) {
	depAt := time.Date(2026, 9, 4, 8, 15, 0, 0, mustNZ(t))

	// Journey with a walk to the stop (access > 120s), earlier rung -> "Leave in N".
	title, body := leaveCopy(15, 18, "STH", "Britomart", depAt, 600)
	if title != "Leave in 15 min" || body == "" {
		t.Errorf("earlier rung: got %q / %q", title, body)
	}

	// The "go now" rung never says a bare "now" - it counts down to the departure.
	title, _ = leaveCopy(0, 4, "STH", "Britomart", depAt, 600)
	if title != "Leave now - STH in 4 min" {
		t.Errorf("go-now rung: got %q", title)
	}
	// Floor at 1 min even if the departure countdown lands at 0/negative.
	title, _ = leaveCopy(0, 0, "STH", "Britomart", depAt, 600)
	if title != "Leave now - STH in 1 min" {
		t.Errorf("go-now floor: got %q", title)
	}

	// Catch-this-departure (access <= 120s) -> "Departs in N".
	title, _ = leaveCopy(15, 15, "STH", "Britomart", depAt, 0)
	if title != "Departs in 15 min" {
		t.Errorf("catch-only rung: got %q", title)
	}
	title, _ = leaveCopy(0, 3, "STH", "Britomart", depAt, 0)
	if title != "Departs in 3 min" {
		t.Errorf("catch-only go-now: got %q", title)
	}
}

func TestPruneCarriesURLAndDismissed(t *testing.T) {
	now := time.Now()
	in := []RecentNotificationEntry{
		{ID: "a", SeenAt: now.Unix(), Title: "t", Body: "b", URL: "/plan?x=1", Dismissed: true},
	}
	out := pruneRecentNotificationEntries(in, now)
	if len(out) != 1 || out[0].URL != "/plan?x=1" || !out[0].Dismissed {
		t.Fatalf("prune dropped URL/Dismissed: %+v", out)
	}
}
