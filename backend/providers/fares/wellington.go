package fares

import (
	"strconv"
	"strings"
	"time"

	"github.com/jfmow/gtfs"
)

// Metlink. 14 concentric fare zones out from the city centre (zone 1); a
// trip pays for the zones it passes through, each counted once, so it's
// the span of zone numbers the trip covers. Stops on a boundary ("1/2")
// count as either. Snapper bus-to-bus transfers within 30 min (up to five
// rides) are one fare; buses and trains are separate fares, as is each
// train. Off-peak is 20% less. Cable car, ferry and Airport Express have
// their own fares and aren't estimated.
//
// Prices from 15 May 2026 (Snapper / contactless, adult):
// https://www.metlink.org.nz/getting-started/tickets-and-fares
var (
	wellingtonPeakCents    = [...]int{0, 212, 350, 467, 524, 639, 813, 923, 1031, 1163, 1278, 1465, 1574, 1736, 1850}
	wellingtonOffPeakCents = [...]int{0, 170, 280, 374, 419, 511, 650, 738, 825, 930, 1022, 1172, 1259, 1389, 1480}
)

type wellington struct{ deps Deps }

var wellingtonTransfers = transferRule{
	window:   30 * time.Minute,
	maxRides: 5,
	joins: func(prev, next gtfs.JourneyLeg) bool {
		return isBus(routeType(prev)) && isBus(routeType(next))
	},
}

func (w wellington) Estimate(plan gtfs.JourneyPlan, c Concession) (Estimate, bool) {
	applied := c
	if !offers("wel", c) {
		applied = Adult
	}
	groups, partial := group(plan, wellingtonTransfers, func(leg gtfs.JourneyLeg) bool {
		t := routeType(leg)
		if leg.Route != nil && strings.EqualFold(leg.Route.RouteShortName, "AX") {
			return false // Airport Express
		}
		return isBus(t) || t == routeRail
	})
	var parts []Part
	for _, g := range groups {
		var stops [][]int
		for _, i := range g {
			for _, s := range legStops(w.deps, plan.Legs[i]) {
				stops = append(stops, wellingtonZones(w.zoneOf(s)))
			}
		}
		n, ok := zoneSpan(stops)
		if !ok || n > 14 {
			partial = true
			continue
		}
		first := plan.Legs[g[0]]
		depart := inTZ(first.DepartureTime, w.deps.TZ)
		offPeak := wellingtonOffPeak(depart, routeType(first) == routeRail)
		when := "peak"
		if offPeak {
			when = "off-peak"
		}
		cents := wellingtonFare(applied, n, offPeak, depart)
		parts = append(parts, Part{Legs: g, Cents: cents, Label: money(cents), Detail: pluralZones(n) + " · " + when})
	}
	card, note := "Snapper or contactless", "Adult fare. Off-peak is 20% less; free bus transfers are on Snapper only."
	switch {
	case applied == SuperGold:
		card, note = "Snapper", "SuperGold: free weekdays 9am-3pm, after 6:30pm and at weekends, otherwise the adult fare."
	case applied != Adult:
		card, note = "Snapper", fareNote(c, applied)+" Needs the concession on your Snapper card."
	case c != Adult:
		note = fareNote(c, applied) + " " + note
	}
	return build(parts, partial, "NZD", card, note, applied)
}

// Child, Community Connect and accessible concessions are half fare, from
// Metlink's own child table (it rounds its own way).
var (
	wellingtonChildPeakCents    = [...]int{0, 106, 175, 234, 262, 320, 407, 462, 516, 582, 639, 733, 787, 868, 925}
	wellingtonChildOffPeakCents = [...]int{0, 85, 140, 187, 210, 256, 326, 370, 413, 466, 511, 586, 630, 694, 740}
)

// wellingtonFare is one n-zone fare.
func wellingtonFare(c Concession, n int, offPeak bool, depart time.Time) int {
	switch c {
	case Child, Community, Accessible:
		if offPeak {
			return wellingtonChildOffPeakCents[n]
		}
		return wellingtonChildPeakCents[n]
	case Tertiary:
		// 25% off the peak adult fare - or the off-peak adult fare when
		// that's lower.
		cents := (wellingtonPeakCents[n]*3 + 2) / 4
		if offPeak {
			cents = min(cents, wellingtonOffPeakCents[n])
		}
		return cents
	case SuperGold:
		if superGoldFree(depart) {
			return 0
		}
	}
	if offPeak {
		return wellingtonOffPeakCents[n]
	}
	return wellingtonPeakCents[n]
}

func (w wellington) zoneOf(s gtfs.Stop) string {
	if w.deps.ZoneOf == nil {
		return ""
	}
	if z := w.deps.ZoneOf(s.StopId); z != "" {
		return z
	}
	if s.ParentStation != "" {
		return w.deps.ZoneOf(s.ParentStation)
	}
	return ""
}

func (w wellington) tz() *time.Location {
	if w.deps.TZ != nil {
		return w.deps.TZ
	}
	return time.UTC
}

// wellingtonZones - "3" -> [3], "1/2" -> [1 2], anything else -> nil.
func wellingtonZones(id string) []int {
	var out []int
	for _, part := range strings.Split(id, "/") {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || n < 1 {
			return nil
		}
		out = append(out, n)
	}
	return out
}

// zoneSpan is the fewest zones (highest - lowest + 1) a trip through stops
// covers, each stop taking whichever of its zones keeps the span smallest.
// False if any stop has no zone.
func zoneSpan(stops [][]int) (int, bool) {
	if len(stops) == 0 {
		return 0, false
	}
	best := -1
	for _, zs := range stops {
		if len(zs) == 0 {
			return 0, false
		}
	}
	// Try each candidate as the lowest zone: every stop takes its smallest
	// zone at or above it.
	for _, lowCandidates := range stops {
		for _, low := range lowCandidates {
			high, ok := low, true
			for _, zs := range stops {
				pick := -1
				for _, z := range zs {
					if z >= low && (pick < 0 || z < pick) {
						pick = z
					}
				}
				if pick < 0 {
					ok = false
					break
				}
				high = max(high, pick)
			}
			if ok && (best < 0 || high-low+1 < best) {
				best = high - low + 1
			}
		}
	}
	return best, best > 0
}

// wellingtonOffPeak: weekends, weekdays 9am-3pm and from 6:30pm, and buses
// before 7am (trains are peak until 9am). Public holidays are off-peak too
// but aren't known here.
func wellingtonOffPeak(t time.Time, train bool) bool {
	if wd := t.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return true
	}
	mins := t.Hour()*60 + t.Minute()
	switch {
	case mins < 7*60:
		return !train
	case mins < 9*60:
		return false
	case mins < 15*60:
		return true
	case mins < 18*60+30:
		return false
	default:
		return true
	}
}

