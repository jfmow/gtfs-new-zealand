package fares

import (
	"time"

	"github.com/jfmow/gtfs"
)

// Translink (South East Queensland). A flat 50c on every mode and zone;
// transfers within an hour (up to three, the last ride starting within 3.5
// hours of the first) are one fare. Airtrain isn't included, and isn't in
// the feed.
//
// https://translink.com.au/tickets-and-fares/50-cent-fares
// https://translink.com.au/tickets-and-fares/fares-and-zones/transfers
const seqCents = 50

type seq struct{ deps Deps }

var seqTransfers = transferRule{window: time.Hour, maxRides: 4, span: 3*time.Hour + 30*time.Minute}

// Every fare type pays the same 50c.
func (q seq) Estimate(plan gtfs.JourneyPlan, c Concession) (Estimate, bool) {
	groups, partial := group(plan, seqTransfers, func(gtfs.JourneyLeg) bool { return true })
	var parts []Part
	for _, g := range groups {
		parts = append(parts, Part{Legs: g, Cents: seqCents, Label: money(seqCents)})
	}
	return build(parts, partial, "AUD", "go card or contactless", "Any zone, any mode, any fare type.", Adult)
}
