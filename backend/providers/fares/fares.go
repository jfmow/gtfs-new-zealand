// Package fares estimates what a planned journey costs - the standard adult
// fare on the region's smartcard (or contactless, where it's the same price),
// following each region's own transfer and zone rules.
//
// None of the feeds carry usable fare data (their fare tables are empty), so
// prices live here, per region, with the date they took effect. They change
// most years - usually 1 July in NZ - and need updating by hand: see each
// region's file for its source.
package fares

import (
	"fmt"
	"time"

	"github.com/jfmow/gtfs"
)

// Estimate is a journey's fare.
type Estimate struct {
	Cents    int    `json:"cents"`
	Currency string `json:"currency"` // "NZD" | "AUD"
	// Label is the price, ready to show: "$4.90". With Partial set it's
	// only part of the journey: "$4.90+".
	Label string `json:"label"`
	// Detail says what it's for: "AT HOP or contactless · 2 zones".
	Detail string `json:"detail"`
	// Note is the small print: caps, off-peak.
	Note string `json:"note,omitempty"`
	// Partial: some rides couldn't be priced (a ferry, a zone we can't
	// place) - they're not in Cents.
	Partial bool   `json:"partial"`
	Parts   []Part `json:"parts"`
	// Concession is the fare type priced - Adult when the region has no
	// fare for the one asked for.
	Concession Concession `json:"concession"`
}

// Part is one fare paid - a ride, or rides joined by free transfers.
type Part struct {
	// Legs are the plan's leg indexes it covers.
	Legs   []int  `json:"legs"`
	Cents  int    `json:"cents"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

// Calculator prices a region's journeys.
type Calculator interface {
	// Estimate is the plan's fare for the concession, or false when
	// nothing in it can be priced (or it has no rides).
	Estimate(plan gtfs.JourneyPlan, c Concession) (Estimate, bool)
}

// Deps is what the calculators need from the region's GTFS.
type Deps struct {
	// StopsOnTrip is the trip's stops in order ("nil" if unknown).
	StopsOnTrip func(tripID string) []gtfs.Stop
	// ZoneOf is a stop's GTFS zone_id ("" if none).
	ZoneOf func(stopID string) string
	// TZ is the region's time zone.
	TZ *time.Location
}

// For returns the region's calculator, or nil for a region without fares.
func For(region string, deps Deps) Calculator {
	switch region {
	case "at":
		return auckland{deps: deps, zones: aucklandZones()}
	case "wel":
		return wellington{deps: deps}
	case "christ":
		return christchurch{deps: deps}
	case "otago":
		return otago{deps: deps}
	case "seq":
		return seq{deps: deps}
	}
	return nil
}

// Route types (GTFS).
const (
	routeTram      = 0
	routeRail      = 2
	routeBus       = 3
	routeFerry     = 4
	routeCableTram = 5
	routeFunicular = 7
)

func routeType(leg gtfs.JourneyLeg) int {
	if leg.Route == nil {
		return routeBus
	}
	return leg.Route.RouteType
}

// isBus covers the extended bus types too (Metlink's school buses are 712).
func isBus(t int) bool { return t == routeBus || (t >= 700 && t < 800) }

func isRide(leg gtfs.JourneyLeg) bool { return leg.Mode != "walk" }

// transferRule is when the next ride carries on the same fare.
type transferRule struct {
	// window is the most time from getting off one ride to boarding the
	// next.
	window time.Duration
	// maxRides is the most rides on one fare (0 = no limit).
	maxRides int
	// span is the most time from the first boarding to the last (0 = no
	// limit).
	span time.Duration
	// joins, if set, must also allow prev -> next (e.g. bus to bus only).
	joins func(prev, next gtfs.JourneyLeg) bool
}

// group splits the rides that pass `priced` into fares by rule. Rides that
// don't pass are left out (the estimate is then partial).
func group(plan gtfs.JourneyPlan, rule transferRule, priced func(gtfs.JourneyLeg) bool) (groups [][]int, partial bool) {
	var cur []int
	for i, leg := range plan.Legs {
		if !isRide(leg) {
			continue
		}
		if !priced(leg) {
			partial = true
			continue
		}
		if len(cur) > 0 {
			prev, first := plan.Legs[cur[len(cur)-1]], plan.Legs[cur[0]]
			ok := leg.DepartureTime.Sub(prev.ArrivalTime) <= rule.window &&
				(rule.maxRides == 0 || len(cur) < rule.maxRides) &&
				(rule.span == 0 || leg.DepartureTime.Sub(first.DepartureTime) <= rule.span) &&
				(rule.joins == nil || rule.joins(prev, leg))
			if !ok {
				groups = append(groups, cur)
				cur = nil
			}
		}
		cur = append(cur, i)
	}
	if len(cur) > 0 {
		groups = append(groups, cur)
	}
	return groups, partial
}

// legStops is the stops a ride calls at, boarding to alighting - just those
// two when the trip's stop list can't be matched.
func legStops(deps Deps, leg gtfs.JourneyLeg) []gtfs.Stop {
	var ends []gtfs.Stop
	if leg.FromStop != nil {
		ends = append(ends, *leg.FromStop)
	}
	if leg.ToStop != nil {
		ends = append(ends, *leg.ToStop)
	}
	if deps.StopsOnTrip == nil || leg.TripID == "" || leg.FromStop == nil || leg.ToStop == nil {
		return ends
	}
	stops := deps.StopsOnTrip(leg.TripID)
	from := findStop(stops, *leg.FromStop, 0)
	if from < 0 {
		return ends
	}
	to := findStop(stops, *leg.ToStop, from+1)
	if to < 0 {
		return ends
	}
	return stops[from : to+1]
}

// findStop is the index of want in stops from `after`, matching the stop
// itself or a platform of the same station.
func findStop(stops []gtfs.Stop, want gtfs.Stop, after int) int {
	for i := after; i < len(stops); i++ {
		if stops[i].StopId == want.StopId {
			return i
		}
	}
	if want.ParentStation == "" {
		return -1
	}
	for i := after; i < len(stops); i++ {
		if stops[i].ParentStation == want.ParentStation || stops[i].StopId == want.ParentStation {
			return i
		}
	}
	return -1
}

func inTZ(t time.Time, tz *time.Location) time.Time {
	if tz != nil {
		return t.In(tz)
	}
	return t
}

// money - "$4.90", "$3", "50c", "Free".
func money(cents int) string {
	switch {
	case cents == 0:
		return "Free"
	case cents < 100:
		return fmt.Sprintf("%dc", cents)
	case cents%100 == 0:
		return fmt.Sprintf("$%d", cents/100)
	default:
		return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
	}
}

// build totals the parts into an estimate. card is what the fare is on
// ("AT HOP or contactless"), applied the concession priced; false when
// there are no parts.
func build(parts []Part, partial bool, currency, card, note string, applied Concession) (Estimate, bool) {
	if len(parts) == 0 {
		return Estimate{}, false
	}
	e := Estimate{Currency: currency, Partial: partial, Parts: parts, Note: note, Concession: applied}
	var details []string
	for _, p := range parts {
		e.Cents += p.Cents
		if p.Detail != "" {
			details = append(details, p.Detail)
		}
	}
	e.Label = money(e.Cents)
	if partial {
		e.Label += "+"
	}
	e.Detail = card
	switch {
	case len(parts) == 1 && len(details) == 1:
		e.Detail += " · " + details[0]
	case len(parts) > 1:
		e.Detail += fmt.Sprintf(" · %d fares", len(parts))
	}
	if partial {
		e.Detail += " · some rides not included"
	}
	return e, true
}
