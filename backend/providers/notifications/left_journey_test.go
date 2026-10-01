package notifications

import (
	"database/sql"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
)

// ── Live Activity: once the rider has set off ────────────────────────────────

// testPlan: walk 9:00-9:05 to Britomart, the 70 leaves 9:08.
func TestActivity_OnTheWayShowsSpareTimeNotALeaveTime(t *testing.T) {
	left := activityHint{LegIndex: 0, Phase: "walking", LeftUnix: base.Add(-2 * time.Minute).Unix()}
	state := computeJourneyActivityState(testPlan(base), base.Add(time.Minute), nil, left)
	if state.LegIndex != 0 || state.Phase != "walking" {
		t.Fatalf("want the walk, got leg %d %s", state.LegIndex, state.Phase)
	}
	if state.PrimaryText != "Walk to Britomart" || state.Urgent {
		t.Errorf("primary=%q urgent=%t - no leave wording once on the way", state.PrimaryText, state.Urgent)
	}
	// Left 8:58 + 5 min walk = 9:03 at the stop, 5 min before 9:08.
	if !strings.Contains(state.SecondaryText, "5 min spare") {
		t.Errorf("secondary=%q, want the spare time", state.SecondaryText)
	}
	if state.alert != nil {
		t.Errorf("no alert on the way, got %+v", state.alert)
	}
	if int64(state.SegmentStartUnix) != left.LeftUnix {
		t.Errorf("the walk should run from when they left")
	}
}

func TestActivity_OnTheWayRideRunningEarlyNoLeaveTimeChange(t *testing.T) {
	// Left on time at 9:00; the 70 now leaves 9:02 - before the 9:05 arrival.
	left := activityHint{LegIndex: 0, Phase: "walking", LeftUnix: base.Unix()}
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, DepartureDelay: -360, ArrivalDelay: -360, StopsToBoard: 3, StopsToAlight: 9}})
	state := computeJourneyActivityState(testPlan(base), base.Add(time.Minute), live, left)
	if state.Status != "missedConnection" || !strings.HasPrefix(state.SecondaryText, "You'll likely miss the 70") {
		t.Errorf("status=%q secondary=%q", state.Status, state.SecondaryText)
	}
	if state.alert == nil || state.alert.Key != "missed-first-1" || !state.alert.isSettingOff() {
		t.Fatalf("want a missed-first alert that also goes out as a notification, got %+v", state.alert)
	}
	if !strings.Contains(state.alert.Body, "running 6 min early") {
		t.Errorf("alert should say why: %q", state.alert.Body)
	}
	if strings.Contains(state.PrimaryText, "Leave") {
		t.Errorf("primary=%q - never a leave time once on the way", state.PrimaryText)
	}
}

// ── Live Activity: still at the start, and the phone can see it ──────────────

func TestActivity_WatchingKeepsLeaveNowWhileCatchable(t *testing.T) {
	atStart := activityHint{LegIndex: 0, Phase: "walking", Watching: true}
	// 9:02:30 - well past the leave time, still makes 9:08.
	state := computeJourneyActivityState(testPlan(base), base.Add(150*time.Second), nil, atStart)
	if state.PrimaryText != "Leave now" || !state.Urgent {
		t.Errorf("primary=%q urgent=%t", state.PrimaryText, state.Urgent)
	}
	// 9:03 - the end of leaveNowShownFor, but 9:03 + a 5 min walk still
	// makes 9:08: it stays up while the phone sees them at home.
	held := computeJourneyActivityState(testPlan(base), base.Add(3*time.Minute), nil, atStart)
	if held.PrimaryText != "Leave now" {
		t.Errorf("at 9:03, still at home: primary=%q, want Leave now", held.PrimaryText)
	}
	unknown := computeJourneyActivityState(testPlan(base), base.Add(3*time.Minute+10*time.Second), nil, noHint)
	if unknown.PrimaryText == "Leave now" {
		t.Errorf("without the phone watching, Leave now still ends after leaveNowShownFor")
	}
}

func TestActivity_WatchingRideGoneEarlySaysTooLate(t *testing.T) {
	// The user's case: the leave time was ahead, then the ride ran early and
	// the new leave time is already past - too late to walk there.
	atStart := activityHint{LegIndex: 0, Phase: "walking", Watching: true}
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, DepartureDelay: -300, ArrivalDelay: -300, StopsToBoard: 2, StopsToAlight: 8}})
	// Ride now 9:03; walk to it 5 min - from 8:59 on it can't be made.
	state := computeJourneyActivityState(testPlan(base), base.Add(-30*time.Second), live, atStart)
	if state.PrimaryText != "Too late for the 70" || state.Status != "missedConnection" || state.Urgent {
		t.Errorf("primary=%q status=%q urgent=%t", state.PrimaryText, state.Status, state.Urgent)
	}
	if state.alert == nil || state.alert.Key != "missed-first-1" || state.alert.Title != "You'll miss the 70" {
		t.Fatalf("want the missed alert, got %+v", state.alert)
	}

	// Not watching: the server can't tell they're at home - no claim.
	blind := computeJourneyActivityState(testPlan(base), base.Add(-30*time.Second), live, noHint)
	if blind.alert != nil && blind.alert.Key == "missed-first-1" {
		t.Errorf("no missed alert when nobody knows where the rider is")
	}
}

func TestActivity_WatchingHoldsTheWalkUntilTheRideGoes(t *testing.T) {
	// 9:06 - the walk's planned arrival (9:05) has passed but the phone
	// says they're still at the start: not "Board the 70".
	atStart := activityHint{LegIndex: 0, Phase: "walking", Watching: true}
	state := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), nil, atStart)
	if state.LegIndex != 0 || state.Phase != "walking" {
		t.Errorf("want the walk held, got leg %d %s", state.LegIndex, state.Phase)
	}
	// Once the ride has gone, back to the clock.
	after := computeJourneyActivityState(testPlan(base), base.Add(9*time.Minute), nil, atStart)
	if after.LegIndex == 0 {
		t.Errorf("hold should end once the ride's departed")
	}
}

// ── The next way to go ───────────────────────────────────────────────────────

func nextPlan(at time.Time) gtfs.JourneyPlan {
	route := &gtfs.Route{RouteShortName: "70"}
	return gtfs.JourneyPlan{
		ID: "next plan", DepartureTime: at, ArrivalTime: at.Add(25 * time.Minute),
		Legs: []gtfs.JourneyLeg{{
			Mode: "transit", TripID: "trip-70-next", Route: route,
			FromStop: &gtfs.Stop{StopId: "board", StopName: "Britomart"}, ToStop: &gtfs.Stop{StopId: "alight", StopName: "Newmarket"},
			DepartureTime: at.Add(5 * time.Minute), ArrivalTime: at.Add(25 * time.Minute),
		}},
	}
}

func TestOfferNextJourney(t *testing.T) {
	plan := testPlan(base)
	plan.StartLat, plan.StartLon = -36.9, 174.7
	plan.Legs[1].FromStop.StopLat, plan.Legs[1].FromStop.StopLon = -36.8, 174.8

	var gotLat float64
	var gotAt time.Time
	var gotMissed string
	find := func(_ gtfs.JourneyPlan, lat, _ float64, at time.Time, missed string) (gtfs.JourneyPlan, bool) {
		gotLat, gotAt, gotMissed = lat, at, missed
		return nextPlan(at), true
	}

	// Still at home: from the start, a minute from now.
	alert := &activityAlert{Key: "missed-first-1", Title: "You'll miss the 70", Body: "It leaves at 9:03."}
	offerNextJourney(alert, "a:1", plan, activityHint{Watching: true}, "auckland", time.UTC, base, find)
	if gotLat != plan.StartLat || !gotAt.Equal(base.Add(time.Minute)) || gotMissed != "trip-70" {
		t.Errorf("planned from %v at %v avoiding %q", gotLat, gotAt, gotMissed)
	}
	if alert.URL != "/journey?id=next+plan&region=auckland&track=1" {
		t.Errorf("url = %q - tapping it should open the new journey", alert.URL)
	}
	if !strings.Contains(alert.Body, "Next: the 70 at 9:06am from Britomart, arriving 9:26am.") || alert.TapHint != "Tap to switch to it." {
		t.Errorf("body=%q tap=%q", alert.Body, alert.TapHint)
	}

	// On the way: from the stop, once they'll be there (left 8:58 + 5 min).
	alert = &activityAlert{Key: "missed-first-1", Body: "x"}
	offerNextJourney(alert, "b:1", plan, activityHint{LeftUnix: base.Add(-2 * time.Minute).Unix()}, "auckland", time.UTC, base, find)
	if gotLat != -36.8 || !gotAt.Equal(base.Add(3*time.Minute)) {
		t.Errorf("on the way: planned from %v at %v, want the stop at 9:03", gotLat, gotAt)
	}

	// Cached: a retry doesn't plan again.
	calls := 0
	counting := func(p gtfs.JourneyPlan, lat, lon float64, at time.Time, missed string) (gtfs.JourneyPlan, bool) {
		calls++
		return find(p, lat, lon, at, missed)
	}
	again := &activityAlert{Key: "missed-first-1", Body: "x"}
	offerNextJourney(again, "b:1", plan, activityHint{}, "auckland", time.UTC, base.Add(20*time.Second), counting)
	if calls != 0 || again.URL == "" {
		t.Errorf("retry re-planned (%d calls) or lost the offer (%q)", calls, again.URL)
	}

	// Nothing found: just say so.
	none := &activityAlert{Key: "missed-first-1", Body: "x"}
	offerNextJourney(none, "c:1", plan, activityHint{}, "auckland", time.UTC, base, func(gtfs.JourneyPlan, float64, float64, time.Time, string) (gtfs.JourneyPlan, bool) {
		return gtfs.JourneyPlan{}, false
	})
	if none.URL != "" || none.TapHint != "Tap to find another way." {
		t.Errorf("url=%q tap=%q", none.URL, none.TapHint)
	}
}

func TestPickNextJourneySkipsTheMissedRide(t *testing.T) {
	missed := nextPlan(base)
	missed.ID, missed.Legs[0].TripID = "missed", "trip-70"
	later := nextPlan(base.Add(10 * time.Minute))
	if got, ok := pickNextJourney([]gtfs.JourneyPlan{missed, later}, base, "trip-70"); !ok || got.ID != later.ID {
		t.Errorf("got %q ok=%t, want the later journey", got.ID, ok)
	}
}

// ── Storage ──────────────────────────────────────────────────────────────────

func TestLiveActivityDepartureIsSticky(t *testing.T) {
	db := newTestDatabase(t)
	client, err := db.RegisterIOSDevice("33333333-3333-3333-3333-333333333333", "correct-horse-battery-staple", "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3", "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}
	if err := db.CreateLiveActivity(client.Id, "at", "plan-1", "act-1", "token", "sandbox"); err != nil {
		t.Fatalf("CreateLiveActivity: %v", err)
	}
	now := time.Now()
	if exists, left, watching := db.LiveActivityDeparture(client.Id, "plan-1", now); !exists || left != 0 || watching {
		t.Errorf("before any report: exists=%t left=%d watching=%t - an app that never says isn't watching", exists, left, watching)
	}

	db.UpdateLiveActivityLeg(client.Id, "act-1", 0, "walking", false, 0)
	if _, left, watching := db.LiveActivityDeparture(client.Id, "plan-1", now); left != 0 || !watching {
		t.Errorf("reported at the start: left=%d watching=%t", left, watching)
	}
	if _, _, watching := db.LiveActivityDeparture(client.Id, "plan-1", now.Add(departureWatchWindow+time.Second)); watching {
		t.Errorf("a stale report isn't watching any more")
	}

	db.UpdateLiveActivityLeg(client.Id, "act-1", 0, "walking", false, 1_700_000_000)
	db.UpdateLiveActivityLeg(client.Id, "act-1", 0, "walking", false, 0) // late, out of order
	if _, left, _ := db.LiveActivityDeparture(client.Id, "plan-1", now); left != 1_700_000_000 {
		t.Errorf("left = %d - once set off it stays set", left)
	}
	if exists, _, _ := db.LiveActivityDeparture(client.Id, "other-plan", now); exists {
		t.Errorf("no activity for another plan")
	}
}

// ── Reminders ────────────────────────────────────────────────────────────────

type recordingNotifier struct {
	mu   sync.Mutex
	sent []Payload
}

func (n *recordingNotifier) Send(_ NotificationClient, p Payload) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.sent = append(n.sent, p)
	return nil
}

func (n *recordingNotifier) take() []Payload {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := n.sent
	n.sent = nil
	return out
}

var testNotifier = func() *recordingNotifier {
	n := &recordingNotifier{}
	sharedNotifierOnce.Do(func() {})
	sharedNotifierVal = n
	return n
}()

// reminderFixture: a reminder for testPlan(start) whose ladder has started
// ("leave in 5" sent), its leave time `start` still ahead of now.
func reminderFixture(t *testing.T, start time.Time) (*Database, *NotificationClient, JourneyReminder, gtfs.JourneyPlan) {
	t.Helper()
	db := newTestDatabase(t)
	client, err := db.RegisterIOSDevice("44444444-4444-4444-4444-444444444444", "correct-horse-battery-staple", "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4", "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}
	plan := testPlan(start)
	plan.ID = "plan-1"
	id, err := db.UpsertJourneyReminder(JourneyReminder{
		ClientId: client.Id, Region: "at", DedupKey: "k", Kind: "fixed_trip", Status: "scheduled",
		TimeType: "departat", Offsets: []int{5, 0}, Deeplink: "/journey?id=plan-1&region=at",
		ServiceDate: start.Format("20060102"), TargetUnix: start.Unix(),
	})
	if err != nil {
		t.Fatalf("UpsertJourneyReminder: %v", err)
	}
	dep := start.Add(8 * time.Minute)
	if err := db.UpdateJourneyReminderResolved(int(id), "trip-70", "board", 3, dep.Unix(), 8*60, start.Unix(), "70", "Britomart"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateJourneyReminderState(int(id), "notifying", []int{5}, start.Unix()); err != nil {
		t.Fatal(err)
	}
	rows, _ := db.GetArmedJourneyReminders("at")
	if len(rows) != 1 {
		t.Fatalf("got %d armed reminders", len(rows))
	}
	r := rows[0]
	r.BoardTripID = sql.NullString{String: "trip-70", Valid: true}
	return db, client, r, plan
}

func earlyBy(seconds int) liveLegLookup {
	return liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, DepartureDelay: -seconds, ArrivalDelay: -seconds}})
}

func TestReminder_LeaveTimeJumpsIntoThePast_LeaveNow(t *testing.T) {
	now := time.Now().In(mustNZ(t)).Truncate(time.Minute)
	start := now.Add(2 * time.Minute) // "leave in 5" sent; leave at +2
	db, _, _, plan := reminderFixture(t, start)
	lookup := func(string) (gtfs.JourneyPlan, bool) { return plan, true }
	testNotifier.take()

	// Running 3 min early: leave time now -1 min, ride +7, an 8 min walk
	// + buffer - still makeable by leaving now.
	jrCronNotify(db, nil, earlyBy(180), mustNZ(t), "at", lookup, now, nil)
	sent := testNotifier.take()
	if len(sent) != 1 || sent[0].Title != "Leave now for the 70" || !strings.Contains(sent[0].Body, "running 3 min early") {
		t.Fatalf("want one leave-now push, got %+v", sent)
	}
	rows, _ := db.GetArmedJourneyReminders("at")
	if len(rows) == 1 && !containsInt(rows[0].SentOffsets, 0) {
		t.Errorf("the 0 rung should be marked sent, got %v", rows[0].SentOffsets)
	}
	// Nothing more on the next tick.
	jrCronNotify(db, nil, earlyBy(180), mustNZ(t), "at", lookup, now.Add(30*time.Second), nil)
	if more := testNotifier.take(); len(more) != 0 {
		t.Errorf("repeated: %+v", more)
	}
}

func TestReminder_LeaveTimeJumpsIntoThePast_TooLateOffersNext(t *testing.T) {
	now := time.Now().In(mustNZ(t)).Truncate(time.Minute)
	start := now.Add(2 * time.Minute)
	db, _, _, plan := reminderFixture(t, start)
	lookup := func(string) (gtfs.JourneyPlan, bool) { return plan, true }
	testNotifier.take()

	find := func(_ gtfs.JourneyPlan, _, _ float64, at time.Time, missed string) (gtfs.JourneyPlan, bool) {
		if missed != "trip-70" {
			t.Errorf("should avoid the missed ride, got %q", missed)
		}
		return nextPlan(at), true
	}
	// 6 min early: the ride's at +4, an 8 min walk away.
	jrCronNotify(db, nil, earlyBy(360), mustNZ(t), "at", lookup, now, find)
	sent := testNotifier.take()
	if len(sent) != 1 || sent[0].Title != "You'll miss the 70" {
		t.Fatalf("want one missed push, got %+v", sent)
	}
	if sent[0].URL != "/journey?id=next+plan&region=at&track=1" || !strings.Contains(sent[0].Body, "Tap to switch to it.") {
		t.Errorf("url=%q body=%q - tapping should open the next journey", sent[0].URL, sent[0].Body)
	}
}

func TestReminder_NothingAboutLeavingOnceOnTheWay(t *testing.T) {
	now := time.Now().In(mustNZ(t)).Truncate(time.Minute)
	start := now.Add(2 * time.Minute)
	db, client, _, plan := reminderFixture(t, start)
	lookup := func(string) (gtfs.JourneyPlan, bool) { return plan, true }
	if err := db.CreateLiveActivity(client.Id, "at", "plan-1", "act-1", "token", "sandbox"); err != nil {
		t.Fatal(err)
	}
	db.UpdateLiveActivityLeg(client.Id, "act-1", 0, "walking", false, now.Add(-3*time.Minute).Unix())
	testNotifier.take()

	jrCronNotify(db, nil, earlyBy(180), mustNZ(t), "at", lookup, now, nil)
	jrCronNotify(db, nil, earlyBy(180), mustNZ(t), "at", lookup, now.Add(3*time.Minute), nil)
	if sent := testNotifier.take(); len(sent) != 0 {
		t.Errorf("sent %+v to a rider already on the way", sent)
	}
	activities, _ := db.GetActiveLiveActivitiesForRegion("at")
	if len(activities) == 1 && activities[0].pendingAlert() != nil {
		t.Errorf("queued %+v on the card for a rider already on the way", activities[0].pendingAlert())
	}
}
