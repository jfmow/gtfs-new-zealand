package providers

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

func setupServicesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache caches.StopsForTripCache) {
	servicesRoute := primaryRoute.Group("/services")

	osrmApiUrl, found := os.LookupEnv("OSRM_URL")
	if !found {
		panic("OSRM_URL env not found")
	}

	servicesRoute.GET("/:stationName", func(c echo.Context) error {
		limitStr := c.QueryParam("limit")
		limit := 20

		if limitStr != "" {
			l, err := strconv.Atoi(limitStr)
			if err != nil || l <= 0 || l > 200 {
				return JsonApiResponse(
					c,
					http.StatusBadRequest,
					"invalid limit",
					nil,
					ResponseDetails(
						"limit", limitStr,
						"details", "Limit must be a valid integer between 1 and 200",
						"error", fmt.Sprintf("%v", err),
					),
				)
			}
			limit = l
		}

		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop", nil, ResponseDetails("stopName", stopNameEncoded, "details", "Invalid stop name format", "error", err.Error()))
		}

		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			fmt.Println(err)
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop id", nil, ResponseDetails("stopName", stopName, "details", "Stop not found", "error", err.Error()))
		}

		nowMinusTenMinutes := time.Now().In(localTimeZone).Add(-10 * time.Minute)
		currentTimeMinusTenMinutes := nowMinusTenMinutes.Format("15:04:05")

		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, currentTimeMinusTenMinutes, nowMinusTenMinutes, limit)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no services found for stop", nil, ResponseDetails("stopName", stopName, "details", "No services found for the given stop"))
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
				Stop:               &ServicesStop{ParentStopId: service.StopId, Lat: service.StopData.StopLat, Lon: service.StopData.StopLon, Name: stop.StopName + " " + stop.StopCode, Platform: service.Platform, Sequence: service.StopSequence},
				LocationTracking:   false,
				TripUpdateTracking: false,
				TripId:             service.TripID,
				WheelchairsAllowed: service.StopData.WheelChairBoarding,
				BikesAllowed:       service.TripData.BikesAllowed,
				TripStarted:        true,
			}

			defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
			if err != nil {
				continue
			}
			defaultArrivalTime = time.Date(now.Year(), now.Month(), now.Day(), defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(), 0, localTimeZone)

			response.TimeTillArrival = int(defaultArrivalTime.Sub(now).Minutes())

			if service.RouteColor != "" {
				response.Route.RouteColor = service.RouteColor
			} else {
				response.Route.RouteColor = "000000"
			}

			if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
				response.Occupancy = int8(foundVehicle.GetOccupancyStatus())
				response.LocationTracking = true
				if foundVehicle.GetTrip().GetScheduleRelationship() == 3 {
					response.Canceled = true
				}

				if foundVehicle.GetVehicle().GetWheelchairAccessible().Number() == 2 {
					response.WheelchairsAllowed = 1
				}
				if foundVehicle.GetVehicle().GetWheelchairAccessible().Number() == 3 {
					response.WheelchairsAllowed = 2
				}
			}

			if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
				response.TripUpdateTracking = true

				startTime := tripUpdate.GetTrip().GetStartTime() // "HH:MM:SS"
				startDate := tripUpdate.GetTrip().GetStartDate() // "YYYYMMDD"
				response.TripStarted = checkIfTripStarted(startTime, startDate, localTimeZone)

				arrivalTimePlusDelay := defaultArrivalTime.Add(time.Duration(tripUpdate.GetDelay()) * time.Second)

				formattedArrivalTime := arrivalTimePlusDelay.Format("15:04:05")
				response.ArrivalTime = formattedArrivalTime

				timeTillArrival := int(math.Round(arrivalTimePlusDelay.Sub(now).Minutes()))
				response.TimeTillArrival = timeTillArrival

				stopUpdates := tripUpdate.GetStopTimeUpdate()
				_, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
				if err == nil {
					nextStopSeq, _, simpleState := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)
					response.StopsAway = int16(service.StopData.Sequence) - int16(lowestSequence) - int16(nextStopSeq)
					response.StopState = simpleState
				}

				if response.StopsAway <= -1 {
					response.Departed = true
				}

				if tripUpdate.GetTrip().GetScheduleRelationship() == 3 {
					cancelled := true
					response.Canceled = cancelled
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
							} else if stop.PlatformNumber != service.Platform {
								response.Platform = stop.PlatformNumber
								response.PlatformChanged = true
							}
						}
						continue
					}
					if update.GetScheduleRelationship().Enum().String() == "SKIPPED" {
						response.Skipped = true
					}
				}

			} else {
				if response.TimeTillArrival <= -2 {
					response.Departed = true
				}
			}

			resultData = append(resultData, response)
		}

		return JsonApiResponse(c, http.StatusOK, "", resultData)
	})

	servicesRoute.GET("/:stationName/schedule", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop", nil, ResponseDetails("stopName", stopNameEncoded, "details", "Invalid stop name format", "error", err.Error()))
		}

		// Fetch stop data
		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return JsonApiResponse(c, http.StatusNotFound, "no stop found with name", nil, ResponseDetails("stopName", stopName, "details", "Stop not found", "error", err.Error()))
		}

		date := c.QueryParam("date")

		dateInt, err := strconv.ParseInt(date, 10, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid date", nil, ResponseDetails("date", date, "details", "Invalid date format", "error", err.Error()))
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
			return JsonApiResponse(c, http.StatusNotFound, "no services found", nil, ResponseDetails("stopName", stopName, "details", "No services found for the given stop"))
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
				ParentStopId: service.StopId,
				Lat:          service.StopData.StopLat,
				Lon:          service.StopData.StopLon,
				Name:         stop.StopName,
			}
			response.LocationTracking = false
			response.TripId = service.TripID

			result = append(result, response)
		}

		return JsonApiResponse(c, http.StatusOK, "", result)
	})

	servicesRoute.GET("/plan", func(c echo.Context) error {
		// assuming you already have gtfsData (gtfs.Database)
		startLatStr := c.QueryParam("startLat")
		startLonStr := c.QueryParam("startLon")

		startLat, err := strconv.ParseFloat(startLatStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid latitude", nil, ResponseDetails("lat", startLat, "error", err.Error()))
		}
		startLon, err := strconv.ParseFloat(startLonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid longitude", nil, ResponseDetails("lon", startLon, "error", err.Error()))
		}

		endLatStr := c.QueryParam("endLat")
		endLonStr := c.QueryParam("endLon")

		endLat, err := strconv.ParseFloat(endLatStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid latitude", nil, ResponseDetails("lat", endLatStr, "error", err.Error()))
		}
		endLon, err := strconv.ParseFloat(endLonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid longitude", nil, ResponseDetails("lon", endLonStr, "error", err.Error()))
		}

		date := c.QueryParam("date")
		leaveTime := time.Now()

		if date != "" {
			t, err := time.Parse(time.RFC3339, date)
			if err != nil {
				return JsonApiResponse(
					c,
					http.StatusBadRequest,
					"invalid date",
					nil,
					ResponseDetails("date", date, "details", "Invalid date format", "error", err.Error()),
				)
			}

			// Convert to local timezone if needed
			leaveTime = t.In(localTimeZone)
		}

		maxWalkKm, err := queryFloat(c, "maxWalkKm", 1.0)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid maxWalkKm", nil,
				ResponseDetails("maxWalkKm", c.QueryParam("maxWalkKm"), "error", err.Error()))
		}

		walkSpeed, err := queryFloat(c, "walkSpeed", 4.8)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid walkSpeedKmph", nil,
				ResponseDetails("walkSpeedKmph", c.QueryParam("walkSpeedKmph"), "error", err.Error()))
		}

		maxTransfers, err := queryInt(c, "maxTransfers", 2)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid maxTransfers", nil,
				ResponseDetails("maxTransfers", c.QueryParam("maxTransfers"), "error", err.Error()))
		}

		timeType := queryString(c, "timeType", "now")
		jplan := gtfs.JourneyRequest{
			StartLat:        startLat,
			StartLon:        startLon,
			EndLat:          endLat,
			EndLon:          endLon,
			MaxWalkKm:       maxWalkKm,
			WalkSpeedKmph:   walkSpeed,
			MaxTransfers:    maxTransfers,
			MaxNearbyStops:  50,
			MaxResults:      5,
			MinResults:      3,
			OsrmURL:         osrmApiUrl,
			IncludeChildren: true,
		}

		switch timeType {
		case "arriveat":
			jplan.ArriveAt = leaveTime
		case "now", "departat", "":
			fallthrough
		default:
			jplan.DepartAt = leaveTime
		}

		plans, err := gtfsData.PlanJourneyRaptor(jplan)
		if err != nil {
			log.Fatalf("planning failed: %v", err)
		}

		return JsonApiResponse(c, http.StatusOK, "", plans)
	})
}

func queryFloat(c echo.Context, key string, def float64) (float64, error) {
	v := c.QueryParam(key)
	if v == "" {
		return def, nil
	}
	return strconv.ParseFloat(v, 64)
}

func queryInt(c echo.Context, key string, def int) (int, error) {
	v := c.QueryParam(key)
	if v == "" {
		return def, nil
	}
	i, err := strconv.Atoi(v)
	return i, err
}

func queryString(
	c echo.Context,
	key string,
	def string,
) string {
	v := c.QueryParam(key)
	if v == "" {
		return def
	}
	return v
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
	Skipped            bool   `json:"skipped"`
	BikesAllowed       int    `json:"bikes_allowed"`
	WheelchairsAllowed int    `json:"wheelchairs_allowed"` //0 = unknown 1 = yes 2= no

	Route *ServicesRoute `json:"route"`

	Stop *ServicesStop `json:"stop"`

	LocationTracking   bool   `json:"location_tracking"`
	TripUpdateTracking bool   `json:"trip_update_tracking"`
	Departed           bool   `json:"departed"`
	TimeTillArrival    int    `json:"time_till_arrival"`
	StopState          string `json:"stop_state"`
	TripStarted        bool   `json:"trip_started"`

	PlatformChanged bool `json:"platform_changed"`
}

type ServicesRoute struct {
	RouteId        string `json:"id"`
	RouteShortName string `json:"name"`
	RouteColor     string `json:"color"`
}

type ServicesStop struct {
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
	ParentStopId string  `json:"parent_stop_id"`
	Name         string  `json:"name"`
	Platform     string  `json:"platform"`
	Sequence     int     `json:"sequence"`
	ChildStopId  string  `json:"child_stop_id"`
}
