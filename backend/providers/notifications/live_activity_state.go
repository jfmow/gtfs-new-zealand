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
	BoardStopName  string  `json:"boardStopName,omitempty"`
	AlightStopName string  `json:"alightStopName,omitempty"`
	NextStopName   string  `json:"nextStopName,omitempty"`
	RideStops      *int    `json:"rideStops,omitempty"` // stops ridden, board -> alight
	WalkMinutes    *int    `json:"walkMinutes,omitempty"`
	WalkMeters     *int    `json:"walkMeters,omitempty"`
	HasVehicle     bool    `json:"hasVehicle"`
	Occupancy      *int    `json:"occupancy,omitempty"` // GTFS-RT occupancy status; device-only for now

	// alert is a one-off "tell the rider now" moment, sent as the push's
	// alert (sound + banner) rather than a silent update. Not part of the
	// widget's content-state.
	alert *activityAlert
}

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
	// Sound plays with the Live Activity alert - only when a regular
	// notification (which carries its own sound) couldn't be sent, so the
	// phone buzzes once, not twice.
	Sound bool
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
}

// liveLegLookup returns realtime for the transit leg at index i, or false
// when there's none.
type liveLegLookup func(i int, leg gtfs.JourneyLeg) (legLive, bool)

// activityHint is what the phone last reported (POST .../live-activities/leg)
// - a floor the server never moves behind.
type activityHint struct {
	LegIndex int
	Phase    string
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
		fillWalking(&state, plan, timings, idx, now)
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

func fillWalking(state *journeyActivityState, plan gtfs.JourneyPlan, timings []legTiming, idx int, now time.Time) {
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
		state.Status = "onTime"
		return
	}

	next, nt := plan.Legs[f], timings[f]
	state.RouteShortName = routeShortNameOrEmpty(next)
	state.RouteColorHex = routeColorOrEmpty(next)
	state.Platform = platformOf(next)
	fillRide(state, next, nt)
	if state.HasVehicle && nt.live.StopsToBoard >= 0 {
		away := nt.live.StopsToBoard
		state.StopsAway = &away
	}
	state.Status = statusFor(next, nt, "waiting")
	state.DelayMinutes = delayMinutes(nt.live.DepartureDelay, nt.hasLive && nt.live.HasTripUpdate)
	boardAt := stopLabel(next.FromStop)

	// Before the first ride: count down to when to set off.
	leaveBy := t.dep
	if prevTransit(plan, idx) < 0 && now.Before(leaveBy.Add(-30*time.Second)) {
		state.PrimaryText = "Leave by " + clock(leaveBy)
		state.SecondaryText = fmt.Sprintf("Walk to %s for the %s", boardAt, routeLabel(next.Route))
		state.CountdownLabel = "Leave in"
		state.TargetUnix = float64(leaveBy.Unix())
		return
	}

	state.PrimaryText = "Walk to " + boardAt
	state.SecondaryText = fmt.Sprintf("%s departs %s%s", routeLabel(next.Route), clock(nt.dep), platformSuffix(state.Platform))
	state.CountdownLabel = "Departs in"
	state.TargetUnix = float64(nt.dep.Unix())

	if prevTransit(plan, idx) < 0 && !now.Before(leaveBy.Add(-60*time.Second)) {
		state.alert = &activityAlert{
			Key:   fmt.Sprintf("leave-%d", idx),
			Title: "Time to leave",
			Body:  fmt.Sprintf("Walk to %s for the %s at %s.", boardAt, routeLabel(next.Route), clock(nt.dep)),
		}
	}

	// A walk between two rides: warn if the connection no longer works.
	if p := prevTransit(plan, idx); p >= 0 {
		applyConnection(state, plan, timings, p, f)
	}
}

func fillTransit(state *journeyActivityState, plan gtfs.JourneyPlan, timings []legTiming, idx int, now time.Time, hint activityHint) {
	leg, t := plan.Legs[idx], timings[idx]
	hasVehicle := t.hasLive && t.live.HasVehicle
	route := routeLabel(leg.Route)

	state.RouteShortName = routeShortNameOrEmpty(leg)
	state.RouteColorHex = routeColorOrEmpty(leg)
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
