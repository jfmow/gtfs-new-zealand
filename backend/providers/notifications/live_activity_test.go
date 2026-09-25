package notifications

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
)

// testPlan: walk 5 min to Britomart, wait, ride the 70 from 9:08 to 9:25,
// walk 5 min to the destination.
func testPlan(base time.Time) gtfs.JourneyPlan {
	walkStop := &gtfs.Stop{StopId: "walk-end", StopName: "Britomart"}
	boardStop := &gtfs.Stop{StopId: "board", StopName: "Britomart", PlatformNumber: "3"}
	alightStop := &gtfs.Stop{StopId: "alight", StopName: "Newmarket"}
	route := &gtfs.Route{RouteId: "70-201", RouteShortName: "70", RouteColor: "0073bd"}

	return gtfs.JourneyPlan{
		ID:            "test-plan",
		DepartureTime: base,
		ArrivalTime:   base.Add(30 * time.Minute),
		Legs: []gtfs.JourneyLeg{
			{
				Mode: "walk", ToStop: walkStop,
				DepartureTime: base, ArrivalTime: base.Add(5 * time.Minute),
				TripUsable: true,
			},
			{
				Mode: "transit", TripID: "trip-70", Route: route, FromStop: boardStop, ToStop: alightStop,
				DepartureTime: base.Add(8 * time.Minute), ArrivalTime: base.Add(25 * time.Minute),
				TripUsable: true,
			},
			{
				Mode: "walk", ToStop: &gtfs.Stop{StopId: "dest", StopName: "Destination"},
				DepartureTime: base.Add(25 * time.Minute), ArrivalTime: base.Add(30 * time.Minute),
				TripUsable: true,
			},
		},
	}
}

// twoRidePlan: ride A 9:00-9:10, walk 2 min, ride B departs 9:14.
func twoRidePlan(base time.Time) gtfs.JourneyPlan {
	a := &gtfs.Route{RouteShortName: "A", RouteColor: "111111"}
	b := &gtfs.Route{RouteShortName: "B", RouteColor: "222222"}
	return gtfs.JourneyPlan{
		ID: "two-ride", DepartureTime: base, ArrivalTime: base.Add(30 * time.Minute),
		Legs: []gtfs.JourneyLeg{
			{Mode: "transit", TripID: "trip-a", Route: a, FromStop: &gtfs.Stop{StopId: "s1", StopName: "One"}, ToStop: &gtfs.Stop{StopId: "s2", StopName: "Two"},
				DepartureTime: base, ArrivalTime: base.Add(10 * time.Minute), TripUsable: true},
			{Mode: "walk", ToStop: &gtfs.Stop{StopId: "s3", StopName: "Three"},
				DepartureTime: base.Add(10 * time.Minute), ArrivalTime: base.Add(12 * time.Minute), TripUsable: true},
			{Mode: "transit", TripID: "trip-b", Route: b, FromStop: &gtfs.Stop{StopId: "s3", StopName: "Three"}, ToStop: &gtfs.Stop{StopId: "s4", StopName: "Four"},
				DepartureTime: base.Add(14 * time.Minute), ArrivalTime: base.Add(30 * time.Minute), TripUsable: true},
		},
	}
}

var base = time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)

func liveFor(byTrip map[string]legLive) liveLegLookup {
	return func(_ int, leg gtfs.JourneyLeg) (legLive, bool) {
		l, ok := byTrip[leg.TripID]
		return l, ok
	}
}

func TestActivity_BeforeLeavingCountsDownToLeaveBy(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(-3*time.Minute), nil, noHint)
	if state.Phase != "walking" || state.LegIndex != 0 {
		t.Fatalf("want leg 0 walking, got leg %d %s", state.LegIndex, state.Phase)
	}
	if state.PrimaryText != "Leave by 9:00am" || state.CountdownLabel != "Leave in" {
		t.Errorf("primary=%q label=%q", state.PrimaryText, state.CountdownLabel)
	}
	if int64(state.TargetUnix) != base.Unix() {
		t.Errorf("target should be the leave-by time")
	}
	if state.RouteShortName != "70" {
		t.Errorf("walking to a ride should show that ride's route, got %q", state.RouteShortName)
	}
	if state.alert != nil {
		t.Errorf("no alert 3 min before leaving, got %+v", state.alert)
	}
}

func TestActivity_TimeToLeaveAlertsOnce(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(10*time.Second), nil, noHint)
	if state.alert == nil || state.alert.Key != "leave-0" || state.alert.Title != "Time to leave" {
		t.Fatalf("want a leave alert, got %+v", state.alert)
	}
	if state.PrimaryText != "Walk to Britomart" || state.CountdownLabel != "Departs in" {
		t.Errorf("primary=%q label=%q", state.PrimaryText, state.CountdownLabel)
	}
	if int64(state.TargetUnix) != base.Add(8*time.Minute).Unix() {
		t.Errorf("walking countdown should target the ride's departure")
	}
}

// v1 bug: the waiting countdown targeted the leg's *arrival*.
func TestActivity_WaitingCountsDownToDeparture(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), nil, noHint)
	if state.LegIndex != 1 || state.Phase != "waiting" {
		t.Fatalf("want leg 1 waiting, got leg %d %s", state.LegIndex, state.Phase)
	}
	if int64(state.TargetUnix) != base.Add(8*time.Minute).Unix() {
		t.Errorf("waiting countdown should target departure (9:08), got %v", time.Unix(int64(state.TargetUnix), 0).UTC())
	}
	if state.Platform == nil || *state.Platform != "3" {
		t.Errorf("want platform 3, got %v", state.Platform)
	}
	if state.PrimaryText != "Board the 70" {
		t.Errorf("primary = %q", state.PrimaryText)
	}
}

func TestActivity_OnboardByClockCountsDownToArrival(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(15*time.Minute), nil, noHint)
	if state.Phase != "onboard" || state.PrimaryText != "Get off at Newmarket" {
		t.Fatalf("phase=%s primary=%q", state.Phase, state.PrimaryText)
	}
	if int64(state.TargetUnix) != base.Add(25*time.Minute).Unix() {
		t.Errorf("onboard countdown should target arrival")
	}
}

func TestActivity_RealtimeDelayShiftsEverything(t *testing.T) {
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, DepartureDelay: 300, ArrivalDelay: 300}})

	// 9:06 by the timetable the ride leaves at 9:08, but it's 5 min late.
	waiting := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), live, noHint)
	if waiting.Status != "delayed" || waiting.DelayMinutes != 5 {
		t.Errorf("status=%s delay=%d", waiting.Status, waiting.DelayMinutes)
	}
	if int64(waiting.TargetUnix) != base.Add(13*time.Minute).Unix() {
		t.Errorf("waiting should target the live departure 9:13")
	}
	if !waiting.IsRealtime {
		t.Errorf("state should be flagged realtime")
	}

	// The leave-by time moves later with it.
	before := computeJourneyActivityState(testPlan(base), base.Add(2*time.Minute), live, noHint)
	if before.PrimaryText != "Leave by 9:05am" {
		t.Errorf("leave-by should shift with the delay, got %q", before.PrimaryText)
	}
}

func TestActivity_VehicleStopsAwayAndApproachAlert(t *testing.T) {
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: 2, StopsToAlight: 9}})
	state := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), live, noHint)
	if state.StopsAway == nil || *state.StopsAway != 2 {
		t.Fatalf("stopsAway = %v", state.StopsAway)
	}
	if state.alert == nil || state.alert.Key != "approach-1" || state.alert.Title != "Your 70 is 2 stops away" {
		t.Errorf("alert = %+v", state.alert)
	}
	if !strings.Contains(state.SecondaryText, "2 stops away") {
		t.Errorf("secondary = %q", state.SecondaryText)
	}
}

func TestActivity_LateVehicleKeepsRiderWaitingPastScheduledDeparture(t *testing.T) {
	// Clock says the ride left at 9:08, but the bus hasn't reached the stop.
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: 1, StopsToAlight: 8}})
	state := computeJourneyActivityState(testPlan(base), base.Add(9*time.Minute), live, noHint)
	if state.Phase != "waiting" {
		t.Errorf("want waiting while the bus is still a stop away, got %s", state.Phase)
	}
}

func TestActivity_GetOffNextStop(t *testing.T) {
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: -5, StopsToAlight: 0, NextStopName: "Newmarket"}})
	state := computeJourneyActivityState(testPlan(base), base.Add(20*time.Minute), live, noHint)
	if state.PrimaryText != "Get off at the next stop" || state.SecondaryText != "Newmarket" {
		t.Errorf("primary=%q secondary=%q", state.PrimaryText, state.SecondaryText)
	}
	if state.alert == nil || state.alert.Key != "alight-1" {
		t.Errorf("want alight alert, got %+v", state.alert)
	}
}

func TestActivity_PhoneHintIsAFloor(t *testing.T) {
	// Clock says still walking (leg 0), but the phone saw the rider board.
	state := computeJourneyActivityState(testPlan(base), base.Add(2*time.Minute), nil, activityHint{LegIndex: 1, Phase: "onboard"})
	if state.LegIndex != 1 || state.Phase != "onboard" {
		t.Errorf("want leg 1 onboard from the hint, got leg %d %s", state.LegIndex, state.Phase)
	}
	// A stale hint behind the clock is ignored.
	state = computeJourneyActivityState(testPlan(base), base.Add(27*time.Minute), nil, activityHint{LegIndex: 1, Phase: "onboard"})
	if state.LegIndex != 2 {
		t.Errorf("a hint must never move the rider backwards, got leg %d", state.LegIndex)
	}
}

func TestActivity_Arrived(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(31*time.Minute), nil, noHint)
	if state.Status != "arrived" || state.Phase != "arrived" || state.ProgressFraction != 1 {
		t.Fatalf("status=%s phase=%s progress=%f", state.Status, state.Phase, state.ProgressFraction)
	}
}

func TestActivity_CancelledFromRealtime(t *testing.T) {
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, Cancelled: true}})
	state := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), live, noHint)
	if state.Status != "cancelled" {
		t.Fatalf("status = %s", state.Status)
	}
	if state.alert == nil || state.alert.Key != "cancel-1" {
		t.Errorf("want cancel alert, got %+v", state.alert)
	}
}

func TestActivity_MissedConnection(t *testing.T) {
	// Ride A is 4 min late: arrives 9:14, 2 min walk, B leaves 9:14.
	live := liveFor(map[string]legLive{"trip-a": {HasTripUpdate: true, DepartureDelay: 240, ArrivalDelay: 240}})
	state := computeJourneyActivityState(twoRidePlan(base), base.Add(8*time.Minute), live, noHint)
	if state.Status != "missedConnection" {
		t.Fatalf("status = %s", state.Status)
	}
	if state.NextLeg == nil || state.NextLeg.RouteShortName != "B" || state.NextLeg.ConnectMinutes != -2 {
		t.Errorf("nextLeg = %+v", state.NextLeg)
	}
	if state.alert == nil || state.alert.Key != "missed-2" {
		t.Errorf("alert = %+v", state.alert)
	}
}

func TestActivity_ConnectionRiskMatchesAppRule(t *testing.T) {
	// 2 min to change (60s minimum + under 90s slack) is tight - the same
	// rule as the app's JourneyTracking.connectionRisk.
	tight := computeJourneyActivityState(twoRidePlan(base), base.Add(5*time.Minute), nil, noHint)
	if tight.Status != "tightConnection" || tight.NextLeg == nil || tight.NextLeg.ConnectMinutes != 2 {
		t.Errorf("status=%s nextLeg=%+v", tight.Status, tight.NextLeg)
	}

	roomy := twoRidePlan(base)
	roomy.Legs[2].DepartureTime = base.Add(20 * time.Minute)
	state := computeJourneyActivityState(roomy, base.Add(5*time.Minute), nil, noHint)
	if state.Status != "onTime" || state.NextLeg == nil || state.NextLeg.ConnectMinutes != 8 {
		t.Errorf("status=%s nextLeg=%+v", state.Status, state.NextLeg)
	}
	if state.alert != nil {
		t.Errorf("a comfortable connection shouldn't alert, got %+v", state.alert)
	}
}

func TestActivity_HashIgnoresProgressButNotStops(t *testing.T) {
	plan := testPlan(base)
	a := computeJourneyActivityState(plan, base.Add(15*time.Minute), nil, noHint)
	b := computeJourneyActivityState(plan, base.Add(16*time.Minute), nil, noHint)
	if a.stateHash() != b.stateHash() {
		t.Errorf("hash should be stable while only progress ticks")
	}

	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: -2, StopsToAlight: 4}})
	c := computeJourneyActivityState(plan, base.Add(15*time.Minute), live, noHint)
	if a.stateHash() == c.stateHash() {
		t.Errorf("hash should change when stops-away appears")
	}
}

func TestActivity_JSONMatchesWidgetContract(t *testing.T) {
	state := computeJourneyActivityState(testPlan(base), base.Add(6*time.Minute), nil, noHint)
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(raw, &m)
	for _, key := range []string{"version", "legIndex", "phase", "primaryText", "secondaryText", "countdownLabel", "targetUnix", "arrivalUnix", "status", "legChain", "updatedUnix"} {
		if _, ok := m[key]; !ok {
			t.Errorf("content-state missing %q", key)
		}
	}
	if _, ok := m["alert"]; ok {
		t.Errorf("the alert must not leak into the content-state")
	}
	if chain := m["legChain"].([]any); len(chain) != 3 {
		t.Errorf("legChain length = %d", len(chain))
	}
}

func TestReminderPlanID(t *testing.T) {
	cases := map[string]JourneyReminder{
		"from-resolve": {PlanID: "from-resolve", Deeplink: "/journey?id=other"},
		"abc-123":      {Deeplink: "/journey?id=abc-123&region=at"},
		"def":          {Deeplink: "transit://journey?id=def"},
		"":             {Deeplink: "/plan?startLat=1"},
	}
	for want, r := range cases {
		if got := reminderPlanID(r); got != want {
			t.Errorf("reminderPlanID(%+v) = %q, want %q", r, got, want)
		}
	}
}

func TestActivity_V3RideFields(t *testing.T) {
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: -1, StopsToAlight: 3, NextStopName: "Grafton", RideStops: 9}})
	state := computeJourneyActivityState(testPlan(base), base.Add(15*time.Minute), live, noHint)
	if state.Version != 3 || state.Phase != "onboard" {
		t.Fatalf("version/phase = %d/%s", state.Version, state.Phase)
	}
	if state.BoardStopName != "Britomart" || state.AlightStopName != "Newmarket" || state.NextStopName != "Grafton" {
		t.Errorf("stop names = %q %q %q", state.BoardStopName, state.AlightStopName, state.NextStopName)
	}
	if state.RideStops == nil || *state.RideStops != 9 || !state.HasVehicle {
		t.Errorf("rideStops = %v hasVehicle = %v", state.RideStops, state.HasVehicle)
	}
}

func TestActivity_WalkingShowsWalkAndApproachingVehicle(t *testing.T) {
	plan := testPlan(base)
	plan.Legs[0].DistanceKm = 0.42
	live := liveFor(map[string]legLive{"trip-70": {HasTripUpdate: true, HasVehicle: true, StopsToBoard: 5, StopsToAlight: 14}})
	state := computeJourneyActivityState(plan, base.Add(1*time.Minute), live, noHint)
	if state.Phase != "walking" || state.WalkMinutes == nil || *state.WalkMinutes != 5 || state.WalkMeters == nil || *state.WalkMeters != 420 {
		t.Fatalf("walk = %v %v %v", state.Phase, state.WalkMinutes, state.WalkMeters)
	}
	if state.StopsAway == nil || *state.StopsAway != 5 || state.BoardStopName != "Britomart" {
		t.Errorf("approach = %v %q", state.StopsAway, state.BoardStopName)
	}
}

func TestFindLegStop_FallsBackToParentStation(t *testing.T) {
	stops := []gtfs.Stop{
		{StopId: "a-1", ParentStation: "A", Sequence: 1},
		{StopId: "b-2", ParentStation: "B", Sequence: 2},
		{StopId: "a-3", ParentStation: "A", Sequence: 3},
	}
	// Exact platform wins.
	if got := findLegStop(stops, &gtfs.Stop{StopId: "b-2", ParentStation: "B"}, -1); got != 1 {
		t.Fatalf("exact match: got %d, want 1", got)
	}
	// The plan's platform isn't the one the trip uses: same station.
	if got := findLegStop(stops, &gtfs.Stop{StopId: "b-9", ParentStation: "B"}, -1); got != 1 {
		t.Fatalf("parent fallback: got %d, want 1", got)
	}
	// A second visit to a station is found only after the boarding stop.
	if got := findLegStop(stops, &gtfs.Stop{StopId: "a-9", ParentStation: "A"}, 1); got != 2 {
		t.Fatalf("after board: got %d, want 2", got)
	}
	if got := findLegStop(stops, &gtfs.Stop{StopId: "zz"}, -1); got != -1 {
		t.Fatalf("no match: got %d, want -1", got)
	}
}

func TestStopDisplayName_UsesParentName(t *testing.T) {
	parents := map[string]gtfs.Stop{"p2": {StopName: "Newmarket Train Station"}}
	if got := stopDisplayName(gtfs.Stop{StopId: "p2", ParentStation: "NM", StopName: "Newmarket Train Station 2"}, parents); got != "Newmarket Train Station" {
		t.Fatalf("got %q", got)
	}
	if got := stopDisplayName(gtfs.Stop{StopId: "b1", StopName: "Karangahape Road"}, parents); got != "Karangahape Road" {
		t.Fatalf("got %q", got)
	}
}
