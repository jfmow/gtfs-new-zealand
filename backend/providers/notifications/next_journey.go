package notifications

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/providers/planlimit"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
)

// ── The next way to go, when the first ride can't be made ────────────────────
//
// A ride running early can leave before the rider could reach it - either
// before they've set off (the leave time jumped into the past) or while
// they're walking there. Either way the journey's "you'll miss it" alert
// carries the next way to go, and tapping it opens that journey.

// nextJourneyFinder re-plans plan's trip from (fromLat, fromLon), setting off
// at `at`, without missedTripID. The journey found is kept in the plan store,
// so a link to it opens.
type nextJourneyFinder func(plan gtfs.JourneyPlan, fromLat, fromLon float64, at time.Time, missedTripID string) (gtfs.JourneyPlan, bool)

func newNextJourneyFinder(gtfsData gtfs.Database, rt *realtime.Realtime, osrmURL string, planPut func(gtfs.JourneyPlan)) nextJourneyFinder {
	return func(plan gtfs.JourneyPlan, fromLat, fromLon float64, at time.Time, missedTripID string) (gtfs.JourneyPlan, bool) {
		req := gtfs.JourneyRequest{
			StartLat:        fromLat,
			StartLon:        fromLon,
			EndLat:          plan.EndLat,
			EndLon:          plan.EndLon,
			DepartAt:        at,
			MaxWalkKm:       planMaxWalkKm(plan),
			WalkSpeedKmph:   planWalkSpeed(plan),
			MaxTransfers:    2,
			MaxNearbyStops:  50,
			MaxResults:      5,
			MinResults:      3,
			OsrmURL:         osrmURL,
			IncludeChildren: true,
			Realtime:        rt,
		}
		plans, err := func() (*[]gtfs.JourneyPlan, error) {
			planlimit.Acquire(context.Background())
			defer planlimit.Release()
			return gtfsData.PlanJourneyRaptor(req)
		}()
		if err != nil || plans == nil {
			return gtfs.JourneyPlan{}, false
		}
		next, ok := pickNextJourney(*plans, at, missedTripID)
		if ok && planPut != nil {
			planPut(next)
		}
		return next, ok
	}
}

// pickNextJourney is the soonest-arriving journey that rides something and
// doesn't board the ride being missed.
func pickNextJourney(plans []gtfs.JourneyPlan, at time.Time, missedTripID string) (gtfs.JourneyPlan, bool) {
	var best gtfs.JourneyPlan
	found := false
	for _, p := range plans {
		bt := firstTransitLeg(p)
		if p.ID == "" || bt == nil || bt.TripID == missedTripID || bt.DepartureTime.Before(at) {
			continue
		}
		if !found || p.ArrivalTime.Before(best.ArrivalTime) {
			best, found = p, true
		}
	}
	return best, found
}

// planWalkSpeed is the walking speed the journey was planned with, read back
// from its walks.
func planWalkSpeed(plan gtfs.JourneyPlan) float64 {
	var km, hours float64
	for _, leg := range plan.Legs {
		if d := leg.ArrivalTime.Sub(leg.DepartureTime); leg.Mode == "walk" && leg.DistanceKm > 0 && d > 0 {
			km += leg.DistanceKm
			hours += d.Hours()
		}
	}
	if hours == 0 {
		return DefaultWalkSpeed
	}
	return NormalizeWalkSpeed(km / hours)
}

// planMaxWalkKm lets the new journey walk at least as far as this one did
// to its first stop.
func planMaxWalkKm(plan gtfs.JourneyPlan) float64 {
	walk := 1.0
	if len(plan.Legs) > 0 && plan.Legs[0].Mode == "walk" {
		walk = math.Max(walk, plan.Legs[0].DistanceKm+0.2)
	}
	return walk
}

// nextJourneyOffers remembers what was found for an alert, so a push that
// fails (and is retried next tick) doesn't re-plan every 20s.
var (
	nextJourneyOffersMu sync.Mutex
	nextJourneyOffers   = map[string]nextJourneyOffer{}
)

type nextJourneyOffer struct {
	body, tapHint, url string
	at                 time.Time
}

const nextJourneyOfferTTL = 5 * time.Minute

// keepTimeMaxLater: a journey leaving when the rider planned to is only
// offered if it gets them there within this of their planned arrival.
const keepTimeMaxLater = 15 * time.Minute

// keepTimeMinShift: how far the leave time has to have moved earlier than
// planned before it's worth looking for a way that keeps the rider's own.
const keepTimeMinShift = 2 * time.Minute

// leaveMovedEarlier: the first ride now running early has moved the leave
// time keepTimeMinShift or more before the one the rider planned around.
func leaveMovedEarlier(plan gtfs.JourneyPlan, live liveLegLookup) bool {
	first := firstTransitLeg(plan)
	if first == nil || live == nil {
		return false
	}
	_, leave, ok := planLiveLeave(plan, live, first.TripID)
	return ok && plannedLeave(plan).Sub(leave) >= keepTimeMinShift
}

// offerNextJourney adds another way to go to a setting-off alert, aiming to
// get the rider there as close to their planned arrival as it can:
//   - "you'll miss the first ride": whatever arrives soonest, from where
//     the rider is heading (the stop, once they've set off) or where
//     they're starting from;
//   - "leave now" when a ride running early has moved the leave time
//     earlier than planned (movedEarlier): a way that still leaves when they
//     planned to, if it arrives close to the planned time - they may not be
//     able to leave early.
//
// Its notification then opens that journey.
func offerNextJourney(alert *activityAlert, cacheKey string, plan gtfs.JourneyPlan, hint activityHint, movedEarlier bool, region string, tz *time.Location, now time.Time, find nextJourneyFinder) {
	if alert == nil {
		return
	}
	missed := strings.HasPrefix(alert.Key, missedFirstPrefix)
	keepTime := strings.HasPrefix(alert.Key, "leave-") && movedEarlier
	if !missed && !keepTime {
		return
	}
	nextJourneyOffersMu.Lock()
	for k, o := range nextJourneyOffers {
		if now.Sub(o.at) > nextJourneyOfferTTL {
			delete(nextJourneyOffers, k)
		}
	}
	cached, ok := nextJourneyOffers[cacheKey]
	nextJourneyOffersMu.Unlock()
	if ok {
		alert.Body, alert.TapHint, alert.URL = cached.body, cached.tapHint, cached.url
		return
	}

	offer := nextJourneyOffer{body: alert.Body, at: now}
	if missed {
		offer.tapHint = "Tap to find another way."
	}
	first := firstTransitLeg(plan)
	switch {
	case find == nil || first == nil:
	case missed:
		fromLat, fromLon, at := plan.StartLat, plan.StartLon, now.Add(time.Minute)
		if hint.LeftUnix > 0 && first.FromStop != nil {
			// On the way to the stop: the next way from there, once
			// they've reached it.
			fromLat, fromLon = first.FromStop.StopLat, first.FromStop.StopLon
			if len(plan.Legs) > 0 && plan.Legs[0].Mode == "walk" {
				reach := time.Unix(hint.LeftUnix, 0).Add(plan.Legs[0].ArrivalTime.Sub(plan.Legs[0].DepartureTime))
				if reach.After(at) {
					at = reach
				}
			}
		}
		if next, found := find(plan, fromLat, fromLon, at, first.TripID); found {
			offer.body = alert.Body + " " + nextJourneySummary(next, plan.ArrivalTime, tz)
			offer.tapHint = "Tap to switch to it."
			offer.url = journeyTrackURL(next.ID, region)
		}
	case keepTime:
		if alt, found := findKeepingLeaveTime(find, plan, now, first.TripID); found {
			offer.body = alert.Body + " " + keepTimeSummary(alt, plan.ArrivalTime, tz)
			offer.tapHint = "Tap to switch to it."
			offer.url = journeyTrackURL(alt.ID, region)
		}
	}

	nextJourneyOffersMu.Lock()
	nextJourneyOffers[cacheKey] = offer
	nextJourneyOffersMu.Unlock()
	alert.Body, alert.TapHint, alert.URL = offer.body, offer.tapHint, offer.url
}

func journeyTrackURL(planID, region string) string {
	return "/journey?id=" + url.QueryEscape(planID) + "&region=" + url.QueryEscape(region) + "&track=1"
}

// plannedLeave is when the rider planned to set off on plan - its first
// walk's start, as the card's leave-by shows it.
func plannedLeave(plan gtfs.JourneyPlan) time.Time {
	if len(plan.Legs) > 0 && plan.Legs[0].Mode == "walk" {
		return leaveByTime(plan.Legs[0].DepartureTime)
	}
	return plan.DepartureTime
}

// findKeepingLeaveTime is a way that leaves no earlier than the rider
// planned to (or now, if that's gone) without the ride that's moved
// earlier, and gets them there within keepTimeMaxLater of plan's arrival.
func findKeepingLeaveTime(find nextJourneyFinder, plan gtfs.JourneyPlan, now time.Time, earlyTripID string) (gtfs.JourneyPlan, bool) {
	at := plannedLeave(plan)
	if soonest := now.Add(time.Minute); at.Before(soonest) {
		at = soonest
	}
	alt, ok := find(plan, plan.StartLat, plan.StartLon, at, earlyTripID)
	if !ok || alt.ArrivalTime.Sub(plan.ArrivalTime) > keepTimeMaxLater {
		return gtfs.JourneyPlan{}, false
	}
	return alt, true
}

// versusPlanned - "4 min later than planned", "as planned".
func versusPlanned(arrive, planned time.Time) string {
	switch m := int(math.Round(arrive.Sub(planned).Minutes())); {
	case m >= 1:
		return fmt.Sprintf("%d min later than planned", m)
	case m <= -1:
		return fmt.Sprintf("%d min earlier than planned", -m)
	}
	return "as planned"
}

func inTZ(t time.Time, tz *time.Location) time.Time {
	if tz != nil {
		return t.In(tz)
	}
	return t
}

// nextJourneySummary - "Next: the E-W at 9:36am from Baldwin Ave, arriving
// 10:02am (15 min later than planned)."
func nextJourneySummary(next gtfs.JourneyPlan, plannedArrival time.Time, tz *time.Location) string {
	bt := firstTransitLeg(next)
	if bt == nil {
		return ""
	}
	return fmt.Sprintf("Next: the %s at %s from %s, arriving %s (%s).",
		planRouteLabel(next), clock(inTZ(bt.DepartureTime, tz)), stopLabel(bt.FromStop),
		clock(inTZ(next.ArrivalTime, tz)), versusPlanned(next.ArrivalTime, plannedArrival))
}

// keepTimeSummary - "Or leave at 9:10am: the 22 at 9:19am from Mt Albert
// Rd, arriving 9:49am (2 min later than planned)."
func keepTimeSummary(alt gtfs.JourneyPlan, plannedArrival time.Time, tz *time.Location) string {
	bt := firstTransitLeg(alt)
	if bt == nil {
		return ""
	}
	return fmt.Sprintf("Or leave at %s: the %s at %s from %s, arriving %s (%s).",
		clock(inTZ(leaveByTime(alt.DepartureTime), tz)), planRouteLabel(alt), clock(inTZ(bt.DepartureTime, tz)),
		stopLabel(bt.FromStop), clock(inTZ(alt.ArrivalTime, tz)), versusPlanned(alt.ArrivalTime, plannedArrival))
}
