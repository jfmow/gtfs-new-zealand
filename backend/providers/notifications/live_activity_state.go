package notifications

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jfmow/gtfs"
)

// ─────────────────────── journey Live Activity state (v2) ───────────────────────
//
// What the Lock Screen / Dynamic Island shows for a journey that's being
// tracked. Built here for background pushes (app suspended or killed), and
// by `JourneyTrackingView.contentState` on-device while the app is open -
// both follow the same per-phase wording so a hand-off between the two
// never visibly changes the copy.
//
// v1 walked the cached plan's frozen leg times: no live delays, no stops
// away, the waiting countdown pointed at the leg's *arrival*, and the
// phone's own leg/phase report was stored but never read. v2 overlays
// realtime (trip updates + vehicle position) per transit leg and never
// moves behind what the phone last reported.

// activityStateVersion is bumped whenever the content-state shape changes -
// the widget decodes every field leniently, so older/newer payloads still
// render.
const activityStateVersion = 3

// journeyActivityState mirrors `JourneyActivityAttributes.ContentState`
// (ios/Shared/JourneyActivityAttributes.swift) field for field. Times are
// plain Unix seconds rather than `Date`s so there's no ambiguity about
// which epoch ActivityKit's decoder expects.
type journeyActivityState struct {
	Version          int               `json:"version"`
	LegIndex         int               `json:"legIndex"`
	Phase            string            `json:"phase"` // walking | waiting | boarding | onboard | arrived
	RouteShortName   string            `json:"routeShortName"`
	RouteColorHex    string            `json:"routeColorHex"`
	Headsign         string            `json:"headsign"`
	PrimaryText      string            `json:"primaryText"`
	SecondaryText    string            `json:"secondaryText"`
	CountdownLabel   string            `json:"countdownLabel"`
	TargetUnix       float64           `json:"targetUnix"`
	DelayMinutes     int               `json:"delayMinutes"`
	Status           string            `json:"status"` // onTime | delayed | early | cancelled | tightConnection | missedConnection | arrived
	StopsAway        *int              `json:"stopsAway,omitempty"`
	ArrivalUnix      float64           `json:"arrivalUnix"`
	ProgressFraction float64           `json:"progressFraction"`
	TotalLegs        int               `json:"totalLegs"`
	Platform         *string           `json:"platform,omitempty"`
	NextLeg          *activityNextLeg  `json:"nextLeg,omitempty"`
	LegChain         []activityLegChip `json:"legChain"`
	UpdatedUnix      float64           `json:"updatedUnix"`
	IsRealtime       bool              `json:"isRealtime"`

	// v3 - what the widget's phase row draws (stop track, vehicle approach,
	// walk distance) instead of parsing it back out of the copy.
	BoardStopName  string `json:"boardStopName,omitempty"`
	AlightStopName string `json:"alightStopName,omitempty"`
	NextStopName   string `json:"nextStopName,omitempty"`
	RideStops      *int   `json:"rideStops,omitempty"` // stops ridden, board -> alight
	WalkMinutes    *int   `json:"walkMinutes,omitempty"`
	WalkMeters     *int   `json:"walkMeters,omitempty"`
	HasVehicle     bool   `json:"hasVehicle"`
	Occupancy      *int   `json:"occupancy,omitempty"`   // GTFS-RT occupancy status
	VehicleMode    string `json:"vehicleMode,omitempty"` // bus | train | ferry - the current (or next) ride's vehicle
	// SegmentStartUnix/SegmentEndUnix are the walk, wait or ride the ring
	// drains across - separate from TargetUnix (walking to a stop counts
	// down to departure, but its ring empties on reaching the stop). 0 when
	// there's no segment (e.g. "Leave by").
	SegmentStartUnix float64 `json:"segmentStartUnix,omitempty"`
	SegmentEndUnix   float64 `json:"segmentEndUnix,omitempty"`
	// Urgent is a moment the rider must act on now or soon - getting ready
	// to leave, and leaving - which the widget highlights.
	Urgent bool `json:"urgent,omitempty"`

	// alert is a one-off "tell the rider now" moment, sent as the push's
	// alert (sound + banner) rather than a silent update. Not part of the
	// widget's content-state.
	alert *activityAlert
}

// Timings for the first walk (setting off): the get-ready heads-up, how
// long "Leave now" stays on the card, and when the follow-up nudge goes.
const (
	getReadyLead     = 5 * time.Minute
	leaveNowShownFor = 3 * time.Minute
	leaveNudgeAfter  = 2 * time.Minute
)

type activityNextLeg struct {
	RouteShortName string  `json:"routeShortName"`
	RouteColorHex  string  `json:"routeColorHex"`
	DepartureUnix  float64 `json:"departureUnix"`
	ConnectMinutes int     `json:"connectMinutes"`
}

type activityLegChip struct {
	Mode      string `json:"mode"` // walk | transit
	ShortName string `json:"shortName"`
	ColorHex  string `json:"colorHex"`
}

type activityAlert struct {
	Key   string // dedupe key, stored in live_activities.alerted_keys
	Title string
	Body  string
	// Silent drops the alert's sound - when a notification for the same
	// moment has just played one.
	Silent bool `json:"-"`
	// URL is where the alert's notification opens, when it isn't the
	// journey itself (another journey offered instead).
	URL string `json:"-"`
	// TapHint ends the notification's body ("Tap to switch to it.") - not
	// the Live Activity's own alert, which a tap can only open the journey
	// from.
	TapHint string `json:"-"`
}

// isSettingOff is true for the alerts about leaving for the journey - the
// get-ready heads-up, "Time to leave", its follow-up, queued leave-by
// reminders, and the first ride going before the rider can reach it. These
// can't wait for the rider to look at the phone, so they go out as a
// notification too (see runLiveActivitiesCron).
func (a activityAlert) isSettingOff() bool {
	for _, prefix := range []string{"ready-", "leave-", "reminder-", missedFirstPrefix} {
		if strings.HasPrefix(a.Key, prefix) {
			return true
		}
	}
	return false
}

// legLive is the realtime picture for one transit leg's trip.
type legLive struct {
	HasTripUpdate  bool
	DepartureDelay int // seconds, at the boarding stop
	ArrivalDelay   int // seconds, at the alighting stop
	Cancelled      bool
	BoardSkipped   bool
	AlightSkipped  bool
	// HasVehicle is true only when a running vehicle's position could be
	// placed on the trip - AT publishes trip updates for trips that haven't
	// started, so stop-count logic is gated on this, not on HasTripUpdate.
	HasVehicle    bool
	StopsToBoard  int // stops before the boarding stop (0 = it's next, <0 = passed)
	StopsToAlight int // stops before the alighting stop (0 = it's next, <0 = passed)
	NextStopName  string
	// RideStops is how many stops the rider travels (board -> alight), from
	// the trip's stop list - 0 when it isn't known.
	RideStops int
	// Occupancy is the running vehicle's GTFS-RT occupancy status, when it
	// reports one.
	Occupancy *int
}

// liveLegLookup returns realtime for the transit leg at index i, or false
// when there's none.
type liveLegLookup func(i int, leg gtfs.JourneyLeg) (legLive, bool)

// activityHint is what the phone last reported (POST .../live-activities/leg)
// - a floor the server never moves behind.
type activityHint struct {
	LegIndex int
	Phase    string
	// LeftUnix is when the phone saw the rider set off on the first walk
	// (0 = not seen). From then on the leave time is history: the card
	// says whether they'll make the ride instead of when to leave.
	LeftUnix int64
	// Watching: the phone is following the rider's GPS and they haven't
	// set off - "Leave now" stays up while the ride can still be made,
	// and a ride that can't (one running early) is said straight away.
	Watching bool
}

var noHint = activityHint{LegIndex: -1}

type legTiming struct {
	dep, arr time.Time
	live     legLive
	hasLive  bool
}

func computeJourneyActivityState(plan gtfs.JourneyPlan, now time.Time, live liveLegLookup, hint activityHint) journeyActivityState {
	n := len(plan.Legs)
	state := journeyActivityState{
		Version:     activityStateVersion,
		TotalLegs:   n,
		LegChain:    legChain(plan),
		UpdatedUnix: float64(now.Unix()),
	}
	if n == 0 {
		state.Phase, state.Status, state.PrimaryText = "arrived", "arrived", "You've arrived"
		state.TargetUnix, state.ArrivalUnix, state.ProgressFraction = float64(now.Unix()), float64(now.Unix()), 1
		return state
	}

	timings := effectiveTimings(plan, live)
	// Set off already: the first walk runs from when they actually left.
	if hint.LeftUnix > 0 && plan.Legs[0].Mode == "walk" {
		left := time.Unix(hint.LeftUnix, 0).In(timings[0].dep.Location())
		timings[0].dep, timings[0].arr = left, left.Add(plan.Legs[0].ArrivalTime.Sub(plan.Legs[0].DepartureTime))
	}
	state.ArrivalUnix = float64(timings[n-1].arr.Unix())
	for _, t := range timings {
		if t.hasLive && t.live.HasTripUpdate {
			state.IsRealtime = true
		}
	}

	// Which leg the rider is on: the first one not yet finished...
	idx := n
	for i := range plan.Legs {
		if !legFinished(plan.Legs[i], timings[i], now) {
			idx = i
			break
		}
	}
	// ...but never behind what the phone last saw.
	if hint.LegIndex > idx && hint.LegIndex < n {
		idx = hint.LegIndex
	}
	// The phone can see they're still at the start: they're not at the
	// stop just because the walk's planned arrival has passed. Held only
	// until the ride goes, so a GPS that never notices them leaving can't
	// keep the card on the walk for the whole journey.
	if hint.Watching && hint.LegIndex <= 0 && plan.Legs[0].Mode == "walk" {
		if f := nextTransit(plan, 0); idx > 0 && f >= 0 && idx <= f && now.Before(timings[f].dep) {
			idx = 0
		}
	}

	if idx >= n {
		state.LegIndex = n - 1
		state.Phase, state.Status, state.PrimaryText = "arrived", "arrived", "You've arrived"
		state.TargetUnix = state.ArrivalUnix
		state.ProgressFraction = 1
		return state
	}

	state.LegIndex = idx
	leg, t := plan.Legs[idx], timings[idx]

	if leg.Mode == "walk" {
		fillWalking(&state, plan, timings, idx, now, hint)
	} else {
		fillTransit(&state, plan, timings, idx, now, hint)
	}

	state.ProgressFraction = progress(idx, n, t, now)
	return state
}

// effectiveTimings shifts every leg by realtime: transit legs by their own
// trip's delays, walk legs along with the transit leg they connect to (a
// walk before the first ride starts later if that ride is late; a walk after
// a ride starts when the ride actually arrives).
func effectiveTimings(plan gtfs.JourneyPlan, live liveLegLookup) []legTiming {
	timings := make([]legTiming, len(plan.Legs))
	for i, leg := range plan.Legs {
		t := legTiming{dep: leg.DepartureTime, arr: leg.ArrivalTime}
		if leg.Mode != "walk" && live != nil {
			if l, ok := live(i, leg); ok {
				t.live, t.hasLive = l, true
				if l.HasTripUpdate {
					t.dep = scheduledDeparture(leg).Add(time.Duration(l.DepartureDelay) * time.Second)
					t.arr = scheduledArrival(leg).Add(time.Duration(l.ArrivalDelay) * time.Second)
				}
			}
		}
		timings[i] = t
	}

	for i, leg := range plan.Legs {
		if leg.Mode != "walk" {
			continue
		}
		var shift time.Duration
		if p := prevTransit(plan, i); p >= 0 {
			shift = timings[p].arr.Sub(plan.Legs[p].ArrivalTime)
		} else if f := nextTransit(plan, i); f >= 0 {
			shift = timings[f].dep.Sub(plan.Legs[f].DepartureTime)
		}
		timings[i].dep = leg.DepartureTime.Add(shift)
		timings[i].arr = leg.ArrivalTime.Add(shift)
	}
	return timings
}

func scheduledDeparture(leg gtfs.JourneyLeg) time.Time {
	if !leg.ScheduledDepartureTime.IsZero() {
		return leg.ScheduledDepartureTime
	}
	return leg.DepartureTime.Add(-time.Duration(leg.DelaySeconds) * time.Second)
}

func scheduledArrival(leg gtfs.JourneyLeg) time.Time {
	if !leg.ScheduledArrivalTime.IsZero() {
		return leg.ScheduledArrivalTime
	}
	return leg.ArrivalTime.Add(-time.Duration(leg.DelaySeconds) * time.Second)
}

func legFinished(leg gtfs.JourneyLeg, t legTiming, now time.Time) bool {
	if leg.Mode != "walk" && t.hasLive && t.live.HasVehicle {
		if t.live.StopsToAlight < 0 {
			return true
		}
		// Vehicle data can go quiet near the end of a trip - don't hold the
		// rider on this leg forever once it's well past due.
		return now.After(t.arr.Add(5 * time.Minute))
	}
	return !now.Before(t.arr)
}

func fillWalking(state *journeyActivityState, plan gtfs.JourneyPlan, timings []legTiming, idx int, now time.Time, hint activityHint) {
	leg, t := plan.Legs[idx], timings[idx]
	state.Phase = "walking"
	state.Headsign = stopLabel(leg.ToStop)
	walkMin := int(math.Max(1, math.Round(leg.ArrivalTime.Sub(leg.DepartureTime).Minutes())))
	state.WalkMinutes = &walkMin
	if leg.DistanceKm > 0 {
		m := int(math.Round(leg.DistanceKm * 1000))
		state.WalkMeters = &m
	}

	f := nextTransit(plan, idx)
	if f < 0 {
		// Final walk to the destination.
		state.PrimaryText = "Walk to your destination"
		if leg.ToStop != nil && leg.ToStop.StopName != "" {
			state.PrimaryText = "Walk to " + leg.ToStop.StopName
		}
		state.SecondaryText = fmt.Sprintf("Arrive about %s", clock(t.arr))
		state.CountdownLabel = "Arrive in"
		state.TargetUnix = float64(t.arr.Unix())
		setSegment(state, t.dep, t.arr)
		state.Status = "onTime"
		return
	}

	next, nt := plan.Legs[f], timings[f]
	state.RouteShortName = routeShortNameOrEmpty(next)
	state.RouteColorHex = routeColorOrEmpty(next)
	state.VehicleMode = vehicleModeOf(next)
	state.Platform = platformOf(next)
	fillRide(state, next, nt)
	if state.HasVehicle && nt.live.StopsToBoard >= 0 {
		away := nt.live.StopsToBoard
		state.StopsAway = &away
	}
	state.Status = statusFor(next, nt, "waiting")
	state.DelayMinutes = delayMinutes(nt.live.DepartureDelay, nt.hasLive && nt.live.HasTripUpdate)
	boardAt := stopLabel(next.FromStop)

	route := routeLabel(next.Route)
	walk := leg.ArrivalTime.Sub(leg.DepartureTime)
	firstWalk := prevTransit(plan, idx) < 0

	// Already on the way: when they left is fixed, so a ride that moves
	// changes how much time they have spare, never the leave time.
	if firstWalk && hint.LeftUnix > 0 {
		fillOnTheWay(state, f, next, t, nt, boardAt, now)
		return
	}

	// Before the first ride: count down to when to set off.
	leaveBy := leaveByTime(t.dep)
	note := runningNote(nt)
	if firstWalk && now.Before(leaveBy.Add(-30*time.Second)) {
		state.PrimaryText = "Leave by " + clock(leaveBy)
		state.SecondaryText = fmt.Sprintf("Walk to %s for the %s%s", boardAt, routeLabel(next.Route), note)
		state.CountdownLabel = "Leave in"
		state.TargetUnix = float64(leaveBy.Unix())
		if !now.Before(leaveBy.Add(-getReadyLead)) {
			state.PrimaryText = "Get ready to leave"
			state.SecondaryText = fmt.Sprintf("Leave by %s · walk to %s for the %s%s", clock(leaveBy), boardAt, routeLabel(next.Route), note)
			state.Urgent = true
			if now.Before(leaveBy.Add(-90 * time.Second)) {
				mins := int(math.Ceil(leaveBy.Sub(now).Minutes()))
				state.alert = &activityAlert{
					Key:   fmt.Sprintf("ready-%d", idx),
					Title: "Get ready to leave",
					Body:  fmt.Sprintf("Leave in %d min to walk to %s for the %s at %s.", mins, boardAt, routeLabel(next.Route), clock(nt.dep)),
				}
			}
		}
		return
	}

	state.PrimaryText = "Walk to " + boardAt
	state.SecondaryText = fmt.Sprintf("%s departs %s%s", routeLabel(next.Route), clock(nt.dep), platformSuffix(state.Platform))
	state.CountdownLabel = "Departs in"
	state.TargetUnix = float64(nt.dep.Unix())
	setSegment(state, t.dep, t.arr)

	if firstWalk {
		catchable := !now.Add(walk).After(nt.dep)
		walkMin := int(math.Max(1, math.Round(walk.Minutes())))
		early := earlyNote(route, nt)

		// Around the leave time the card itself says so, loudly, for long
		// enough that a rider who glances at the phone late still sees it -
		// and for as long as the ride can still be made while the phone can
		// see they're still at the start (a ride running early can move the
		// leave time minutes into the past).
		if now.Before(leaveBy.Add(leaveNowShownFor)) || (hint.Watching && catchable) {
			state.PrimaryText = "Leave now"
			state.SecondaryText = fmt.Sprintf("Walk to %s · %s departs %s%s", boardAt, route, clock(nt.dep), platformSuffix(state.Platform))
			state.Urgent = true
		}
		switch {
		case hint.Watching && now.Add(walk).After(nt.dep.Add(missTolerance)):
			// Still at the start and the ride goes before they could walk
			// there - usually because it's running early. Say so now, not
			// at the stop; the cron offers the next way to go.
			if state.Status != "cancelled" {
				state.Status = "missedConnection"
			}
			state.PrimaryText = "Too late for the " + route
			state.SecondaryText = fmt.Sprintf("It departs %s%s · %d min walk away", clock(nt.dep), note, walkMin)
			state.Urgent = false
			state.alert = &activityAlert{
				Key:   fmt.Sprintf("%s%d", missedFirstPrefix, f),
				Title: "You'll miss the " + route,
				Body:  fmt.Sprintf("%sIt leaves %s at %s - too soon to walk there.", early, boardAt, clock(nt.dep)),
			}
		case now.Before(leaveBy.Add(leaveNudgeAfter)):
			if !now.Before(leaveBy.Add(-60 * time.Second)) {
				state.alert = &activityAlert{
					Key:   fmt.Sprintf("leave-%d", idx),
					Title: "Time to leave",
					Body:  fmt.Sprintf("%sWalk to %s for the %s at %s.", early, boardAt, route, clock(nt.dep)),
				}
			}
		case catchable:
			// A couple of minutes past the leave time and still at the
			// start as far as we know: one more nudge while the ride can
			// still be made - the first is easy to miss with the phone in
			// a bag or across the room.
			state.alert = &activityAlert{
				Key:   fmt.Sprintf("leave-late-%d", idx),
				Title: "Leave now to make the " + route,
				Body:  fmt.Sprintf("%sIt departs %s from %s - a %d min walk.", early, clock(nt.dep), boardAt, walkMin),
			}
		}
	}

	// A walk between two rides: warn if the connection no longer works.
	if p := prevTransit(plan, idx); p >= 0 {
		applyConnection(state, plan, timings, p, f)
	}
}

// missTolerance is how far past the ride's departure the rider's predicted
// arrival at the stop has to be before they're told they'll miss it - a
// walk is often quicker than planned, and rides wait a moment at stops.
const missTolerance = time.Minute

// missedFirstPrefix keys the "you'll miss the first ride" alert - the cron
// adds the next way to go to it (see offerNextJourney).
const missedFirstPrefix = "missed-first-"

// fillOnTheWay is the walk to the first ride once the rider has set off:
// whether they'll make it, by when they left plus the walk - not a leave
// time that's already been and gone.
//
// t is the walk from when they left (see computeJourneyActivityState).
func fillOnTheWay(state *journeyActivityState, f int, next gtfs.JourneyLeg, t, nt legTiming, boardAt string, now time.Time) {
	route := routeLabel(next.Route)
	reach := t.arr
	if reach.Before(now) {
		reach = now // slower than planned and not there yet
	}
	state.PrimaryText = "Walk to " + boardAt
	state.CountdownLabel = "Departs in"
	state.TargetUnix = float64(nt.dep.Unix())
	setSegment(state, t.dep, reach)

	spare := nt.dep.Sub(reach)
	if spare < -missTolerance {
		if state.Status != "cancelled" {
			state.Status = "missedConnection"
		}
		state.SecondaryText = fmt.Sprintf("You'll likely miss the %s at %s", route, clock(nt.dep))
		state.alert = &activityAlert{
			Key:   fmt.Sprintf("%s%d", missedFirstPrefix, f),
			Title: "You'll likely miss the " + route,
			Body:  fmt.Sprintf("%sIt leaves %s at %s, before you'll get there.", earlyNote(route, nt), boardAt, clock(nt.dep)),
		}
		return
	}
	state.SecondaryText = fmt.Sprintf("%s departs %s%s · %s", route, clock(nt.dep), platformSuffix(state.Platform), spareNote(spare))
}

// spareNote is how long the rider will wait at the stop - "3 min spare".
func spareNote(spare time.Duration) string {
	if m := int(spare.Minutes()); m >= 1 {
		return fmt.Sprintf("%d min spare", m)
	}
	return "just in time"
}

// earlyNote opens an alert with why the ride's time moved earlier - "The
// 70 is running 4 min early. " - or is "" when it isn't early.
func earlyNote(route string, t legTiming) string {
	if !t.hasLive || !t.live.HasTripUpdate {
		return ""
	}
	if m := delayMinutes(t.live.DepartureDelay, true); m < 0 {
		return fmt.Sprintf("The %s is running %d min early. ", route, -m)
	}
	return ""
}

func fillTransit(state *journeyActivityState, plan gtfs.JourneyPlan, timings []legTiming, idx int, now time.Time, hint activityHint) {
	leg, t := plan.Legs[idx], timings[idx]
	hasVehicle := t.hasLive && t.live.HasVehicle
	route := routeLabel(leg.Route)

	state.RouteShortName = routeShortNameOrEmpty(leg)
	state.RouteColorHex = routeColorOrEmpty(leg)
	state.VehicleMode = vehicleModeOf(leg)
	state.Headsign = stopLabel(leg.ToStop)
	fillRide(state, leg, t)

	onboard := !now.Before(t.dep)
	if hasVehicle {
		onboard = t.live.StopsToBoard < 0
	}
	if hint.LegIndex == idx && hint.Phase == "onboard" {
		onboard = true
	}

	if !onboard {
		state.Phase = "waiting"
		if hasVehicle && t.live.StopsToBoard == 0 {
			state.Phase = "boarding"
		}
		state.Platform = platformOf(leg)
		state.CountdownLabel = "Departs in"
		state.TargetUnix = float64(t.dep.Unix())
		if idx > 0 {
			setSegment(state, timings[idx-1].arr, t.dep)
		}
		state.DelayMinutes = delayMinutes(t.live.DepartureDelay, t.hasLive && t.live.HasTripUpdate)
		state.Status = statusFor(leg, t, "waiting")

		if state.Phase == "boarding" {
			state.PrimaryText = fmt.Sprintf("Your %s is arriving", route)
		} else {
			state.PrimaryText = "Board the " + route
		}
		secondary := "at " + stopLabel(leg.FromStop) + platformSuffix(state.Platform)
		if hasVehicle && t.live.StopsToBoard >= 0 {
			away := t.live.StopsToBoard
			state.StopsAway = &away
			if away > 0 {
				secondary = fmt.Sprintf("%s · %s away", secondary, pluralStops(away))
			}
			if away <= 2 {
				title := fmt.Sprintf("Your %s is %s away", route, pluralStops(away))
				if away == 0 {
					title = fmt.Sprintf("Your %s is arriving", route)
				}
				state.alert = &activityAlert{Key: fmt.Sprintf("approach-%d", idx), Title: title, Body: "Board at " + stopLabel(leg.FromStop) + platformSuffix(state.Platform) + "."}
			}
		}
		state.SecondaryText = secondary
	} else {
		state.Phase = "onboard"
		state.CountdownLabel = "Arrives in"
		state.TargetUnix = float64(t.arr.Unix())
		setSegment(state, t.dep, t.arr)
		state.DelayMinutes = delayMinutes(t.live.ArrivalDelay, t.hasLive && t.live.HasTripUpdate)
		state.Status = statusFor(leg, t, "onboard")
		alight := stopLabel(leg.ToStop)

		nextStop := -1
		if hasVehicle && t.live.StopsToAlight >= 0 {
			nextStop = t.live.StopsToAlight
			away := nextStop
			state.StopsAway = &away
		}
		switch {
		case nextStop == 0:
			state.PrimaryText = "Get off at the next stop"
			state.SecondaryText = alight
		case nextStop > 0:
			state.PrimaryText = "Get off at " + alight
			state.SecondaryText = fmt.Sprintf("%s to go", pluralStops(nextStop+1))
			if t.live.NextStopName != "" {
				state.SecondaryText = fmt.Sprintf("%s · next %s", state.SecondaryText, t.live.NextStopName)
			}
		default:
			state.PrimaryText = "Get off at " + alight
			state.SecondaryText = fmt.Sprintf("Arrive %s", clock(t.arr))
		}

		// "Get off next" - from the vehicle's position when we have it,
		// otherwise from the clock.
		if nextStop == 0 || (nextStop < 0 && t.arr.Sub(now) <= 90*time.Second) {
			state.alert = &activityAlert{Key: fmt.Sprintf("alight-%d", idx), Title: "Get off at the next stop", Body: alight}
		}

		if f := nextTransit(plan, idx); f >= 0 {
			applyConnection(state, plan, timings, idx, f)
		}
	}

	if state.Status == "cancelled" {
		state.alert = &activityAlert{
			Key:   fmt.Sprintf("cancel-%d", idx),
			Title: fmt.Sprintf("The %s has been cancelled", route),
			Body:  "Tap to find another way.",
		}
	}
}

// fillRide sets the widget's structured fields for the ride the rider is
// on, or walking/waiting to catch.
func fillRide(state *journeyActivityState, leg gtfs.JourneyLeg, t legTiming) {
	if leg.FromStop != nil {
		state.BoardStopName = leg.FromStop.StopName
	}
	if leg.ToStop != nil {
		state.AlightStopName = leg.ToStop.StopName
	}
	if !t.hasLive {
		return
	}
	state.HasVehicle = t.live.HasVehicle
	if t.live.HasVehicle {
		state.NextStopName = t.live.NextStopName
		state.Occupancy = t.live.Occupancy
	}
	if t.live.RideStops > 0 {
		n := t.live.RideStops
		state.RideStops = &n
	}
}

// applyConnection sets nextLeg for the ride after `from`, and flags a
// connection that's become tight or impossible. Same rule as the app's
// `JourneyTracking.connectionRisk`: walking in between counts against the
// gap, 60s is the minimum realistic change, under 90s of slack is "tight".
func applyConnection(state *journeyActivityState, plan gtfs.JourneyPlan, timings []legTiming, from, to int) {
	next := plan.Legs[to]
	var walk time.Duration
	for j := from + 1; j < to; j++ {
		if plan.Legs[j].Mode == "walk" {
			walk += plan.Legs[j].ArrivalTime.Sub(plan.Legs[j].DepartureTime)
		}
	}
	transfer := timings[to].dep.Sub(timings[from].arr) - walk
	connect := int(math.Round(transfer.Minutes()))
	state.NextLeg = &activityNextLeg{
		RouteShortName: routeShortNameOrEmpty(next),
		RouteColorHex:  routeColorOrEmpty(next),
		DepartureUnix:  float64(timings[to].dep.Unix()),
		ConnectMinutes: connect,
	}

	if state.Status == "cancelled" {
		return
	}
	slack := transfer - 60*time.Second
	switch {
	case transfer < 0:
		state.Status = "missedConnection"
		state.SecondaryText = fmt.Sprintf("You'll likely miss the %s at %s", routeLabel(next.Route), clock(timings[to].dep))
		state.alert = &activityAlert{
			Key:   fmt.Sprintf("missed-%d", to),
			Title: fmt.Sprintf("You'll likely miss the %s", routeLabel(next.Route)),
			Body:  "Your connection no longer works. Tap to re-plan from here.",
		}
	case slack < 90*time.Second:
		state.Status = "tightConnection"
		state.SecondaryText = fmt.Sprintf("Then %s at %s · %d min to change", routeLabel(next.Route), clock(timings[to].dep), connect)
		if state.alert == nil {
			state.alert = &activityAlert{
				Key:   fmt.Sprintf("tight-%d", to),
				Title: "Tight connection",
				Body:  fmt.Sprintf("Only %d min to change to the %s.", connect, routeLabel(next.Route)),
			}
		}
	}
}

func statusFor(leg gtfs.JourneyLeg, t legTiming, phase string) string {
	if !leg.TripUsable || (t.hasLive && (t.live.Cancelled || t.live.AlightSkipped || (phase == "waiting" && t.live.BoardSkipped))) {
		return "cancelled"
	}
	delay := leg.DelaySeconds
	if t.hasLive && t.live.HasTripUpdate {
		delay = t.live.DepartureDelay
		if phase == "onboard" {
			delay = t.live.ArrivalDelay
		}
	}
	switch {
	case delay >= 120:
		return "delayed"
	case delay <= -120:
		return "early"
	default:
		return "onTime"
	}
}

// leaveByTime rounds a leave time down to the minute - mirrors
// LiveActivityContentBuilder.leaveBy on iOS. Earlier is the safe side, and a
// feed that wobbles by seconds no longer moves the countdown.
func leaveByTime(t time.Time) time.Time {
	return time.Unix(t.Unix()-((t.Unix()%60)+60)%60, 0).In(t.Location())
}

// runningNote is " · running 3 min late" when the next ride's departure has
// moved, so a leave countdown that jumps says why. Mirrors runningNote on iOS.
func runningNote(t legTiming) string {
	if !t.hasLive || !t.live.HasTripUpdate {
		return ""
	}
	m := delayMinutes(t.live.DepartureDelay, true)
	switch {
	case m > 0:
		return fmt.Sprintf(" · running %d min late", m)
	case m < 0:
		return fmt.Sprintf(" · running %d min early", -m)
	}
	return ""
}

func delayMinutes(seconds int, known bool) int {
	if !known {
		return 0
	}
	return int(math.Round(float64(seconds) / 60))
}

func progress(idx, n int, t legTiming, now time.Time) float64 {
	frac := 0.0
	if d := t.arr.Sub(t.dep); d > 0 && now.After(t.dep) {
		frac = math.Min(1, now.Sub(t.dep).Seconds()/d.Seconds())
	}
	return math.Max(0, math.Min(1, (float64(idx)+frac)/float64(n)))
}

func legChain(plan gtfs.JourneyPlan) []activityLegChip {
	chain := make([]activityLegChip, 0, len(plan.Legs))
	for _, leg := range plan.Legs {
		if len(chain) == 6 {
			break
		}
		if leg.Mode == "walk" {
			chain = append(chain, activityLegChip{Mode: "walk"})
			continue
		}
		chain = append(chain, activityLegChip{Mode: "transit", ShortName: routeShortNameOrEmpty(leg), ColorHex: routeColorOrEmpty(leg)})
	}
	return chain
}

func prevTransit(plan gtfs.JourneyPlan, i int) int {
	for j := i - 1; j >= 0; j-- {
		if plan.Legs[j].Mode != "walk" {
			return j
		}
	}
	return -1
}

func nextTransit(plan gtfs.JourneyPlan, i int) int {
	for j := i + 1; j < len(plan.Legs); j++ {
		if plan.Legs[j].Mode != "walk" {
			return j
		}
	}
	return -1
}

func platformOf(leg gtfs.JourneyLeg) *string {
	if leg.FromStop == nil || leg.FromStop.PlatformNumber == "" {
		return nil
	}
	p := leg.FromStop.PlatformNumber
	return &p
}

func platformSuffix(platform *string) string {
	if platform == nil {
		return ""
	}
	return " · Platform " + *platform
}

func pluralStops(n int) string {
	if n == 1 {
		return "1 stop"
	}
	return fmt.Sprintf("%d stops", n)
}

// clock formats a time the way the rest of the app does ("9:05am"), in the
// time's own location - callers pass NZ-local times.
func clock(t time.Time) string {
	return strings.ToLower(t.Format("3:04PM"))
}

func stopLabel(s *gtfs.Stop) string {
	if s == nil || s.StopName == "" {
		return "your destination"
	}
	return s.StopName
}

func routeLabel(r *gtfs.Route) string {
	if r == nil || r.RouteShortName == "" {
		return "service"
	}
	return r.RouteShortName
}

func routeShortNameOrEmpty(leg gtfs.JourneyLeg) string {
	if leg.Mode == "walk" {
		return ""
	}
	if leg.Route != nil && leg.Route.RouteShortName != "" {
		return leg.Route.RouteShortName
	}
	return leg.RouteID
}

func routeColorOrEmpty(leg gtfs.JourneyLeg) string {
	if leg.Mode == "walk" || leg.Route == nil {
		return ""
	}
	return leg.Route.RouteColor
}

// setSegment sets the ring's segment: the walk (start -> reaching the stop or
// destination), the wait (reaching the stop -> departure) or the ride
// (departure -> arrival). Same rule as the Swift builder's `setSegment`.
func setSegment(state *journeyActivityState, start, end time.Time) {
	if !end.After(start) {
		return
	}
	state.SegmentStartUnix = float64(start.Unix())
	state.SegmentEndUnix = float64(end.Unix())
}

// vehicleModeOf is the ride's travel mode (bus | train | ferry) from its
// route_type, for the widget's vehicle icon. Empty for walks or unknown types.
func vehicleModeOf(leg gtfs.JourneyLeg) string {
	if leg.Mode == "walk" || leg.Route == nil {
		return ""
	}
	for mode, types := range travelModeRouteTypes {
		for _, t := range types {
			if t == leg.Route.RouteType {
				return mode
			}
		}
	}
	return ""
}

// stateHash fingerprints what a rider would notice changing. Countdown
// targets are included at minute resolution (they only move when a delay
// does); progress isn't, since it ticks every cron run on its own.
func (s journeyActivityState) stateHash() string {
	stopsAway := -1
	if s.StopsAway != nil {
		stopsAway = *s.StopsAway
	}
	connect := ""
	if s.NextLeg != nil {
		connect = fmt.Sprintf("%s@%d/%d", s.NextLeg.RouteShortName, int64(s.NextLeg.DepartureUnix)/60, s.NextLeg.ConnectMinutes)
	}
	raw := fmt.Sprintf("%d|%s|%s|%s|%s|%s|%d|%d|%d|%s|%s|%t",
		s.LegIndex, s.Phase, s.RouteShortName, s.PrimaryText, s.SecondaryText, s.Status,
		s.DelayMinutes, stopsAway, int64(s.TargetUnix)/60, connect, s.NextStopName, s.HasVehicle)
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}
