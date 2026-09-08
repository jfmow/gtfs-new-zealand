package providers

import (
	"math"
	"time"

	"github.com/jfmow/at-trains-api/providers/vehiclestate"
	"github.com/jfmow/gtfs"
	realtime "github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

func pointInBounds(lat, lng float64, sw, ne LatLng) bool {
	// Allow sw/ne to be provided in any order: normalize bounds
	minLat := math.Min(sw.Lat, ne.Lat)
	maxLat := math.Max(sw.Lat, ne.Lat)
	minLng := math.Min(sw.Lng, ne.Lng)
	maxLng := math.Max(sw.Lng, ne.Lng)

	return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

type RealtimeTripData struct {
	TripID string

	LocationTracking   bool
	TripUpdateTracking bool

	ArrivalTime     string
	TimeTillArrival int
	StopsAway       int
	StopState       string

	TripStarted bool
	Departed    bool
	Canceled    bool
	Skipped     bool

	Platform        string
	PlatformChanged bool

	Occupancy          int
	WheelchairsAllowed int
}

func GetRealtimeTripData(
	service gtfs.StopTimes,
	tripUpdatesData realtime.TripUpdatesMap,
	vehicleLocations realtime.VehiclesMap,
	gtfsData gtfs.Database,
) RealtimeTripData {
	localTimeZone := gtfsData.LocalTimeZone()
	now := time.Now().In(localTimeZone)

	result := RealtimeTripData{
		TripID:             service.TripID,
		ArrivalTime:        service.ArrivalTime,
		Platform:           service.Platform,
		StopsAway:          service.StopSequence,
		WheelchairsAllowed: service.StopData.WheelChairBoarding,
		TripStarted:        true,
	}

	// GTFS scheduled times can be >= 24:00:00 for service that runs past
	// midnight (still "today" in GTFS terms) - time.Parse rejects an
	// out-of-range hour outright, which silently left TimeTillArrival at its
	// zero value (displayed as "now") for every such trip. parseGTFSClock
	// rolls the extra hours into the next calendar day instead.
	if defaultArrivalTime, ok := parseGTFSClock(service.ArrivalTime, now, localTimeZone); ok {
		result.TimeTillArrival = int(defaultArrivalTime.Sub(now).Minutes())
	}

	var vehicleLat, vehicleLon float64
	var liveVehicle *proto.VehiclePosition
	if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
		liveVehicle = foundVehicle
		result.LocationTracking = true
		result.Occupancy = int(foundVehicle.GetOccupancyStatus().Number())

		if pos := foundVehicle.GetPosition(); pos != nil {
			vehicleLat, vehicleLon = float64(pos.GetLatitude()), float64(pos.GetLongitude())
		}

		if foundVehicle.GetTrip().GetScheduleRelationship() == 3 {
			result.Canceled = true
		}

		if foundVehicle.GetVehicle().GetWheelchairAccessible().Number() == 2 {
			result.WheelchairsAllowed = 1
		} else if foundVehicle.GetVehicle().GetWheelchairAccessible().Number() == 3 {
			result.WheelchairsAllowed = 2
		}
	}

	if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
		result.TripUpdateTracking = true

		result.TripStarted = checkIfTripStarted(
			tripUpdate.GetTrip().GetStartTime(),
			tripUpdate.GetTrip().GetStartDate(),
			localTimeZone,
		)

		stopUpdates := tripUpdate.GetStopTimeUpdate()
		predictedArrivalTimes := getPredictedStopArrivalTimesForTrip(stopUpdates, localTimeZone)

		if predictedArrival, ok := predictedArrivalTimes[service.StopId]; ok {
			result.ArrivalTime = predictedArrival.ArrivalTime.Format("15:04:05")
			result.TimeTillArrival = int(predictedArrival.ArrivalTime.Sub(now).Minutes())
		}

		stopsForTrip, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
		if err == nil {
			nextStopSeq, _, simpleState := vehiclestate.GetNextStopSequence(stopUpdates, lowestSequence, localTimeZone, stopsForTrip, vehicleLat, vehicleLon, liveVehicle)
			result.StopsAway = service.StopData.Sequence - lowestSequence - nextStopSeq
			result.StopState = simpleState
		}

		if result.TripStarted {
			if result.StopsAway <= -1 {
				result.Departed = true
			}
		} else if result.StopsAway < 0 {
			// A trip that hasn't started yet can't have departed this stop. AT's
			// feed publishes trip updates ahead of time but omits a prediction
			// for a trip's *origin* stop, so GetNextStopSequence reports the
			// second stop as "next" and StopsAway lands at -1 for any service
			// that originates here (e.g. Western Line trips reversing at
			// Newmarket). Left alone, that flagged every future Swanson
			// departure as "Departed" at the top of the board.
			result.StopsAway = 0
		}

		if tripUpdate.GetTrip().GetScheduleRelationship() == 3 {
			result.Canceled = true
		}

		for _, update := range stopUpdates {
			if update.GetStopId() != service.StopId {
				if int(update.GetStopSequence()) == service.StopData.Sequence {
					stop, err := gtfsData.GetStopByStopID(update.GetStopId())
					if err != nil {
						continue
					}

					if stop.ParentStation != service.StopData.StopId {
						continue
					}

					if stop.PlatformNumber != service.Platform {
						result.Platform = stop.PlatformNumber
						result.PlatformChanged = true
					}
				}
				continue
			}

			if update.GetScheduleRelationship().Enum().String() == "SKIPPED" {
				result.Skipped = true
			}
		}
	} else if result.TimeTillArrival <= -2 {
		result.Departed = true
	}

	return result
}

func GetRealtimeTripDataForServices(
	services []gtfs.StopTimes,
	tripUpdatesData realtime.TripUpdatesMap,
	vehicleLocations realtime.VehiclesMap,
	gtfsData gtfs.Database,
) []RealtimeTripData {
	result := make([]RealtimeTripData, 0, len(services))

	for _, service := range services {
		result = append(result, GetRealtimeTripData(
			service,
			tripUpdatesData,
			vehicleLocations,
			gtfsData,
		))
	}

	return result
}

func (r RealtimeTripData) Apply(response *ServicesResponse2) {
	response.LocationTracking = r.LocationTracking
	response.TripUpdateTracking = r.TripUpdateTracking
	response.ArrivalTime = r.ArrivalTime
	response.TimeTillArrival = r.TimeTillArrival
	response.StopsAway = r.StopsAway
	response.StopState = r.StopState
	response.TripStarted = r.TripStarted
	response.Departed = r.Departed
	response.Canceled = r.Canceled
	response.Skipped = r.Skipped
	response.Platform = r.Platform
	response.PlatformChanged = r.PlatformChanged
	response.Occupancy = r.Occupancy
	response.WheelchairsAllowed = r.WheelchairsAllowed
}
