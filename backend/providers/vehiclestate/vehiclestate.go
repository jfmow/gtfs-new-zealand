// Package vehiclestate derives a rider-facing "what is this vehicle doing
// right now" state from GTFS-realtime data. It is shared by the live
// map/tracker (backend/providers) and the reminder-notification cron
// (backend/providers/notifications) so both use identical, position-accurate
// logic - previously the two had diverged, with the reminder cron using a
// less accurate, timestamp-only copy.
package vehiclestate

import (
	"math"
	"sort"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime/proto"
)

// AtStopProximityMeters is how close a vehicle's live GPS position must be to
// a stop before a predicted-time-only "AtStop"/"Leaving" call is trusted.
// Predicted times can pass before a delayed vehicle's real position gets there.
const AtStopProximityMeters = 100.0

// Haversine returns the distance in meters between two lat/lon points.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters

	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	lat1 = lat1 * math.Pi / 180
	lat2 = lat2 * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1)*math.Cos(lat2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

// IsNearStop reports whether the vehicle is within AtStopProximityMeters of
// the stop at stopIndex in stopsForTrip. Returns true (trusting the caller's
// time-based prediction) whenever position data isn't available to check
// against, so callers without a live vehicle position keep their existing
// behavior.
func IsNearStop(stopsForTrip []gtfs.Stop, stopIndex int, vehicleLat, vehicleLon float64) bool {
	if (vehicleLat == 0 && vehicleLon == 0) || stopIndex < 0 || stopIndex >= len(stopsForTrip) {
		return true
	}
	stop := stopsForTrip[stopIndex]
	return Haversine(vehicleLat, vehicleLon, stop.StopLat, stop.StopLon) <= AtStopProximityMeters
}

// stateFromCurrentStatus decides state directly from the live vehicle's own
// GTFS-realtime CurrentStatus (STOPPED_AT / INCOMING_AT / IN_TRANSIT_TO) -
// authoritative and far less noisy than inferring position purely from
// predicted stop times. Returns ok=false when there's no usable live status
// (no vehicle, unset fields, or an out-of-range stop sequence), so the caller
// can fall back to the timestamp heuristic.
func stateFromCurrentStatus(vehicle *proto.VehiclePosition, lowestSequence int, stopsForTrip []gtfs.Stop, vehicleLat, vehicleLon float64) (int, string, bool) {
	if vehicle == nil || vehicle.CurrentStatus == nil || vehicle.CurrentStopSequence == nil {
		return 0, "", false
	}

	idx := int(vehicle.GetCurrentStopSequence()) - lowestSequence
	if idx < 0 || idx >= len(stopsForTrip) {
		return 0, "", false
	}

	hasPosition := !(vehicleLat == 0 && vehicleLon == 0)

	switch vehicle.GetCurrentStatus() {
	case proto.VehiclePosition_STOPPED_AT:
		// Cross-check against live position, same caution the old
		// timestamp-only heuristic applied - a feed can be briefly stale.
		if hasPosition && !IsNearStop(stopsForTrip, idx, vehicleLat, vehicleLon) {
			return 0, "", false
		}
		return idx + 1, "AtStop", true
	case proto.VehiclePosition_INCOMING_AT:
		return idx, "Arriving", true
	case proto.VehiclePosition_IN_TRANSIT_TO:
		// Still close to the stop it just left ("pulling away") vs genuinely
		// mid-route - only distinguishable when we have a live position.
		if hasPosition && IsNearStop(stopsForTrip, idx-1, vehicleLat, vehicleLon) {
			return idx, "Leaving", true
		}
		return idx, "Travelling", true
	default:
		return 0, "", false
	}
}

// GetNextStopSequence inspects a trip's StopTimeUpdates (which may include
// historical entries) and determines the next stop sequence number relative
// to lowestSequence, an associated event time (arrival or departure), and a
// state string describing what the vehicle is doing right now: "Unknown",
// "Arriving", "AtStop", "Leaving", or "Travelling".
//
// State is decided primarily from vehicle's own live CurrentStatus when
// available (see stateFromCurrentStatus); otherwise it falls back to the
// original heuristic of scanning stopUpdates for the first upcoming event,
// confirming a predicted "AtStop" against position via IsNearStop, unable in
// that fallback to distinguish "Leaving" from "Travelling". If no future
// event is found either way, it returns the sequence after the most recently
// departed stop. Pass vehicle=nil / vehicleLat,vehicleLon=0,0 to skip the
// live-position refinements entirely and trust predictions outright.
func GetNextStopSequence(
	stopUpdates []*proto.TripUpdate_StopTimeUpdate,
	lowestSequence int,
	localTimeZone *time.Location,
	stopsForTrip []gtfs.Stop,
	vehicleLat, vehicleLon float64,
	vehicle *proto.VehiclePosition,
) (int, *time.Time, string) {
	if len(stopUpdates) == 0 {
		return 0, nil, "Unknown"
	}

	now := time.Now().In(localTimeZone)

	// Sort stopUpdates by sequence number for consistent processing
	sort.Slice(stopUpdates, func(i, j int) bool {
		if stopUpdates[i] == nil || stopUpdates[j] == nil {
			return false
		}
		return stopUpdates[i].GetStopSequence() < stopUpdates[j].GetStopSequence()
	})

	if idx, state, ok := stateFromCurrentStatus(vehicle, lowestSequence, stopsForTrip, vehicleLat, vehicleLon); ok {
		return idx, nil, state
	}

	// First pass: find the earliest stop whose arrival or departure is in the future.
	for _, update := range stopUpdates {
		if update == nil || update.GetStopTimeProperties().GetHistoric() {
			continue
		}

		var arrivalTs, departureTs int64
		if a := update.GetArrival(); a != nil {
			arrivalTs = a.GetTime()
		}
		if d := update.GetDeparture(); d != nil {
			departureTs = d.GetTime()
		}

		// Approaching if arrival is in the future
		if arrivalTs > 0 {
			at := time.Unix(arrivalTs, 0).In(localTimeZone)
			idx := int(update.GetStopSequence()) - lowestSequence
			if now.Before(at) {
				return idx, &at, "Arriving"
			} else if now.After(at) {
				// The predicted arrival time has passed - only report AtStop once
				// the vehicle's live position confirms it, otherwise it's still
				// approaching (a delayed vehicle can run behind its prediction).
				if IsNearStop(stopsForTrip, idx, vehicleLat, vehicleLon) {
					return idx + 1, &at, "AtStop"
				}
				return idx, &at, "Arriving"
			}
		}

		// AtStop if departure is in the future (even if arrival is past)
		if departureTs > 0 {
			dt := time.Unix(departureTs, 0).In(localTimeZone)
			if now.Before(dt) {
				seq := int(update.GetStopSequence()) + 1
				return seq - lowestSequence, &dt, "AtStop"
			} else if now.After(dt) {
				seq := int(update.GetStopSequence()) + 1
				return seq - lowestSequence, &dt, "Travelling"
			}
		}
	}

	// Second pass: no future events found. Find the most recent event in the past
	// (largest timestamp <= now). We'll consider that stop departed and return
	// next sequence = seq+1.
	var lastSeq int
	var lastTime time.Time
	found := false
	for _, update := range stopUpdates {
		if update == nil {
			continue
		}
		var arrivalTs, departureTs int64
		if a := update.GetArrival(); a != nil {
			arrivalTs = a.GetTime()
		}
		if d := update.GetDeparture(); d != nil {
			departureTs = d.GetTime()
		}

		// Prefer departure time when available
		var eventTs int64
		if departureTs > 0 {
			eventTs = departureTs
		} else {
			eventTs = arrivalTs
		}
		if eventTs == 0 {
			continue
		}
		t := time.Unix(eventTs, 0).In(localTimeZone)
		if !found || t.After(lastTime) {
			lastTime = t
			lastSeq = int(update.GetStopSequence())
			found = true
		}
	}

	if found {
		nextSeq := lastSeq + 1
		// Return the time of the last event and mark as still en route.
		return nextSeq - lowestSequence, &lastTime, "Travelling"
	}

	// No timestamps at all → unknown
	return 0, nil, "Unknown"
}
