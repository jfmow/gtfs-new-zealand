package providers

import (
	"math"
	"time"

	"github.com/jfmow/gtfs"
	realtime "github.com/jfmow/gtfs/realtime"
)

func pointInBounds(lat, lng float64, sw, ne LatLng) bool {
	// Allow sw/ne to be provided in any order: normalize bounds
	minLat := math.Min(sw.Lat, ne.Lat)
	maxLat := math.Max(sw.Lat, ne.Lat)
	minLng := math.Min(sw.Lng, ne.Lng)
	maxLng := math.Max(sw.Lng, ne.Lng)

	return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

// haversine returns the distance in meters between two lat/lon points
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
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

	defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
	if err == nil {
		defaultArrivalTime = time.Date(
			now.Year(),
			now.Month(),
			now.Day(),
			defaultArrivalTime.Hour(),
			defaultArrivalTime.Minute(),
			defaultArrivalTime.Second(),
			0,
			localTimeZone,
		)
		result.TimeTillArrival = int(defaultArrivalTime.Sub(now).Minutes())
	}

	if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
		result.LocationTracking = true
		result.Occupancy = int(foundVehicle.GetOccupancyStatus().Number())

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

		_, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
		if err == nil {
			nextStopSeq, _, simpleState := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)
			result.StopsAway = service.StopData.Sequence - lowestSequence - nextStopSeq
			result.StopState = simpleState
		}

		if result.StopsAway <= -1 {
			result.Departed = true
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
