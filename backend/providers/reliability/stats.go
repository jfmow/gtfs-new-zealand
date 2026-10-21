package reliability

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// bandFor is the time-of-week band a scheduled time falls in. Weekdays are
// split by the shape of the day (the peaks run late differently from the
// middle of the day); weekends are one band each. Public holidays count as
// the weekday they fall on.
func bandFor(t time.Time) string {
	switch t.Weekday() {
	case time.Saturday:
		return "sat"
	case time.Sunday:
		return "sun"
	}
	switch h := t.Hour(); {
	case h < 7:
		return "wd-early"
	case h < 9:
		return "wd-am"
	case h < 15:
		return "wd-mid"
	case h < 18:
		return "wd-pm"
	default:
		return "wd-eve"
	}
}

// minSamples is how many (decayed) observations a figure needs before it's
// shown - fewer and one bad day reads as the norm.
const minSamples = 8

// Cancellation rates below this aren't worth mentioning.
const cancelNoteFrom = 0.05

// Stat is how a route usually runs at a stop at that time of the week.
type Stat struct {
	// Samples is the (decayed) number of observations behind it.
	Samples int `json:"samples"`
	// OnTimePct counts between 1 min early and 5 min late as on time.
	OnTimePct int `json:"on_time_pct"`
	EarlyPct  int `json:"early_pct"`
	LatePct   int `json:"late_pct"`
	// TypicalMin is the median delay in whole minutes (negative = early).
	TypicalMin int `json:"typical_min"`
	// CancelledPct is the share of the route's trips at that time of the
	// week that were cancelled - nil when not enough trips were seen.
	CancelledPct *int `json:"cancelled_pct,omitempty"`
	// Summary is the headline, ready to show: "Usually on time",
	// "Usually 3-5 min late", "Often early".
	Summary string `json:"summary"`
	// Detail backs it up: "82% on time · 1 in 10 cancelled".
	Detail string `json:"detail"`
	// Level is "good", "fair" or "poor", for colouring.
	Level string `json:"level"`
}

// summarise turns a row into a Stat, or false when there's too little data.
func summarise(a stopAgg, r routeAgg, haveRoute bool) (Stat, bool) {
	if a.n < minSamples {
		return Stat{}, false
	}
	pct := func(v float64) int { return int(math.Round(100 * v / a.n)) }
	early := a.bins[0] + a.bins[1]
	onTime := a.bins[2] + a.bins[3] + a.bins[4]
	late := a.bins[5] + a.bins[6] + a.bins[7]

	median := medianBin(a)
	st := Stat{
		Samples:    int(math.Round(a.n)),
		OnTimePct:  pct(onTime),
		EarlyPct:   pct(early),
		LatePct:    pct(late),
		TypicalMin: int(math.Round(medianSeconds(a) / 60)),
	}
	switch median {
	case 0, 1:
		st.Summary = "Often early"
	case 2:
		st.Summary = "Usually on time"
	case 3:
		st.Summary = "Usually 1–3 min late"
	case 4:
		st.Summary = "Usually 3–5 min late"
	case 5:
		st.Summary = "Usually 5–10 min late"
	case 6:
		st.Summary = "Usually 10–15 min late"
	default:
		st.Summary = "Usually 15+ min late"
	}
	// An early-running service is as easy to miss as a late one is to wait
	// for - more so - so it's never "good".
	switch {
	case st.OnTimePct >= 80 && median >= 2 && median <= 3:
		st.Level = "good"
	case st.OnTimePct >= 60 && median >= 2 && median <= 4:
		st.Level = "fair"
	default:
		st.Level = "poor"
	}
	st.Detail = fmt.Sprintf("%d%% on time", st.OnTimePct)
	if st.EarlyPct >= 15 && median >= 2 {
		st.Detail += fmt.Sprintf(" · %d%% early", st.EarlyPct)
	}

	if haveRoute && r.trips >= minSamples {
		c := int(math.Round(100 * r.cancelled / r.trips))
		st.CancelledPct = &c
		if rate := r.cancelled / r.trips; rate >= cancelNoteFrom {
			st.Detail += " · " + oneIn(rate) + " cancelled"
			if rate >= 0.1 {
				st.Level = "poor"
				// The headline says what's wrong - not "Usually on time" in red.
				if median >= 2 && median <= 3 {
					st.Summary = "Often cancelled"
				}
			} else if st.Level == "good" {
				st.Level = "fair"
			}
		}
	}
	return st, true
}

// oneIn - "1 in 12" for a rate of 0.083.
func oneIn(rate float64) string {
	n := int(math.Round(1 / rate))
	if n < 2 {
		return fmt.Sprintf("%d%%", int(math.Round(100*rate)))
	}
	return fmt.Sprintf("1 in %d", n)
}

// medianBin is the bin holding the middle observation.
func medianBin(a stopAgg) int {
	half, cum := a.n/2, 0.0
	for i, b := range a.bins {
		cum += b
		if cum >= half {
			return i
		}
	}
	return numBins - 1
}

// medianSeconds interpolates the median delay within its bin (the open-ended
// end bins are taken as two minutes wide).
func medianSeconds(a stopAgg) float64 {
	half, cum := a.n/2, 0.0
	for i, b := range a.bins {
		if b > 0 && cum+b >= half {
			lo, hi := binBounds(i)
			return lo + (hi-lo)*(half-cum)/b
		}
		cum += b
	}
	lo, _ := binBounds(numBins - 1)
	return lo
}

func binBounds(i int) (lo, hi float64) {
	switch {
	case i == 0:
		return float64(binEdges[0] - 120), float64(binEdges[0])
	case i == numBins-1:
		return float64(binEdges[numBins-2]), float64(binEdges[numBins-2] + 120)
	default:
		return float64(binEdges[i-1]), float64(binEdges[i])
	}
}

// ForRide is how route usually runs at station (a parent station, or a stop
// with none) at that time of the week - false with too little data. at
// must be in the region's time zone.
func (s *Store) ForRide(region, route, station string, at time.Time) (Stat, bool) {
	band := bandFor(at)
	a, ok := s.stopStats(stopKey{region, route, station, band})
	if !ok {
		return Stat{}, false
	}
	r, haveRoute := s.routeStats(routeKey{region, route, band})
	return summarise(a, r, haveRoute)
}

// ForStop is ForRide for every route seen at station, by route id.
func (s *Store) ForStop(region, station string, at time.Time) map[string]Stat {
	band := bandFor(at)
	out := map[string]Stat{}
	for route, a := range s.stopStatsForStop(region, station, band) {
		r, haveRoute := s.routeStats(routeKey{region, route, band})
		if st, ok := summarise(a, r, haveRoute); ok {
			out[route] = st
		}
	}
	return out
}

// bandOrder is the time-of-week bands in reading order, with how a page
// names them.
var bandOrder = []struct{ band, label string }{
	{"wd-early", "Weekdays before 7am"},
	{"wd-am", "Weekday mornings, 7-9am"},
	{"wd-mid", "Weekdays, 9am-3pm"},
	{"wd-pm", "Weekday afternoons, 3-6pm"},
	{"wd-eve", "Weekday evenings"},
	{"sat", "Saturdays"},
	{"sun", "Sundays"},
}

// BandStat is how a route runs in one time-of-week band.
type BandStat struct {
	Band  string `json:"band"`
	Label string `json:"label"`
	// Stat is nil with too little data.
	Stat *Stat `json:"stat"`
}

// StopStat is how a route runs at one station, across the week.
type StopStat struct {
	StopID   string `json:"stop_id"`
	StopName string `json:"stop_name"`
	Stat     Stat   `json:"stat"`
}

// RouteReport is everything known about a route's running.
type RouteReport struct {
	// Overall is the whole week at every stop (nil with too little data).
	Overall *Stat      `json:"overall"`
	Bands   []BandStat `json:"bands"`
	// LateStops are where it's usually latest, worst first (up to 8).
	LateStops []StopStat `json:"late_stops"`
}

const maxLateStops = 8

// ForRoute reports how route runs, by time of week and by stop. stopName
// names a station id ("" leaves it as the id).
func (s *Store) ForRoute(region, route string, stopName func(string) string) RouteReport {
	report := RouteReport{Bands: []BandStat{}, LateStops: []StopStat{}}
	rows := s.routeRows(region, route)

	var all stopAgg
	byBand := map[string]*stopAgg{}
	byStop := map[string]*stopAgg{}
	for _, r := range rows {
		all.merge(r.agg)
		for _, m := range []struct {
			into map[string]*stopAgg
			key  string
		}{{byBand, r.band}, {byStop, r.stop}} {
			a := m.into[m.key]
			if a == nil {
				a = &stopAgg{}
				m.into[m.key] = a
			}
			a.merge(r.agg)
		}
	}
	trips := s.routeTrips(region, route)
	var allTrips routeAgg
	for _, t := range trips {
		allTrips.trips += t.trips
		allTrips.cancelled += t.cancelled
	}

	if st, ok := summarise(all, allTrips, true); ok {
		report.Overall = &st
	}
	for _, b := range bandOrder {
		bs := BandStat{Band: b.band, Label: b.label}
		if a := byBand[b.band]; a != nil {
			t, haveTrips := trips[b.band]
			if st, ok := summarise(*a, t, haveTrips); ok {
				bs.Stat = &st
			}
		}
		report.Bands = append(report.Bands, bs)
	}
	for stop, a := range byStop {
		if st, ok := summarise(*a, routeAgg{}, false); ok {
			name := stop
			if stopName != nil {
				if n := stopName(stop); n != "" {
					name = n
				}
			}
			report.LateStops = append(report.LateStops, StopStat{StopID: stop, StopName: name, Stat: st})
		}
	}
	sort.Slice(report.LateStops, func(i, j int) bool {
		a, b := report.LateStops[i].Stat, report.LateStops[j].Stat
		if a.TypicalMin != b.TypicalMin {
			return a.TypicalMin > b.TypicalMin
		}
		return a.LatePct > b.LatePct
	})
	if len(report.LateStops) > maxLateStops {
		report.LateStops = report.LateStops[:maxLateStops]
	}
	return report
}

// ForRouteStops is how route runs at each station across the week, by
// station - those with enough data.
func (s *Store) ForRouteStops(region, route string) map[string]Stat {
	byStop := map[string]*stopAgg{}
	for _, r := range s.routeRows(region, route) {
		a := byStop[r.stop]
		if a == nil {
			a = &stopAgg{}
			byStop[r.stop] = a
		}
		a.merge(r.agg)
	}
	out := map[string]Stat{}
	for stop, a := range byStop {
		if st, ok := summarise(*a, routeAgg{}, false); ok {
			out[stop] = st
		}
	}
	return out
}
