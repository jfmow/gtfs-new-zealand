package reliability

import (
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/jfmow/gtfs/realtime/proto"
	gproto "google.golang.org/protobuf/proto"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "r.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestVarianceAndWait(t *testing.T) {
	a := aggOf(-120, 120, -120, 120, -120, 120, -120, 120, -120, 120)
	if v := a.variance(); math.Abs(v-14400) > 1 {
		t.Fatalf("variance = %v", v)
	}
	// Every 10 min, delays +-2 min: wait 5 + 14400/600 s = 5.4 min.
	w, ok := waitFor(10*time.Minute, a)
	if !ok || w.TimetableWaitMin != 5 || w.RealWaitMin != 5.4 || w.HeadwayMin != 10 {
		t.Errorf("wait = %+v ok=%t", w, ok)
	}
	if _, ok := waitFor(30*time.Minute, a); ok {
		t.Error("an infrequent service gets no wait figure")
	}
}

func TestConnectionOdds(t *testing.T) {
	onTime := aggOf(repeat(20, 0)...)
	late := aggOf(repeat(20, 420)...) // 7 min late
	// Plenty of slack: always.
	if p := makeChance(onTime, onTime, 5*time.Minute); p < 0.99 {
		t.Errorf("5 min slack with both on time: %v", p)
	}
	// Arriving 7 min late with 3 min slack: never.
	if p := makeChance(late, onTime, 3*time.Minute); p > 0.01 {
		t.Errorf("late arrival: %v", p)
	}
	// Both late by much the same: with a bin's width (5 min) of slack,
	// always.
	if p := makeChance(late, late, 5*time.Minute); p < 0.99 {
		t.Errorf("both equally late: %v", p)
	}

	s := openTest(t)
	at := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	b := newBatch()
	b.stops[stopKey{"at", "A", "x", bandFor(at)}] = &late
	b.stops[stopKey{"at", "B", "x", bandFor(at)}] = &onTime
	if err := s.flush(b); err != nil {
		t.Fatal(err)
	}
	c, ok := s.ConnectionOdds("at", "A", "x", at, "B", "x", at.Add(5*time.Minute), 5*time.Minute)
	if !ok || c.Level != "poor" {
		t.Errorf("A 7 min late to B on time with 5 min: %+v ok=%t", c, ok)
	}
	if _, ok := s.ConnectionOdds("at", "A", "x", at, "C", "x", at, time.Minute); ok {
		t.Error("no data for C: no odds")
	}
}

func TestRecorderFillsHoursDaysAndWeights(t *testing.T) {
	tz := nz(t)
	now := time.Date(2026, 10, 19, 8, 30, 0, 0, tz)
	rec := newRecorder("at", tz, testLookups())
	b := rec.observe(map[string]*protoTU{"t1": tripUpdate("t1", "70", now.Add(-20*time.Minute), stu(5, "platform-2", now.Add(-time.Minute), 240))}, now)
	if h := b.hours[hourKey{"at", "70", "wd", 8}]; h == nil || h.n != 1 {
		t.Errorf("hour row: %+v", b.hours)
	}
	if d := b.days[dayKey{"at", "70", "2026-10-19"}]; d == nil || d.n != 1 || d.trips != 1 {
		t.Errorf("day row: %+v", b.days)
	}
	if b.weights[weightKey{"at", "wd"}] != 1 {
		t.Errorf("weights: %+v", b.weights)
	}
}

func TestTrendLeagueAndRollup(t *testing.T) {
	s := openTest(t)
	now := time.Date(2026, 10, 21, 20, 0, 0, 0, time.UTC)
	b := newBatch()
	good := dayAgg{stopAgg: aggOf(repeat(60, 0)...), trips: 30}
	poor := dayAgg{stopAgg: aggOf(append(repeat(30, 0), repeat(30, 600)...)...), trips: 30, cancelled: 3}
	b.days[dayKey{"at", "70", "2026-10-20"}] = &good
	b.days[dayKey{"at", "NX1", "2026-10-20"}] = &poor
	old := good
	b.days[dayKey{"at", "70", "2026-07-01"}] = &old // > 8 weeks back
	if err := s.flush(b); err != nil {
		t.Fatal(err)
	}

	league := s.League("at", now)
	if len(league) != 2 || league[0].RouteID != "70" || league[0].OnTimePct != 100 || league[1].CancelledPct != 10 {
		t.Fatalf("league = %+v", league)
	}

	// Roll up: the July day becomes a week; the recent one stays a day.
	s.mu.Lock()
	err := s.rollupLocked(now)
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var days, weeks int
	s.db.QueryRow(`SELECT COUNT(*) FROM route_days`).Scan(&days)
	s.db.QueryRow(`SELECT COUNT(*) FROM route_weeks`).Scan(&weeks)
	if days != 2 || weeks != 1 {
		t.Errorf("after rollup: %d days, %d weeks", days, weeks)
	}
	tr := s.ForRouteTrend("at", "70", now)
	if len(tr.Days) != 1 || len(tr.Weeks) != 2 || tr.Weeks[0].Start != "2026-06-29" || *tr.Weeks[1].OnTimePct != 100 {
		t.Errorf("trend = %+v", tr)
	}
}

func TestAlertsLogAndHistory(t *testing.T) {
	s := openTest(t)
	now := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	alerts := map[string]*protoAlert{"a1": routeAlert("Detour on Queen St", "70")}
	if err := s.logAlerts("at", alerts, now, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.logAlerts("at", alerts, now.Add(2*time.Hour), nil); err != nil {
		t.Fatal(err)
	}
	h := s.ForRouteAlerts("at", "70")
	if len(h.Recent) != 1 || h.Recent[0].Header != "Detour on Queen St" || h.Recent[0].LastSeen-h.Recent[0].FirstSeen != 7200 {
		t.Fatalf("recent = %+v", h.Recent)
	}
	if len(h.Weeks) != 1 || h.Weeks[0].Alerts != 1 || h.Weeks[0].Hours != 2 {
		t.Errorf("weeks = %+v", h.Weeks)
	}
	if other := s.ForRouteAlerts("at", "7"); len(other.Recent) != 0 {
		t.Error("route 7 shouldn't match route 70's alert")
	}

	// Months on, it's a weekly count only.
	s.mu.Lock()
	err := s.rollupLocked(now.AddDate(0, 3, 0))
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	h = s.ForRouteAlerts("at", "70")
	if len(h.Recent) != 0 || len(h.Weeks) != 1 || h.Weeks[0].Alerts != 1 {
		t.Errorf("after rollup: %+v", h)
	}
}

func TestHourProfile(t *testing.T) {
	s := openTest(t)
	b := newBatch()
	h := hourAgg{stopAgg: aggOf(repeat(10, 240)...), trips: 8}
	b.hours[hourKey{"at", "70", "wd", 8}] = &h
	b.weights[weightKey{"at", "wd"}] = 2
	if err := s.flush(b); err != nil {
		t.Fatal(err)
	}
	hours := s.ForRouteHours("at", "70", "wd")
	if len(hours) != 24 || hours[8].Samples != 10 || hours[8].TripsPerDay == nil || *hours[8].TripsPerDay != 4 || hours[8].TypicalMin == nil {
		t.Errorf("8am = %+v", hours[8])
	}
	if hours[9].Samples != 0 || hours[9].TypicalMin != nil {
		t.Errorf("9am = %+v", hours[9])
	}
}

type protoTU = proto.TripUpdate
type protoAlert = proto.Alert

func routeAlert(header, route string) *proto.Alert {
	return &proto.Alert{
		InformedEntity: []*proto.EntitySelector{{RouteId: gproto.String(route)}},
		HeaderText:     &proto.TranslatedString{Translation: []*proto.TranslatedString_Translation{{Text: gproto.String(header)}}},
	}
}
