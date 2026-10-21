package reliability

import (
	"math"
	"sort"
	"strings"
	"time"
)

// ── A route through the day ──────────────────────────────────────────────────

// HourStat is how a route runs in one hour of a day type.
type HourStat struct {
	Hour int `json:"hour"`
	// Samples is the (decayed) number of observations - 0 when none.
	Samples int `json:"samples"`
	// TypicalMin is the median delay in minutes; OnTimePct as in Stat.
	// Both only with enough samples.
	TypicalMin *float64 `json:"typical_min,omitempty"`
	OnTimePct  *int     `json:"on_time_pct,omitempty"`
	// TripsPerDay is how many trips started that hour on an average day of
	// the type, from live data (nil before a full day's been seen).
	TripsPerDay *float64 `json:"trips_per_day,omitempty"`
}

// ForRouteHours is route's day, hour by hour, for a day type ("wd", "sat",
// "sun").
func (s *Store) ForRouteHours(region, route, dayType string) []HourStat {
	out := make([]HourStat, 24)
	for h := range out {
		out[h].Hour = h
	}
	if s == nil {
		return out
	}
	var weight float64
	_ = s.db.QueryRow(`SELECT weight FROM day_weights WHERE region = ? AND day_type = ?`, region, dayType).Scan(&weight)
	rows, err := s.db.Query(`SELECT hour, `+strings.Join(aggCols, ", ")+`, trips FROM route_hours
		WHERE region = ? AND route_id = ? AND day_type = ?`, region, route, dayType)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var hour int
		var h hourAgg
		if rows.Scan(append(append([]any{&hour}, h.dest()...), &h.trips)...) != nil || hour < 0 || hour > 23 {
			continue
		}
		hs := &out[hour]
		hs.Samples = int(math.Round(h.n))
		if h.n >= minSamples {
			m := math.Round(medianSeconds(h.stopAgg)/6) / 10
			p := int(math.Round(100 * (h.bins[2] + h.bins[3] + h.bins[4]) / h.n))
			hs.TypicalMin, hs.OnTimePct = &m, &p
		}
		if weight >= 1 {
			t := math.Round(10*h.trips/weight) / 10
			hs.TripsPerDay = &t
		}
	}
	return out
}

// ── Trends ───────────────────────────────────────────────────────────────────

// Period is a route's day or week.
type Period struct {
	// Start is the date ("2006-01-02") - the Monday, for a week.
	Start        string `json:"start"`
	Samples      int    `json:"samples"`
	OnTimePct    *int   `json:"on_time_pct,omitempty"`
	CancelledPct *int   `json:"cancelled_pct,omitempty"`
	Trips        int    `json:"trips"`
}

// Trend is a route's running over time: its last days, and weeks going back
// up to two years.
type Trend struct {
	Days  []Period `json:"days"`
	Weeks []Period `json:"weeks"`
}

const (
	trendDays  = 28
	trendWeeks = 52
	// A day or week needs this many observations to give an on-time figure.
	minPeriodSamples = 20
)

func periodOf(start string, d dayAgg) Period {
	p := Period{Start: start, Samples: int(math.Round(d.n)), Trips: int(math.Round(d.trips))}
	if d.n >= minPeriodSamples {
		v := int(math.Round(100 * (d.bins[2] + d.bins[3] + d.bins[4]) / d.n))
		p.OnTimePct = &v
	}
	if d.trips >= minPeriodSamples {
		v := int(math.Round(100 * d.cancelled / d.trips))
		p.CancelledPct = &v
	}
	return p
}

// ForRouteTrend is route's trend, oldest first. Weeks still in route_days
// (the last 8) are summed from their days.
func (s *Store) ForRouteTrend(region, route string, now time.Time) Trend {
	t := Trend{Days: []Period{}, Weeks: []Period{}}
	if s == nil {
		return t
	}
	cols := strings.Join(append(append([]string{}, aggCols...), "trips", "cancelled"), ", ")
	weeks := map[string]*dayAgg{}
	addWeek := func(week string, d dayAgg) {
		w := weeks[week]
		if w == nil {
			w = &dayAgg{}
			weeks[week] = w
		}
		w.merge(d.stopAgg)
		w.trips += d.trips
		w.cancelled += d.cancelled
	}

	fromDay := now.AddDate(0, 0, -trendDays).Format("2006-01-02")
	if rows, err := s.db.Query(`SELECT date, `+cols+` FROM route_days WHERE region = ? AND route_id = ? ORDER BY date`, region, route); err == nil {
		for rows.Next() {
			var date string
			var d dayAgg
			if rows.Scan(append(append([]any{&date}, d.dest()...), &d.trips, &d.cancelled)...) != nil {
				continue
			}
			addWeek(weekOf(date), d)
			if date >= fromDay {
				t.Days = append(t.Days, periodOf(date, d))
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query(`SELECT week, `+cols+` FROM route_weeks WHERE region = ? AND route_id = ?`, region, route); err == nil {
		for rows.Next() {
			var week string
			var d dayAgg
			if rows.Scan(append(append([]any{&week}, d.dest()...), &d.trips, &d.cancelled)...) != nil {
				continue
			}
			addWeek(week, d)
		}
		rows.Close()
	}
	keys := make([]string, 0, len(weeks))
	for k := range weeks {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > trendWeeks {
		keys = keys[len(keys)-trendWeeks:]
	}
	for _, k := range keys {
		t.Weeks = append(t.Weeks, periodOf(k, *weeks[k]))
	}
	return t
}

// ── League table ─────────────────────────────────────────────────────────────

// LeagueRow is one route over the last week.
type LeagueRow struct {
	RouteID      string `json:"route_id"`
	Samples      int    `json:"samples"`
	OnTimePct    int    `json:"on_time_pct"`
	LatePct      int    `json:"late_pct"`
	CancelledPct int    `json:"cancelled_pct"`
	Trips        int    `json:"trips"`
}

const (
	leagueDays = 7
	// A route needs this many observations in the week to be ranked.
	leagueMinSamples = 50
)

// League is every route with enough data over the last week.
func (s *Store) League(region string, now time.Time) []LeagueRow {
	out := []LeagueRow{}
	if s == nil {
		return out
	}
	from := now.AddDate(0, 0, -leagueDays).Format("2006-01-02")
	cols := strings.Join(append(append([]string{}, aggCols...), "trips", "cancelled"), ", ")
	rows, err := s.db.Query(`SELECT route_id, `+cols+` FROM route_days WHERE region = ? AND date >= ?`, region, from)
	if err != nil {
		return out
	}
	defer rows.Close()
	byRoute := map[string]*dayAgg{}
	for rows.Next() {
		var route string
		var d dayAgg
		if rows.Scan(append(append([]any{&route}, d.dest()...), &d.trips, &d.cancelled)...) != nil {
			continue
		}
		a := byRoute[route]
		if a == nil {
			a = &dayAgg{}
			byRoute[route] = a
		}
		a.merge(d.stopAgg)
		a.trips += d.trips
		a.cancelled += d.cancelled
	}
	for route, a := range byRoute {
		if a.n < leagueMinSamples {
			continue
		}
		row := LeagueRow{
			RouteID:   route,
			Samples:   int(math.Round(a.n)),
			OnTimePct: int(math.Round(100 * (a.bins[2] + a.bins[3] + a.bins[4]) / a.n)),
			LatePct:   int(math.Round(100 * (a.bins[5] + a.bins[6] + a.bins[7]) / a.n)),
			Trips:     int(math.Round(a.trips)),
		}
		if a.trips > 0 {
			row.CancelledPct = int(math.Round(100 * a.cancelled / a.trips))
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].OnTimePct != out[j].OnTimePct {
			return out[i].OnTimePct > out[j].OnTimePct
		}
		return out[i].RouteID < out[j].RouteID
	})
	return out
}

// ── Alerts ───────────────────────────────────────────────────────────────────

// LoggedAlert is a service alert seen on a route in the last 8 weeks.
type LoggedAlert struct {
	ID        string `json:"id"`
	Header    string `json:"header"`
	Effect    string `json:"effect"`
	Cause     string `json:"cause"`
	FirstSeen int64  `json:"first_seen"`
	LastSeen  int64  `json:"last_seen"`
}

// AlertWeek is how many alerts named a route in a week, and for how long.
type AlertWeek struct {
	Week   string  `json:"week"`
	Alerts int     `json:"alerts"`
	Hours  float64 `json:"hours"`
}

// AlertHistory is a route's alerts: the recent ones in full, and a weekly
// count going back up to two years.
type AlertHistory struct {
	Recent []LoggedAlert `json:"recent"`
	Weeks  []AlertWeek   `json:"weeks"`
}

// ForRouteAlerts is route's alert history, newest first for Recent and
// oldest first for Weeks.
func (s *Store) ForRouteAlerts(region, route string) AlertHistory {
	h := AlertHistory{Recent: []LoggedAlert{}, Weeks: []AlertWeek{}}
	if s == nil {
		return h
	}
	weeks := map[string]*AlertWeek{}
	if rows, err := s.db.Query(`SELECT alert_id, header, effect, cause, first_seen, last_seen, routes FROM alert_log
		WHERE region = ? AND (',' || routes || ',') LIKE ? ORDER BY first_seen DESC`, region, "%,"+route+",%"); err == nil {
		for rows.Next() {
			var a LoggedAlert
			var routes string
			if rows.Scan(&a.ID, &a.Header, &a.Effect, &a.Cause, &a.FirstSeen, &a.LastSeen, &routes) != nil {
				continue
			}
			h.Recent = append(h.Recent, a)
			week := weekOf(time.Unix(a.FirstSeen, 0).UTC().Format("2006-01-02"))
			w := weeks[week]
			if w == nil {
				w = &AlertWeek{Week: week}
				weeks[week] = w
			}
			w.Alerts++
			w.Hours += float64(a.LastSeen-a.FirstSeen) / 3600
		}
		rows.Close()
	}
	if rows, err := s.db.Query(`SELECT week, alerts, hours FROM alert_weeks WHERE region = ? AND route_id = ?`, region, route); err == nil {
		for rows.Next() {
			var w AlertWeek
			if rows.Scan(&w.Week, &w.Alerts, &w.Hours) != nil {
				continue
			}
			if cur := weeks[w.Week]; cur != nil {
				cur.Alerts += w.Alerts
				cur.Hours += w.Hours
			} else {
				ww := w
				weeks[w.Week] = &ww
			}
		}
		rows.Close()
	}
	for _, w := range weeks {
		w.Hours = math.Round(w.Hours*10) / 10
		h.Weeks = append(h.Weeks, *w)
	}
	sort.Slice(h.Weeks, func(i, j int) bool { return h.Weeks[i].Week < h.Weeks[j].Week })
	if len(h.Recent) > 20 {
		h.Recent = h.Recent[:20]
	}
	return h
}

// ── Waiting ──────────────────────────────────────────────────────────────────

// Wait compares the timetable's average wait with what it really is, for a
// rider turning up at random at a frequent service.
type Wait struct {
	// HeadwayMin is the timetable's gap between services.
	HeadwayMin float64 `json:"headway_min"`
	// TimetableWaitMin is half that - the wait if every service ran to time.
	TimetableWaitMin float64 `json:"timetable_wait_min"`
	// RealWaitMin allows for services running unevenly.
	RealWaitMin float64 `json:"real_wait_min"`
}

// Only worth saying for a service frequent enough to turn up for.
const maxWaitHeadway = 15 * time.Minute

// waitFor: with services every H on the timetable and delays of variance
// v, the gaps between them have variance ~2v (delays independent), and a
// rider turning up at random waits E[gap^2] / 2E[gap] = H/2 + v/H on
// average.
func waitFor(headway time.Duration, a stopAgg) (Wait, bool) {
	if headway <= 0 || headway > maxWaitHeadway || a.n < minSamples {
		return Wait{}, false
	}
	h := headway.Seconds()
	real := h/2 + a.variance()/h
	round := func(sec float64) float64 { return math.Round(sec/6) / 10 }
	return Wait{HeadwayMin: round(h), TimetableWaitMin: round(h / 2), RealWaitMin: round(real)}, true
}

// WaitAt is route's wait at station around at, given the timetable headway.
func (s *Store) WaitAt(region, route, station string, at time.Time, headway time.Duration) (Wait, bool) {
	a, ok := s.stopStats(stopKey{region, route, station, bandFor(at)})
	if !ok {
		return Wait{}, false
	}
	return waitFor(headway, a)
}

// ── Making a connection ──────────────────────────────────────────────────────

// Connection is how often a change between two rides works out.
type Connection struct {
	// Chance is 0-1.
	Chance float64 `json:"chance"`
	// Summary - "Works 9 times in 10".
	Summary string `json:"summary"`
	Level   string `json:"level"` // good | fair | poor
}

// minChange is the least time a change can be made in.
const minChange = 30 * time.Second

// ConnectionOdds is the chance of making a change from ride A (arriving at
// stationA, scheduled atA) to ride B (leaving stationB, scheduled atB) with
// slack to spare on the timetable once the walk is taken off - from how
// each usually runs there. False without enough data for both.
func (s *Store) ConnectionOdds(region, routeA, stationA string, atA time.Time, routeB, stationB string, atB time.Time, slack time.Duration) (Connection, bool) {
	a, okA := s.stopStats(stopKey{region, routeA, stationA, bandFor(atA)})
	b, okB := s.stopStats(stopKey{region, routeB, stationB, bandFor(atB)})
	if !okA || !okB || a.n < minSamples || b.n < minSamples {
		return Connection{}, false
	}
	p := makeChance(a, b, slack-minChange)
	c := Connection{Chance: math.Round(p*100) / 100}
	switch n := int(math.Round(p * 10)); {
	case p >= 0.995:
		c.Summary, c.Level = "Almost always works", "good"
	case n >= 9:
		c.Summary, c.Level = "Works 9 times in 10", "good"
	case n >= 7:
		c.Summary, c.Level = fmtTimesIn10(n), "fair"
	case n >= 1:
		c.Summary, c.Level = fmtTimesIn10(n), "poor"
	default:
		c.Summary, c.Level = "Rarely works", "poor"
	}
	return c, true
}

func fmtTimesIn10(n int) string {
	return "Works " + []string{"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"}[n] + " times in 10"
}

// makeChance is P(delayB - delayA >= -slack): ride B leaves no earlier than
// ride A arrives (plus the change), treating each histogram bin as an even
// spread of delays across it.
func makeChance(a, b stopAgg, slack time.Duration) float64 {
	pa, pb := spread(a), spread(b)
	need := -slack.Seconds()
	var p float64
	for _, x := range pa {
		for _, y := range pb {
			if y.delay-x.delay >= need {
				p += x.weight * y.weight
			}
		}
	}
	return math.Min(1, math.Max(0, p))
}

type weighted struct{ delay, weight float64 }

// spread turns a histogram into evenly weighted points across each bin.
func spread(a stopAgg) []weighted {
	const perBin = 12
	var out []weighted
	if a.n <= 0 {
		return out
	}
	for i, c := range a.bins {
		if c <= 0 {
			continue
		}
		lo, hi := binBounds(i)
		w := c / a.n / perBin
		for k := 0; k < perBin; k++ {
			out = append(out, weighted{lo + (hi-lo)*(float64(k)+0.5)/perBin, w})
		}
	}
	return out
}
