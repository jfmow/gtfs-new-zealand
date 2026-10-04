package providers

import "testing"

const minuteMs = int64(60 * 1000)

// A 3-stop trip scheduled from t0, 5 min between stops, predicted offsetMs
// off schedule.
func boundsTrip(t0, offsetMs int64) []StopTimes {
	var stops []StopTimes
	for i := 0; i < 3; i++ {
		sched := t0 + int64(i)*5*minuteMs
		stops = append(stops, StopTimes{
			ArrivalTime:        sched + offsetMs,
			DepartureTime:      sched + offsetMs,
			ScheduledTime:      sched,
			index:              i,
			scheduledDeparture: sched,
		})
	}
	return stops
}

func TestUnstartedTripIsNeverEarly(t *testing.T) {
	t0 := int64(1_000_000_000_000)
	// Bus not out, 10 min before it's due to start, feed says 5 min early -
	// and with its early times already "passed" the first stop.
	stops := boundsTrip(t0, -5*minuteMs)
	stops[0].Passed = true
	boundUnreachedStopTimes(stops, false, false, t0-10*minuteMs)
	for i, s := range stops {
		if s.ArrivalTime != s.ScheduledTime || s.DepartureTime != s.scheduledDeparture {
			t.Errorf("stop %d: got arrival %d departure %d, want schedule %d", i, s.ArrivalTime, s.DepartureTime, s.ScheduledTime)
		}
		if s.Passed {
			t.Errorf("stop %d passed before the trip started", i)
		}
	}

	// Late predictions stand.
	late := boundsTrip(t0, 4*minuteMs)
	boundUnreachedStopTimes(late, false, false, t0-10*minuteMs)
	if late[2].ArrivalTime != late[2].ScheduledTime+4*minuteMs {
		t.Errorf("late prediction changed: %d", late[2].ArrivalTime-late[2].ScheduledTime)
	}
}

func TestBusWaitingAtFirstStopIsNotEarly(t *testing.T) {
	t0 := int64(1_000_000_000_000)
	stops := boundsTrip(t0, -3*minuteMs)
	boundUnreachedStopTimes(stops, true, false, t0-5*minuteMs)
	if stops[1].ArrivalTime != stops[1].ScheduledTime {
		t.Errorf("got %d min off schedule, want on time", (stops[1].ArrivalTime-stops[1].ScheduledTime)/minuteMs)
	}
}

func TestRunningTripKeepsEarlyPrediction(t *testing.T) {
	t0 := int64(1_000_000_000_000)
	stops := boundsTrip(t0, -2*minuteMs)
	stops[0].Passed = true
	boundUnreachedStopTimes(stops, true, true, t0+minuteMs)
	if stops[2].ArrivalTime != stops[2].ScheduledTime-2*minuteMs {
		t.Errorf("running bus's early prediction changed: %d", stops[2].ArrivalTime-stops[2].ScheduledTime)
	}
}

func TestPredictionsBehindTheBusShiftForward(t *testing.T) {
	t0 := int64(1_000_000_000_000)
	// The 22N case: predicted at stop 1 at t0+5-5 = t0, but at t0+2 the
	// bus's position puts it still short of stop 1.
	stops := boundsTrip(t0, -5*minuteMs)
	stops[0].Passed = true
	now := t0 + 2*minuteMs
	boundUnreachedStopTimes(stops, true, true, now)
	if stops[1].ArrivalTime != now {
		t.Errorf("next stop: got %d, want now", stops[1].ArrivalTime-now)
	}
	if got := stops[2].ArrivalTime - stops[1].ArrivalTime; got != 5*minuteMs {
		t.Errorf("spacing changed: %d", got)
	}
	if stops[0].ArrivalTime != stops[0].ScheduledTime-5*minuteMs {
		t.Errorf("passed stop moved")
	}
}

func TestNoVehicleAfterScheduledStartTrustsPredictions(t *testing.T) {
	t0 := int64(1_000_000_000_000)
	stops := boundsTrip(t0, -2*minuteMs)
	stops[0].Passed = true
	boundUnreachedStopTimes(stops, false, false, t0+3*minuteMs)
	if !stops[0].Passed || stops[2].ArrivalTime != stops[2].ScheduledTime-2*minuteMs {
		t.Errorf("predictions changed without a vehicle to go by")
	}
}
