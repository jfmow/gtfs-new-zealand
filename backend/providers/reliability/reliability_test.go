package reliability

import (
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	gproto "google.golang.org/protobuf/proto"
)

func nz(t *testing.T) *time.Location {
	t.Helper()
	tz, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Fatal(err)
	}
	return tz
}

func TestBinFor(t *testing.T) {
	for _, c := range []struct{ delay, bin int }{
		{-300, 0}, {-120, 1}, {-61, 1}, {-60, 2}, {0, 2}, {59, 2}, {60, 3},
		{179, 3}, {180, 4}, {299, 4}, {300, 5}, {600, 6}, {899, 6}, {900, 7}, {5000, 7},
	} {
		if got := binFor(c.delay); got != c.bin {
			t.Errorf("binFor(%d) = %d, want %d", c.delay, got, c.bin)
		}
	}
}

func TestBandFor(t *testing.T) {
	tz := nz(t)
	mon := time.Date(2026, 10, 19, 0, 0, 0, 0, tz) // a Monday
	for _, c := range []struct {
		at   time.Time
		band string
	}{
		{mon.Add(6 * time.Hour), "wd-early"},
		{mon.Add(7*time.Hour + 30*time.Minute), "wd-am"},
		{mon.Add(12 * time.Hour), "wd-mid"},
		{mon.Add(17 * time.Hour), "wd-pm"},
		{mon.Add(21 * time.Hour), "wd-eve"},
		{mon.AddDate(0, 0, 5).Add(8 * time.Hour), "sat"},
		{mon.AddDate(0, 0, 6).Add(8 * time.Hour), "sun"},
	} {
		if got := bandFor(c.at); got != c.band {
			t.Errorf("bandFor(%v) = %s, want %s", c.at, got, c.band)
		}
	}
}

func aggOf(delays ...int) stopAgg {
	var a stopAgg
	for _, d := range delays {
		a.add(d)
	}
	return a
}

func repeat(n, delay int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = delay
	}
	return out
}

func TestSummarise(t *testing.T) {
	if _, ok := summarise(aggOf(0, 0, 0), routeAgg{}, false); ok {
		t.Error("3 samples shouldn't be enough")
	}

	onTime := aggOf(append(repeat(18, 30), repeat(2, 400)...)...)
	st, ok := summarise(onTime, routeAgg{}, false)
	if !ok || st.Summary != "Usually on time" || st.OnTimePct != 90 || st.Level != "good" || st.Detail != "90% on time" {
		t.Errorf("on time: %+v", st)
	}

	late := aggOf(append(repeat(12, 240), repeat(8, 30)...)...)
	st, _ = summarise(late, routeAgg{}, false)
	if st.Summary != "Usually 3–5 min late" || st.Level != "fair" || st.TypicalMin < 2 || st.TypicalMin > 5 {
		t.Errorf("late: %+v", st)
	}

	early := aggOf(append(repeat(12, -150), repeat(8, 0)...)...)
	st, _ = summarise(early, routeAgg{}, false)
	if st.Summary != "Often early" || st.Level != "poor" || st.TypicalMin >= 0 {
		t.Errorf("early: %+v", st)
	}

	// On time, but 1 in 8 trips cancelled.
	st, _ = summarise(onTime, routeAgg{trips: 40, cancelled: 5}, true)
	if st.CancelledPct == nil || *st.CancelledPct != 13 || st.Summary != "Often cancelled" || st.Detail != "90% on time · 1 in 8 cancelled" || st.Level != "poor" {
		t.Errorf("cancellations: %+v", st)
	}
	// A rare cancellation isn't mentioned.
	st, _ = summarise(onTime, routeAgg{trips: 100, cancelled: 1}, true)
	if st.Detail != "90% on time" || st.Level != "good" {
		t.Errorf("rare cancellation: %+v", st)
	}
}

func stu(seq uint32, stop string, at time.Time, delay int32) *proto.TripUpdate_StopTimeUpdate {
	return &proto.TripUpdate_StopTimeUpdate{
		StopSequence: gproto.Uint32(seq),
		StopId:       gproto.String(stop),
		Departure:    &proto.TripUpdate_StopTimeEvent{Time: gproto.Int64(at.Unix()), Delay: gproto.Int32(delay)},
	}
}

func tripUpdate(id, route string, start time.Time, stus ...*proto.TripUpdate_StopTimeUpdate) *proto.TripUpdate {
	return &proto.TripUpdate{
		Trip: &proto.TripDescriptor{
			TripId:    gproto.String(id),
			RouteId:   gproto.String(route),
			StartDate: gproto.String(start.Format("20060102")),
			StartTime: gproto.String(start.Format("15:04:05")),
		},
		StopTimeUpdate: stus,
	}
}

func testLookups() lookups {
	return lookups{
		routeForTrip: func(string) string { return "" },
		stopAt:       func(string, uint32) string { return "" },
		station: func(stop string) string {
			if stop == "platform-2" {
				return "britomart"
			}
			return stop
		},
	}
}

func TestRecorderObserve(t *testing.T) {
	tz := nz(t)
	now := time.Date(2026, 10, 19, 8, 30, 0, 0, tz) // Monday morning peak
	rec := newRecorder("at", tz, testLookups())

	updates := realtime.TripUpdatesMap{
		// Passed platform 2 a minute ago, 4 min late; the next stop's still
		// a prediction.
		"t1": tripUpdate("t1", "70", now.Add(-20*time.Minute),
			stu(5, "platform-2", now.Add(-time.Minute), 240),
			stu(6, "next", now.Add(2*time.Minute), 240)),
		// Not started yet: AT publishes these too.
		"t2": tripUpdate("t2", "70", now.Add(10*time.Minute), stu(1, "a", now.Add(-time.Minute), 0)),
		// An observation from long ago.
		"t3": tripUpdate("t3", "NX1", now.Add(-time.Hour), stu(9, "b", now.Add(-30*time.Minute), 60)),
		// Cancelled, starting soon.
		"t4": func() *proto.TripUpdate {
			tu := tripUpdate("t4", "70", now.Add(20*time.Minute))
			tu.Trip.ScheduleRelationship = proto.TripDescriptor_CANCELED.Enum()
			return tu
		}(),
	}
	b := rec.observe(updates, now)
	stops, routes := b.stops, b.routes
	if len(stops) != 1 {
		t.Fatalf("want one observation, got %+v", stops)
	}
	a := stops[stopKey{"at", "70", "britomart", "wd-am"}]
	if a == nil || a.n != 1 || a.delaySum != 240 || a.bins[4] != 1 {
		t.Errorf("observation = %+v", a)
	}
	if r := routes[routeKey{"at", "70", "wd-am"}]; r == nil || r.trips != 2 || r.cancelled != 1 {
		t.Errorf("route trips = %+v", r)
	}

	// The same stop again next tick isn't counted twice; the next one is.
	b = rec.observe(updates, now.Add(30*time.Second))
	stops, routes = b.stops, b.routes
	if len(stops) != 0 || len(routes) != 0 {
		t.Errorf("recounted: %+v %+v", stops, routes)
	}
	updates["t1"] = tripUpdate("t1", "70", now.Add(-20*time.Minute), stu(6, "next", now.Add(time.Minute), 300))
	stops = rec.observe(updates, now.Add(2*time.Minute)).stops
	if a := stops[stopKey{"at", "70", "next", "wd-am"}]; a == nil || a.delaySum != 300 {
		t.Errorf("next stop: %+v", stops)
	}
}

func TestStoreRoundTripAndDecay(t *testing.T) {
	tz := nz(t)
	s, err := Open(filepath.Join(t.TempDir(), "r.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	at := time.Date(2026, 10, 19, 8, 0, 0, 0, tz)
	agg := aggOf(append(repeat(9, 30), 400)...)
	k := stopKey{"at", "70", "britomart", bandFor(at)}
	if err := s.flush(&batch{stops: map[stopKey]*stopAgg{k: &agg}, routes: map[routeKey]*routeAgg{{"at", "70", bandFor(at)}: {trips: 10}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.flush(&batch{stops: map[stopKey]*stopAgg{k: &agg}}); err != nil {
		t.Fatal(err)
	}

	st, ok := s.ForRide("at", "70", "britomart", at)
	if !ok || st.Samples != 20 || st.OnTimePct != 90 || st.CancelledPct == nil || *st.CancelledPct != 0 {
		t.Fatalf("ForRide = %+v ok=%t", st, ok)
	}
	if got := s.ForStop("at", "britomart", at); len(got) != 1 || got["70"].Samples != 20 {
		t.Errorf("ForStop = %+v", got)
	}
	if _, ok := s.ForRide("at", "70", "britomart", at.Add(5*time.Hour)); ok {
		t.Error("another band has no data")
	}
	if _, ok := s.ForRide("wel", "70", "britomart", at); ok {
		t.Error("another region has no data")
	}

	// First run just stamps the day; three days later everything fades by
	// three days' worth.
	day0 := time.Date(2026, 10, 19, 16, 0, 0, 0, time.UTC)
	if err := s.decay(day0); err != nil {
		t.Fatal(err)
	}
	if a, _ := s.stopStats(k); a.n != 20 {
		t.Fatalf("first decay changed n to %v", a.n)
	}
	if err := s.decay(day0.Add(3 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	a, _ := s.stopStats(k)
	if want := 20 * math.Pow(decayPerDay, 3); math.Abs(a.n-want) > 1e-6 {
		t.Errorf("n = %v, want %v", a.n, want)
	}
	// Same day again: no further fade.
	s.decay(day0.Add(3*24*time.Hour + time.Hour))
	if b, _ := s.stopStats(k); b.n != a.n {
		t.Errorf("decayed twice in a day: %v -> %v", a.n, b.n)
	}
	// Months on, it's gone.
	s.decay(day0.Add(200 * 24 * time.Hour))
	if _, ok := s.stopStats(k); ok {
		t.Error("a long-faded row should be pruned")
	}
}

func TestForRoute(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "r.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	onTime := aggOf(repeat(10, 30)...)
	late := aggOf(repeat(10, 420)...)
	stops := map[stopKey]*stopAgg{
		{"at", "70", "britomart", "wd-am"}: &onTime,
		{"at", "70", "panmure", "wd-am"}:   &late,
		{"at", "70", "panmure", "sat"}:     &late,
		{"at", "NX1", "panmure", "wd-am"}:  &late, // another route
	}
	if err := s.flush(&batch{stops: stops, routes: map[routeKey]*routeAgg{{"at", "70", "wd-am"}: {trips: 20, cancelled: 4}}}); err != nil {
		t.Fatal(err)
	}

	r := s.ForRoute("at", "70", func(id string) string {
		if id == "panmure" {
			return "Panmure Station"
		}
		return ""
	})
	if r.Overall == nil || r.Overall.Samples != 30 {
		t.Fatalf("overall = %+v", r.Overall)
	}
	if len(r.Bands) != 7 || r.Bands[1].Band != "wd-am" || r.Bands[1].Stat == nil || r.Bands[0].Stat != nil {
		t.Fatalf("bands = %+v", r.Bands)
	}
	if am := r.Bands[1].Stat; am.Samples != 20 || am.CancelledPct == nil || *am.CancelledPct != 20 {
		t.Errorf("weekday morning = %+v", am)
	}
	if sat := r.Bands[5].Stat; sat == nil || sat.Summary != "Usually 5–10 min late" {
		t.Errorf("saturday = %+v", sat)
	}
	if len(r.LateStops) != 2 || r.LateStops[0].StopName != "Panmure Station" || r.LateStops[1].StopName != "britomart" {
		t.Errorf("late stops, worst first, named where known: %+v", r.LateStops)
	}

	if empty := s.ForRoute("at", "nope", nil); empty.Overall != nil || len(empty.LateStops) != 0 || len(empty.Bands) != 7 {
		t.Errorf("unknown route: %+v", empty)
	}
}
