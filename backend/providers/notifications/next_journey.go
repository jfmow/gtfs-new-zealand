package notifications

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"strconv"
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

// offerNextJourney adds the next way to go to a "you'll miss the first ride"
// alert: from where the rider is heading (the stop, once they've set off)
// or where they're starting from. Its notification then opens that journey.
func offerNextJourney(alert *activityAlert, cacheKey string, plan gtfs.JourneyPlan, hint activityHint, region string, tz *time.Location, now time.Time, find nextJourneyFinder) {
	if alert == nil || !strings.HasPrefix(alert.Key, missedFirstPrefix) {
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

	offer := nextJourneyOffer{body: alert.Body, tapHint: "Tap to find another way.", at: now}
	f, err := strconv.Atoi(strings.TrimPrefix(alert.Key, missedFirstPrefix))
	if find != nil && err == nil && f >= 0 && f < len(plan.Legs) {
		missed := plan.Legs[f]
		fromLat, fromLon, at := plan.StartLat, plan.StartLon, now.Add(time.Minute)
		if hint.LeftUnix > 0 && missed.FromStop != nil {
			// On the way to the stop: the next way from there, once
			// they've reached it.
			fromLat, fromLon = missed.FromStop.StopLat, missed.FromStop.StopLon
			if len(plan.Legs) > 0 && plan.Legs[0].Mode == "walk" {
				reach := time.Unix(hint.LeftUnix, 0).Add(plan.Legs[0].ArrivalTime.Sub(plan.Legs[0].DepartureTime))
				if reach.After(at) {
					at = reach
				}
			}
		}
		if next, found := find(plan, fromLat, fromLon, at, missed.TripID); found {
			offer.body = alert.Body + " " + nextJourneySummary(next, tz)
			offer.tapHint = "Tap to switch to it."
			offer.url = "/journey?id=" + url.QueryEscape(next.ID) + "&region=" + url.QueryEscape(region) + "&track=1"
		}
	}

	nextJourneyOffersMu.Lock()
	nextJourneyOffers[cacheKey] = offer
	nextJourneyOffersMu.Unlock()
	alert.Body, alert.TapHint, alert.URL = offer.body, offer.tapHint, offer.url
}

// nextJourneySummary - "Next: the E-W at 9:36am from Baldwin Ave, arriving
// 10:02am."
func nextJourneySummary(next gtfs.JourneyPlan, tz *time.Location) string {
	bt := firstTransitLeg(next)
	if bt == nil {
		return ""
	}
	in := func(t time.Time) time.Time {
		if tz != nil {
			return t.In(tz)
		}
		return t
	}
	return fmt.Sprintf("Next: the %s at %s from %s, arriving %s.",
		planRouteLabel(next), clock(in(bt.DepartureTime)), stopLabel(bt.FromStop), clock(in(next.ArrivalTime)))
}
