package fares

import (
	"strings"
	"time"

	"github.com/jfmow/gtfs"
)

// Greater Christchurch Metro. A flat fare, with free transfers within two
// hours of the first boarding; the Diamond Harbour ferry (route F) costs
// more.
//
// Prices from 7 July 2025 (Metrocard / contactless, standard):
// https://www.metroinfo.co.nz/metrocard-and-fares/fares/
const (
	christchurchBusCents   = 300
	christchurchFerryCents = 500
)

type christchurch struct{ deps Deps }

func christchurchFerry(leg gtfs.JourneyLeg) bool {
	return routeType(leg) == routeFerry || (leg.Route != nil && strings.EqualFold(leg.Route.RouteShortName, "F"))
}

var christchurchTransfers = transferRule{
	window: 2 * time.Hour,
	span:   2 * time.Hour,
	joins: func(prev, next gtfs.JourneyLeg) bool {
		return christchurchFerry(prev) == christchurchFerry(next)
	},
}

func (c christchurch) Estimate(plan gtfs.JourneyPlan, conc Concession) (Estimate, bool) {
	applied := conc
	if !offers("christ", conc) {
		applied = Adult // no such fare on Metro's table
	}
	groups, partial := group(plan, christchurchTransfers, func(gtfs.JourneyLeg) bool { return true })
	var parts []Part
	for _, g := range groups {
		ferry := christchurchFerry(plan.Legs[g[0]])
		detail := "bus"
		if ferry {
			detail = "ferry"
		}
		cents := christchurchFare(applied, ferry, inTZ(plan.Legs[g[0]].DepartureTime, c.deps.TZ))
		parts = append(parts, Part{Legs: g, Cents: cents, Label: money(cents), Detail: detail})
	}
	note := "Standard fare. Capped at $6 a day and $30 a week on buses."
	switch applied {
	case Child:
		note = "Child fare (5-18). Capped at $3 a day and $15 a week on buses."
	case Youth:
		note = "Youth fare (19-24). Capped at $5 a day and $25 a week on buses."
	case SuperGold:
		note = "SuperGold: free from 9am on weekdays and at weekends, otherwise the standard fare. The free 3pm-6:30pm window is due to end."
	}
	if applied != conc {
		note = fareNote(conc, applied) + " " + note
	}
	return build(parts, partial, "NZD", "Metrocard or contactless", note, applied)
}

// christchurchFare is one fare (bus or ferry).
func christchurchFare(c Concession, ferry bool, depart time.Time) int {
	switch c {
	case Child:
		if ferry {
			return 250
		}
		return 150
	case Youth:
		if ferry {
			return 450
		}
		return 250
	case SuperGold:
		// ECan pays for the 3pm-6:30pm weekday window on top of the
		// national scheme, until it ends (date not set as of Oct 2026).
		if weekend(depart) || depart.Hour() >= 9 {
			return 0
		}
	}
	if ferry {
		return christchurchFerryCents
	}
	return christchurchBusCents
}
