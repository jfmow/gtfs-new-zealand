package notifications

import (
	"strings"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	gproto "google.golang.org/protobuf/proto"
)

// changesFixture: a "changes" reminder for testPlan(start) - leave at
// start, the 70 at start+8 - watching from an hour before leaving.
func changesFixture(t *testing.T, start time.Time) (*Database, JourneyReminder, gtfs.JourneyPlan, func(string) (gtfs.JourneyPlan, bool)) {
	t.Helper()
	db := newTestDatabase(t)
	client, err := db.RegisterIOSDevice("55555555-5555-5555-5555-555555555555", "correct-horse-battery-staple", "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5", "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}
	plan := testPlan(start)
	plan.ID = "plan-c"
	id, err := db.UpsertJourneyReminder(JourneyReminder{
		ClientId: client.Id, Region: "at", DedupKey: "c", Kind: "journey_request", Status: "scheduled",
		TimeType: "departat", Offsets: []int{60}, AlertMode: jrAlertChanges, EndLabel: "Work",
		Recurrence: "1111100", Deeplink: "/plan",
		ServiceDate: start.Format("20060102"), TargetUnix: start.Unix(),
	})
	if err != nil {
		t.Fatalf("UpsertJourneyReminder: %v", err)
	}
	dep := start.Add(8 * time.Minute)
	if err := db.UpdateJourneyReminderResolved(int(id), "trip-70", "board", 3, dep.Unix(), 8*60, start.Unix(), "70", "Britomart"); err != nil {
		t.Fatal(err)
	}
	_ = db.SetJourneyReminderPlanID(int(id), plan.ID)
	rows, _ := db.GetArmedJourneyReminders("at")
	if len(rows) != 1 || rows[0].AlertMode != jrAlertChanges {
		t.Fatalf("got %+v", rows)
	}
	lookup := func(string) (gtfs.JourneyPlan, bool) { return plan, true }
	testNotifier.take()
	return db, rows[0], plan, lookup
}

func lateBy(seconds int) liveLegLookup {
	return liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, DepartureDelay: seconds, ArrivalDelay: seconds}})
}

func TestChanges_QuietOnANormalDay(t *testing.T) {
	now := time.Now().In(mustNZ(t)).Truncate(time.Minute)
	start := now.Add(30 * time.Minute)
	db, _, _, lookup := changesFixture(t, start)

	for _, at := range []time.Time{now, start.Add(-5 * time.Minute), start, start.Add(3 * time.Minute)} {
		jrCronNotify(db, nil, lateBy(30), mustNZ(t), "at", lookup, at, nil, nil)
	}
	if sent := testNotifier.take(); len(sent) != 0 {
		t.Fatalf("a normal day should be silent, sent %+v", sent)
	}
	if rows, _ := db.GetArmedJourneyReminders("at"); len(rows) != 0 {
		t.Errorf("should be done after leaving, still armed: %+v", rows[0].Status)
	}
}

func TestChanges_RunningLateSaysTheNewLeaveTime(t *testing.T) {
	tz := mustNZ(t)
	now := time.Now().In(tz).Truncate(time.Minute)
	start := now.Add(30 * time.Minute)
	db, _, _, lookup := changesFixture(t, start)
	sched := start.Add(8 * time.Minute).Format("3:04pm")

	jrCronNotify(db, nil, lateBy(6*60), tz, "at", lookup, now, nil, nil)
	sent := testNotifier.take()
	if len(sent) != 1 || sent[0].Title != "Your "+sched+" 70 is running 6 min late" {
		t.Fatalf("want one late push, got %+v", sent)
	}
	if want := "Leave at " + start.Add(6*time.Minute).Format("3:04pm") + " (in 36 min)."; sent[0].Body != want {
		t.Errorf("body = %q, want %q", sent[0].Body, want)
	}

	// Same again: nothing new to say.
	jrCronNotify(db, nil, lateBy(6*60), tz, "at", lookup, now.Add(30*time.Second), nil, nil)
	if more := testNotifier.take(); len(more) != 0 {
		t.Fatalf("repeated: %+v", more)
	}
	// A minute or two more isn't worth a buzz...
	jrCronNotify(db, nil, lateBy(8*60), tz, "at", lookup, now.Add(time.Minute), nil, nil)
	if more := testNotifier.take(); len(more) != 0 {
		t.Fatalf("2 min more shouldn't push: %+v", more)
	}
	// ...but back on time is.
	jrCronNotify(db, nil, lateBy(0), tz, "at", lookup, now.Add(2*time.Minute), nil, nil)
	sent = testNotifier.take()
	if len(sent) != 1 || sent[0].Title != "Your "+sched+" 70 is back on time" {
		t.Fatalf("want back-on-time push, got %+v", sent)
	}
}

func TestChanges_NotBeforeTheWatchStarts(t *testing.T) {
	tz := mustNZ(t)
	now := time.Now().In(tz).Truncate(time.Minute)
	start := now.Add(2 * time.Hour)
	db, _, _, lookup := changesFixture(t, start)

	jrCronNotify(db, nil, lateBy(10*60), tz, "at", lookup, now, nil, nil)
	if sent := testNotifier.take(); len(sent) != 0 {
		t.Fatalf("2h out with an hour's watch: sent %+v", sent)
	}
	// The delay that's built up is still said once the watch starts.
	jrCronNotify(db, nil, lateBy(10*60), tz, "at", lookup, now.Add(65*time.Minute), nil, nil)
	if sent := testNotifier.take(); len(sent) != 1 || !strings.Contains(sent[0].Title, "10 min late") {
		t.Fatalf("want the late push at the watch start, got %+v", sent)
	}
}

func TestChanges_CancelledThenTheReplacement(t *testing.T) {
	tz := mustNZ(t)
	now := time.Now().In(tz).Truncate(time.Minute)
	start := now.Add(30 * time.Minute)
	db, r, _, lookup := changesFixture(t, start)

	updates := realtime.TripUpdatesMap{"trip-70": &proto.TripUpdate{Trip: &proto.TripDescriptor{
		TripId:               gproto.String("trip-70"),
		ScheduleRelationship: proto.TripDescriptor_CANCELED.Enum(),
	}}}
	jrCronNotify(db, updates, nil, tz, "at", lookup, now, nil, nil)
	sent := testNotifier.take()
	if len(sent) != 1 || !strings.HasSuffix(sent[0].Title, " 70 has been cancelled") {
		t.Fatalf("want one cancelled push, got %+v", sent)
	}
	if rows, _ := db.GetJourneyRemindersToResolve("at", now.Add(time.Minute), 3600, 5); len(rows) != 1 {
		t.Fatalf("should be re-planned on the next tick, got %d to resolve", len(rows))
	}
	if !jrTakeRebooked(r) || jrTakeRebooked(r) {
		t.Error("the cancellation should be remembered once for the replacement push")
	}

	// The replacement's copy.
	next := nextPlan(start.Add(10 * time.Minute))
	next.Legs[0].Route = &gtfs.Route{RouteShortName: "22"}
	title, body, ok := rebookedCopy(next, tz, now)
	if !ok || title != "Take the 22 at "+clock(next.Legs[0].DepartureTime.In(tz))+" instead" || !strings.HasPrefix(body, "Leave at ") || !strings.Contains(body, "for Britomart, arriving ") {
		t.Errorf("title=%q body=%q", title, body)
	}
}

func TestChanges_ServiceAlertOnTheWay(t *testing.T) {
	tz := mustNZ(t)
	now := time.Now().In(tz).Truncate(time.Minute)
	start := now.Add(30 * time.Minute)
	db, _, plan, lookup := changesFixture(t, start)
	plan.Legs[1].RouteID = "70-201"

	alerts := realtime.AlertMap{"a1": alertFor("Buses replace trains", &proto.EntitySelector{RouteId: gproto.String("70-201")})}
	lookup = func(string) (gtfs.JourneyPlan, bool) { return plan, true }
	get := func() realtime.AlertMap { return alerts }

	jrCronNotify(db, nil, lateBy(0), tz, "at", lookup, now, nil, get)
	sent := testNotifier.take()
	if len(sent) != 1 || sent[0].Title != "Service alert on your trip to Work" || sent[0].Body != "Buses replace trains" {
		t.Fatalf("want one alert push, got %+v", sent)
	}
	jrCronNotify(db, nil, lateBy(0), tz, "at", lookup, now.Add(time.Minute), nil, get)
	if more := testNotifier.take(); len(more) != 0 {
		t.Fatalf("repeated: %+v", more)
	}
}

func alertFor(header string, entities ...*proto.EntitySelector) *proto.Alert {
	return &proto.Alert{
		InformedEntity: entities,
		HeaderText:     &proto.TranslatedString{Translation: []*proto.TranslatedString_Translation{{Text: gproto.String(header)}}},
	}
}

func TestCommuteAlerts(t *testing.T) {
	plan := testPlan(base)
	plan.Legs[1].RouteID = "70-201"
	plan.Legs[1].FromStop.ParentStation = "britomart"
	from, to := plan.DepartureTime, plan.ArrivalTime

	noEffect := alertFor("Nothing", &proto.EntitySelector{RouteId: gproto.String("70-201")})
	noEffect.Effect = proto.Alert_NO_EFFECT.Enum()
	ended := alertFor("Was yesterday", &proto.EntitySelector{RouteId: gproto.String("70-201")})
	ended.ActivePeriod = []*proto.TimeRange{{Start: gproto.Uint64(uint64(base.Add(-48 * time.Hour).Unix())), End: gproto.Uint64(uint64(base.Add(-24 * time.Hour).Unix()))}}
	ongoing := alertFor("Lift out of order", &proto.EntitySelector{StopId: gproto.String("britomart")})
	ongoing.ActivePeriod = []*proto.TimeRange{{Start: gproto.Uint64(uint64(base.Add(-time.Hour).Unix()))}}

	alerts := realtime.AlertMap{
		"route":     alertFor("Detour", &proto.EntitySelector{RouteId: gproto.String("70-201")}),
		"trip":      alertFor("Cancelled", &proto.EntitySelector{Trip: &proto.TripDescriptor{TripId: gproto.String("trip-70")}}),
		"station":   ongoing,
		"elsewhere": alertFor("Other route", &proto.EntitySelector{RouteId: gproto.String("NX1")}),
		"otherbus":  alertFor("Other bus at our stop", &proto.EntitySelector{StopId: gproto.String("board"), RouteId: gproto.String("NX1")}),
		"noeffect":  noEffect,
		"ended":     ended,
	}
	got := map[string]bool{}
	for _, a := range commuteAlerts(alerts, plan, from, to) {
		got[a.ID] = true
	}
	for _, want := range []string{"route", "trip", "station"} {
		if !got[want] {
			t.Errorf("missing %q", want)
		}
	}
	for _, not := range []string{"elsewhere", "otherbus", "noeffect", "ended"} {
		if got[not] {
			t.Errorf("shouldn't include %q", not)
		}
	}
}
