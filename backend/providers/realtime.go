package providers

import (
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupRealtimeRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache func() map[string]stopsForTripId, getRouteCache func() map[string]gtfs.Route) {
	realtimeRoute := primaryRoute.Group("/realtime")
	realtimeRoute.Use(middleware.GzipWithConfig(gzipConfig))

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

		cachedRoutes := getRouteCache()
		cachedStopsForTrips := getStopsForTripCache()

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

			if routeData, err := getVehicleRouteData(currentRouteId, cachedRoutes); err == nil {
				responseData.Route = *routeData
				responseData.VehicleType = responseData.Route.VehicleType
				if vehicleTypeFilter != "" && !strings.EqualFold(routeData.VehicleType, strings.ToLower(vehicleTypeFilter)) {
					continue
				}
			}
			if filterTripId != "" {
				var tripData VehiclesTrip
				//If they are selecting a single vehicle, we can give stop info, otherwise its a waste of time because we don't even show it
				currentTrip, err := gtfsData.GetTripByID(currentTripId)
				if err != nil {
					//Missing trip in db
					continue
				}
				tripData.Headsign = currentTrip.TripHeadsign

				stopsForTripData, ok := cachedStopsForTrips[currentTripId]
				stopsForTrip := stopsForTripData.Stops
				if !ok || len(stopsForTrip) == 0 || stopsForTripData.LowestSequence == -1 {
					continue //Skip
				}

				sort.Slice(stopsForTrip, func(i, j int) bool {
					return stopsForTrip[i].Sequence < stopsForTrip[j].Sequence
				})

				tripUpdate, err := tripUpdates.ByTripID(currentTripId)
				if err == nil {
					stopUpdates := tripUpdate.GetStopTimeUpdate()

					nextStopSequenceNumber, _, state := getNextStopSequence(stopUpdates, stopsForTripData.LowestSequence, localTimeZone)

					tripData.FirstStop = getXStop(stopsForTrip, 0)
					tripData.CurrentStop = getXStop(stopsForTrip, min(nextStopSequenceNumber-1, len(stopsForTrip)-1))
					tripData.NextStop = getXStop(stopsForTrip, min(nextStopSequenceNumber, len(stopsForTrip)-1))
					tripData.FinalStop = getXStop(stopsForTrip, len(stopsForTrip)-1)
					responseData.State = state
				}
				responseData.Trip = &tripData
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

		//Get all the child stops of our parent stop, basically platforms, so we can then get all the routes that stop there
		childStops, err := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		if err != nil {
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

		var foundRoutes map[string]gtfs.Route = make(map[string]gtfs.Route)

		for _, child := range childStops {
			//Get all the routes that stop at our parent stop's platforms
			routes, err := gtfsData.GetRoutesByStopId(child.StopId)
			if err != nil {
				continue
			}
			for _, v := range routes {
				if _, found := foundRoutes[v.RouteId]; found {
					continue
				}
				foundRoutes[v.RouteId] = v
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

				activePeriods := alert.GetActivePeriod()
				if len(activePeriods) == 0 {
					//no start or end
					continue
				}
				smallestStart := activePeriods[0].GetStart()
				biggestEnd := activePeriods[0].GetEnd()

				for _, period := range activePeriods {
					if period.GetStart() < smallestStart {
						smallestStart = period.GetStart()
					}
					if period.GetEnd() > biggestEnd {
						biggestEnd = period.GetEnd()
					}
				}

				var parsedAlert = AlertResponse{
					StartDate:   int(smallestStart),
					EndDate:     int(biggestEnd),
					Cause:       alert.GetCause().String(),
					Effect:      alert.GetEffect().String(),
					Title:       alert.GetHeaderText().GetTranslation()[0].GetText(),
					Description: alert.GetDescriptionText().GetTranslation()[0].GetText(),
					Affected:    affected,
					Severity:    alert.GetSeverityLevel().String(),
				}

				foundAlerts = append(foundAlerts, parsedAlert)
			}
		}
		//Sort by start, smallest to biggest
		sort.Slice(foundAlerts, func(i, j int) bool {
			return foundAlerts[i].StartDate < foundAlerts[j].StartDate
		})

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

func getVehicleRouteData(currentRouteId string, routeCache map[string]gtfs.Route) (*VehiclesRoute, error) {
	var routeData VehiclesRoute
	currentRoute, ok := routeCache[currentRouteId]
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
	Trip         *VehiclesTrip    `json:"trip,omitempty"` // Omit trip if not set
	Occupancy    int8             `json:"occupancy"`
	LicensePlate string           `json:"license_plate"`
	Position     VehiclesPosition `json:"position"`
	VehicleType  string           `json:"type"` // bus, tram, metro
	State        string           `json:"state,omitempty"`
}

type VehiclesRoute struct {
	RouteId        string `json:"id"`
	RouteShortName string `json:"name"`
	RouteColor     string `json:"color"`
	VehicleType    string `json:"type"` // bus, tram, metro
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
	Severity    string   `json:"severity"`
}
