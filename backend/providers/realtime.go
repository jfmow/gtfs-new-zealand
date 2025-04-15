package providers

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupRealtimeRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {
	realtimeRoute := primaryRoute.Group("/realtime")
	realtimeRoute.Use(middleware.GzipWithConfig(gzipConfig))

	getRouteCache, err := gtfs.GenerateACache(gtfsData.GetRoutes, func(routes []gtfs.Route) (map[string]gtfs.Route, error) {
		newCache := make(map[string]gtfs.Route)
		for _, route := range routes {
			newCache[route.RouteId] = route
		}
		return newCache, nil
	}, 5*time.Minute, make(map[string]gtfs.Route, 0))
	if err != nil {
		log.Printf("Failed to init routes cache: %v", err)
	}

	type StopsForTripIdCache struct {
		Stops          []gtfs.Stop
		LowestSequence int
	}
	getStopsForTripCache, err := gtfs.GenerateACache(
		gtfsData.GetStopsForTrips,
		func(input map[string][]gtfs.Stop) (map[string]StopsForTripIdCache, error) {
			result := make(map[string]StopsForTripIdCache)
			for key, trip := range input {
				lowest := -1
				for _, stop := range trip {
					if stop.Sequence < lowest || lowest == -1 {
						lowest = stop.Sequence
					}
				}
				result[key] = StopsForTripIdCache{
					Stops:          trip,
					LowestSequence: lowest,
				}
			}
			return result, nil
		},
		5*time.Minute,
		make(map[string]StopsForTripIdCache, 0),
	)
	if err != nil {
		log.Printf("Failed to init trip stops cache: %v", err)
	}

	getChildStopsCache, err := gtfs.GenerateACache(func() ([]gtfs.Stop, error) {
		stops, err := gtfsData.GetStops(true)
		return stops, err
	}, func(stops []gtfs.Stop) (map[string][]gtfs.Stop, error) {
		var newMap map[string][]gtfs.Stop = make(map[string][]gtfs.Stop)
		for _, stop := range stops {
			if stop.ParentStation != "" || (stop.LocationType == 0 && stop.ParentStation == "") {
				newMap[stop.ParentStation] = append(newMap[stop.ParentStation], stop)
			}
		}
		if len(newMap) == 0 {
			return nil, errors.New("no child stops found")
		}
		return newMap, nil
	}, 5*time.Minute, make(map[string][]gtfs.Stop, 0))
	if err != nil {
		log.Printf("Failed to initialize child stop cache: %v", err)
	}

	getTripByIdCache, err := gtfs.GenerateACache(func() (map[string]gtfs.Trip, error) {
		trips, err := gtfsData.GetAllTrips()
		return trips, err
	}, gtfs.Identity[map[string]gtfs.Trip], 5*time.Minute, make(map[string]gtfs.Trip))
	if err != nil {
		log.Printf("Failed to initialize trips cache: %v", err)
	}
	//Returns all the locations of vehicles from the AT api
	realtimeRoute.POST("/live", func(c echo.Context) error {
		filterTripId := c.FormValue("tripId")
		vehicleTypeFilter := c.FormValue("vehicle_type")

		vehicles, err := realtime.GetVehicles()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no vehicles found",
				Data:    nil,
			})
		}

		tripUpdates, err := realtime.GetTripUpdates()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no trip updates found",
				Data:    nil,
			})
		}

		var response []VehiclesResponse

		cachedTrips := getTripByIdCache()

		for _, vehicle := range vehicles {
			currentTripId := vehicle.GetTrip().GetTripId()
			currentRouteId := vehicle.GetTrip().GetRouteId()
			if currentRouteId == "" || currentTripId == "" || (filterTripId != "" && currentTripId != filterTripId) {
				continue
			}
			var responseData VehiclesResponse = VehiclesResponse{
				TripId:       currentTripId,
				Position:     VehiclesPosition{Lat: vehicle.GetPosition().GetLatitude(), Lon: vehicle.GetPosition().GetLongitude()},
				Occupancy:    int8(vehicle.GetOccupancyStatus()),
				LicensePlate: vehicle.GetVehicle().GetLicensePlate(),
			}
			responseData.Trip.Headsign = cachedTrips[currentTripId].TripHeadsign

			if routeData, err := getVehicleRouteData(currentRouteId, getRouteCache); err == nil {
				responseData.Route = *routeData
				responseData.VehicleType = responseData.Route.VehicleType
				if vehicleTypeFilter != "" && !strings.EqualFold(routeData.VehicleType, strings.ToLower(vehicleTypeFilter)) {
					continue
				}
			}

			cachedStops := getStopsForTripCache()
			cachedStopsForTrip, ok := cachedStops[currentTripId]
			stopsForTripId := cachedStopsForTrip.Stops
			lowestSequence := cachedStopsForTrip.LowestSequence
			if !ok || len(cachedStopsForTrip.Stops) == 0 || lowestSequence == -1 {
				continue //Skip
			}

			tripUpdate, err := tripUpdates.ByTripID(currentTripId)
			if err == nil {
				stopUpdates := tripUpdate.GetStopTimeUpdate()

				nextStopSequenceNumber, _, state := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)

				responseData.Trip.FirstStop = getXStop(stopsForTripId, 0)
				responseData.Trip.CurrentStop = getXStop(stopsForTripId, min(nextStopSequenceNumber-1, len(stopsForTripId)-1))
				responseData.Trip.NextStop = getXStop(stopsForTripId, min(nextStopSequenceNumber, len(stopsForTripId)-1))
				responseData.Trip.FinalStop = getXStop(stopsForTripId, len(stopsForTripId)-1)
				responseData.State = state
			}

			response = append(response, responseData)
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    response,
		})
	})

	//Returns alerts from AT for a stop
	realtimeRoute.GET("/alerts/:stopName", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stopName")
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
				Message: "invalid stop name/code",
				Data:    nil,
			})
		}

		cachedChildStopsByParentId := getChildStopsCache()
		//Get all the child stops of our parent stop, basically platforms, so we can then get all the routes that stop there
		childStops, ok := cachedChildStopsByParentId[stop.StopId]
		if !ok {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no c stops found",
				Data:    nil,
			})
		}

		alerts, err := realtime.GetAlerts()
		if err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no alerts found",
				Data:    nil,
			})
		}

		var foundRoutes []gtfs.Route

		for _, child := range childStops {
			//Get all the routes that stop at our parent stop's platforms
			routes, err := gtfsData.GetRoutesByStopId(child.StopId)
			if err != nil {
				continue
			}
			for _, v := range routes {
				if containsRoute(foundRoutes, v.RouteId) {
					continue
				}
				foundRoutes = append(foundRoutes, v)
			}

		}

		if len(foundRoutes) == 0 {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no routes found for stop",
				Data:    nil,
			})
		}

		var foundAlerts []AlertResponse

		for _, route := range foundRoutes {
			alertsForRoute, err := alerts.FindAlertsByRouteId(route.RouteId)
			if err != nil {
				return c.String(404, "No alerts found for route")
			}
			for _, alert := range alertsForRoute {
				seenAffected := make(map[string]struct{})
				var affected []string

				for i := range alert.GetInformedEntity() {
					stopID := alert.GetInformedEntity()[i].GetStopId()
					routeId := alert.GetInformedEntity()[i].GetRouteId()
					if routeId != "" {
						// Check if we've already processed this parent stop
						if _, exists := seenAffected[routeId]; exists {
							continue
						}

						// Add to the set
						seenAffected[routeId] = struct{}{}

						// Update the stop ID to parent stop name
						affected = append(affected, routeId)
					} else if stopID != "" {
						stop, err := gtfsData.GetParentStopByChildStopID(stopID)
						if err != nil {
							continue
						}

						// Check if we've already processed this parent stop
						if _, exists := seenAffected[stop.StopId]; exists {
							continue
						}

						// Add to the set
						seenAffected[stop.StopId] = struct{}{}

						// Update the stop ID to parent stop name
						affected = append(affected, stop.StopName)
					}
				}
				var parsedAlert = AlertResponse{
					StartDate:   int(alert.GetActivePeriod()[0].GetStart()),
					EndDate:     int(alert.GetActivePeriod()[len(alert.GetActivePeriod())-1].GetEnd()),
					Cause:       alert.GetCause().String(),
					Effect:      alert.GetEffect().String(),
					Title:       alert.GetHeaderText().GetTranslation()[0].GetText(),
					Description: alert.GetDescriptionText().GetTranslation()[0].GetText(),
					Affected:    affected,
				}

				foundAlerts = append(foundAlerts, parsedAlert)
			}
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    foundAlerts,
		})

	})

}

func getNextStopSequence(stopUpdates []*proto.TripUpdate_StopTimeUpdate, lowestSequence int, localTimeZone *time.Location) (int, *time.Time, string) {
	if len(stopUpdates) == 0 {
		return 0, nil, "Unknown"
	}

	now := time.Now().In(localTimeZone)

	update := stopUpdates[0] //Latest one
	arrivalTimestamp := update.GetArrival().GetTime()
	departureTimestamp := update.GetDeparture().GetTime()
	sequence := int(update.GetStopSequence())
	//arrivalDelay := update.GetArrival().GetDelay()
	//arrivalTimestamp += int64(arrivalDelay)
	//departureDelay := update.GetDeparture().GetDelay()
	//departureTimestamp += int64(departureDelay)

	arrivalTimeLocal := time.Unix(arrivalTimestamp, 0).In(localTimeZone)
	departureTimeLocal := time.Unix(departureTimestamp, 0).In(localTimeZone)
	var nextStopSequenceNumber int = sequence

	var state = "Unknown"
	if arrivalTimestamp != 0 && departureTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching the stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival pending): " + arrivalTimeLocal.String()
		} else if now.Before(departureTimeLocal) {
			// At the stop, not yet departed
			nextStopSequenceNumber = sequence
			state = "At stop (awaiting departure): " + departureTimeLocal.String()
		} else {
			// Already departed → next stop is the next one
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop: " + departureTimeLocal.String()
		}
	} else if arrivalTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival only): " + arrivalTimeLocal.String()
		} else {
			// Already arrived → next stop must be next
			nextStopSequenceNumber = sequence + 1
			state = "Arrived at stop (arrival only): " + arrivalTimeLocal.String()
		}
	} else if departureTimestamp != 0 {
		if now.Before(departureTimeLocal) {
			// Still at stop → haven't left yet
			nextStopSequenceNumber = sequence
			state = "Waiting to depart (departure only): " + departureTimeLocal.String()
		} else {
			// Already departed
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop (departure only): " + departureTimeLocal.String()
		}
	}

	nextStopSequenceNumber = nextStopSequenceNumber - lowestSequence

	return nextStopSequenceNumber, &arrivalTimeLocal, state
}

func getXStop(stopsForTripId []gtfs.Stop, currentStop int) ServicesStop {
	stopData := stopsForTripId[max(currentStop, 0)]
	if stopData.ParentStation != "" {
		stopData.StopId = stopData.ParentStation
	}
	result := ServicesStop{Id: stopData.StopId, Name: stopData.StopName, Lat: stopData.StopLat, Lon: stopData.StopLon, Platform: stopData.PlatformNumber, Sequence: stopData.Sequence}
	return result
}

func getVehicleRouteData(currentRouteId string, getRouteCache func() map[string]gtfs.Route) (*VehiclesRoute, error) {
	currentCache := getRouteCache()
	var routeData VehiclesRoute
	currentRoute, ok := currentCache[currentRouteId]
	if !ok {
		return nil, errors.New("no route found")
	}
	routeData.VehicleType = currentRoute.VehicleType
	routeData.RouteColor = currentRoute.RouteColor
	routeData.RouteId = currentRoute.RouteId
	routeData.RouteShortName = currentRoute.RouteShortName
	return &routeData, nil
}

// Vehicles
type VehiclesResponse struct {
	TripId       string           `json:"trip_id"`
	Route        VehiclesRoute    `json:"route"`
	Trip         VehiclesTrip     `json:"trip"`
	Occupancy    int8             `json:"occupancy"`
	LicensePlate string           `json:"license_plate"`
	Position     VehiclesPosition `json:"position"`
	VehicleType  string           `json:"type"` //bus, tram, metro
	State        string           `json:"state"`
}

type VehiclesRoute struct {
	RouteId        string `json:"id"`
	RouteShortName string `json:"name"`
	RouteColor     string `json:"color"`
	VehicleType    string `json:"type"` //bus, tram, metro
}

type VehiclesTrip struct {
	FirstStop   ServicesStop `json:"first_stop"`
	NextStop    ServicesStop `json:"next_stop"`
	FinalStop   ServicesStop `json:"final_stop"`
	CurrentStop ServicesStop `json:"current_stop"`
	Headsign    string       `json:"headsign"`
}

type VehiclesPosition struct {
	Lat float32 `json:"lat"`
	Lon float32 `json:"lon"`
}

// Alerts response
type AlertResponse struct {
	StartDate   int      `json:"start_date"`
	EndDate     int      `json:"end_date"`
	Cause       string   `json:"cause"`
	Effect      string   `json:"effect"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Affected    []string `json:"affected"`
}
