package fares

import (
	"strings"
	"time"

	"github.com/jfmow/gtfs"
)

// Orbus (Otago). Bee Card fares; free bus transfers within 45 min, within
// one zone. GTFS zones are "5900_*" for Dunedin and "5901_*" for
// Queenstown.
//
// Queenstown: a flat $2.50; the ferry (route 6) is $10.
// Dunedin: a flat $2.50 until 31 October 2026. From 1 November it's by
// zone - Dunedin itself is one zone ($2.50); trips further out (Waikouaiti,
// Palmerston, Hampden, Ōamaru) cost more, and aren't estimated since the
// feed's zone ids don't map onto the published 1-4 zone bands.
//
// https://www.orc.govt.nz/orbus/fares (updated 14 October 2026)
const (
	otagoBusCents   = 250
	otagoFerryCents = 1000
)

var dunedinZonesFrom = time.Date(2026, 11, 1, 0, 0, 0, 0, mustLoad("Pacific/Auckland"))

type otago struct{ deps Deps }

func otagoFerry(leg gtfs.JourneyLeg) bool { return routeType(leg) == routeFerry }

var otagoTransfers = transferRule{
	window: 45 * time.Minute,
	joins: func(prev, next gtfs.JourneyLeg) bool {
		return !otagoFerry(prev) && !otagoFerry(next)
	},
}

func (o otago) zone(s gtfs.Stop) string {
	if o.deps.ZoneOf == nil {
		return ""
	}
	return o.deps.ZoneOf(s.StopId)
}

func (o otago) Estimate(plan gtfs.JourneyPlan, c Concession) (Estimate, bool) {
	applied := c
	if !offers("otago", c) {
		applied = Adult
	}
	groups, partial := group(plan, otagoTransfers, func(leg gtfs.JourneyLeg) bool {
		if otagoFerry(leg) {
			return true
		}
		// After the change, only trips within Dunedin's own zone.
		if leg.DepartureTime.Before(dunedinZonesFrom) {
			return true
		}
		for _, s := range legStops(o.deps, leg) {
			z := o.zone(s)
			if strings.HasPrefix(z, "5900_") && z != "5900_1" {
				return false
			}
		}
		return true
	})
	var parts []Part
	for _, g := range groups {
		ferry := otagoFerry(plan.Legs[g[0]])
		detail := "bus"
		if ferry {
			detail = "ferry"
		}
		cents := otagoFare(applied, ferry, inTZ(plan.Legs[g[0]].DepartureTime, o.deps.TZ))
		parts = append(parts, Part{Legs: g, Cents: cents, Label: money(cents), Detail: detail})
	}
	note := fareNote(c, applied) + " Cash costs more."
	if applied == SuperGold {
		note = "SuperGold: free weekdays 9am-3pm, after 6:30pm and at weekends, otherwise $2.50. Not on the ferry."
	}
	return build(parts, partial, "NZD", "Bee Card", note, applied)
}

// otagoFare is one fare. The ferry has no concessions.
func otagoFare(c Concession, ferry bool, depart time.Time) int {
	if ferry {
		return otagoFerryCents
	}
	switch c {
	case Child:
		return 150
	case Community:
		return 125
	case SuperGold:
		if superGoldFree(depart) {
			return 0
		}
	}
	return otagoBusCents
}

func mustLoad(name string) *time.Location {
	tz, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return tz
}
