package providers

import (
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

// TODO: rewrite the services sse
func setupServicesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache caches.StopsForTripCache, getParentStopCache caches.ParentStopsCache) {
	servicesRoute := primaryRoute.Group("/services")

	//TODO: change back to static no sse
	servicesRoute.GET("/:stationName", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop",
				Data:    nil,
			})
		}

		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		nowMinusTenMinutes := time.Now().In(localTimeZone).Add(-10 * time.Minute)
		currentTimeMinusTenMinutes := nowMinusTenMinutes.Format("15:04:05")

		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, currentTimeMinusTenMinutes, nowMinusTenMinutes, 200)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no services found for stop",
				Data:    nil,
			})
		}
		var filteredServices []gtfs.StopTimes
		stopsForTripCache := getStopsForTripCache()
		for _, service := range services {
			stopsForService, found := stopsForTripCache[service.TripID]
			if !found {
				continue
			}
			//Works sometimes
			if service.TripData.TripHeadsign == "" && len(stopsForService.Stops) > 0 {
				service.TripData.TripHeadsign = stopsForService.Stops[0].StopHeadsign
			}
			//The stop sequence in gtfs data sometimes goes to 0 for first or 1 for first, so make them == 0 for first because our array of stops will always start at 0 as the first, so selecting 1 for first would actually be the 2nd stop
			if stopsForService.LowestSequence == 1 {
				service.StopSequence -= 1
			}
			//Check it is not the last stop for the service because displaying that as a departure is pointless
			if service.StopSequence != len(stopsForService.Stops)-1 {
				filteredServices = append(filteredServices, service)
			}

		}

		var resultData []ServicesResponse2 = []ServicesResponse2{}

		tripUpdatesData, _ := realtime.GetTripUpdates()
		vehicleLocations, _ := realtime.GetVehicles()
		now := time.Now().In(localTimeZone)

		for _, service := range filteredServices {
			var response ServicesResponse2 = ServicesResponse2{
				StopsAway:          int16(service.StopSequence),
				ArrivalTime:        service.ArrivalTime,
				Headsign:           service.StopHeadsign,
				Platform:           service.Platform,
				Route:              &ServicesRoute{RouteId: service.TripData.RouteID, RouteShortName: service.RouteShortName},
				Stop:               &ServicesStop{Id: service.StopId, Lat: service.StopData.StopLat, Lon: service.StopData.StopLon, Name: stop.StopName + " " + stop.StopCode},
				Tracking:           false,
				TripId:             service.TripID,
				WheelchairsAllowed: service.StopData.WheelChairBoarding,
				BikesAllowed:       service.TripData.BikesAllowed,
			}

			if service.RouteColor != "" {
				response.Route.RouteColor = service.RouteColor
			} else {
				response.Route.RouteColor = "000000"
			}

			if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
				response.Occupancy = int8(foundVehicle.GetOccupancyStatus())
				response.Tracking = true
				if foundVehicle.GetTrip().GetScheduleRelationship() == 3 {
					response.Canceled = true
				}
			}

			if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
				defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
				if err == nil {
					defaultArrivalTime = time.Date(now.Year(), now.Month(), now.Day(), defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(), 0, localTimeZone)
					arrivalTimePlusDelay := defaultArrivalTime.Add(time.Duration(tripUpdate.GetDelay()) * time.Second)

					formattedArrivalTime := arrivalTimePlusDelay.Format("15:04:05")
					response.ArrivalTime = formattedArrivalTime

					timeTillArrival := int(math.Round(arrivalTimePlusDelay.Sub(now).Minutes()))
					response.TimeTillArrival = timeTillArrival

					stopUpdates := tripUpdate.GetStopTimeUpdate()
					_, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
					if err == nil {
						nextStopSeq, _, _ := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)
						response.StopsAway = int16(service.StopData.Sequence) - int16(lowestSequence) - int16(nextStopSeq)
					}

					if timeTillArrival <= -1 || response.StopsAway <= -1 {
						response.Departed = true
					}

					if tripUpdate.GetTrip().GetScheduleRelationship() == 3 {
						cancelled := true
						response.Canceled = cancelled
					}
				}
			}

			resultData = append(resultData, response)

		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "ok",
			Data:    resultData,
		})
	})

	servicesRoute.GET("/:stationName/schedule", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop",
				Data:    nil,
			})
		}

		// Fetch stop data
		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.String(http.StatusNotFound, "No stop found with name")
		}

		date := c.QueryParam("date")

		dateInt, err := strconv.ParseInt(date, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid date",
				Data:    nil,
			})
		}
		now := time.Unix(dateInt, 0).In(localTimeZone)

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, "", now, 1000)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no services found",
				Data:    nil,
			})
		}

		// Sort services by arrival time
		sort.Slice(services, func(i, j int) bool {
			return services[i].ArrivalTime < services[j].ArrivalTime
		})

		var result []ServicesResponse2

		for _, service := range services {
			var response ServicesResponse2
			response.ArrivalTime = service.ArrivalTime
			if service.StopHeadsign != "" {
				response.Headsign = service.StopHeadsign
			} else {
				response.Headsign = service.TripData.TripHeadsign
			}
			response.Platform = service.Platform
			response.Route = &ServicesRoute{
				RouteId:        service.TripData.RouteID,
				RouteShortName: service.RouteShortName,
				RouteColor:     service.RouteColor,
			}
			response.Stop = &ServicesStop{
				Id:   service.StopId,
				Lat:  service.StopData.StopLat,
				Lon:  service.StopData.StopLon,
				Name: stop.StopName,
			}
			response.Tracking = false
			response.TripId = service.TripID

			result = append(result, response)
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    result,
		})
	})
}

// Services
type ServicesResponse2 struct {
	TripId             string `json:"trip_id"`
	Headsign           string `json:"headsign"`
	ArrivalTime        string `json:"arrival_time"`
	Platform           string `json:"platform"`
	StopsAway          int16  `json:"stops_away"`
	Occupancy          int8   `json:"occupancy"`
	Canceled           bool   `json:"canceled"`
	BikesAllowed       int    `json:"bikes_allowed"`
	WheelchairsAllowed int    `json:"wheelchairs_allowed"`

	Route *ServicesRoute `json:"route"`

	Stop *ServicesStop `json:"stop"`

	Tracking        bool `json:"tracking"`
	Departed        bool `json:"departed"`
	TimeTillArrival int  `json:"time_till_arrival"`
}

type ServicesRoute struct {
	RouteId        string `json:"id"`
	RouteShortName string `json:"name"`
	RouteColor     string `json:"color"`
}

type ServicesStop struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	Platform string  `json:"platform"`
	Sequence int     `json:"sequence"`
}
