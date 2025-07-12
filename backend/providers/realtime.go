package providers

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	"github.com/labstack/echo/v5"
)

type LatLng struct {
	Lat float64
	Lng float64
}

func setupRealtimeRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache caches.StopsForTripCache, getRouteCache caches.RouteCache, getParentStopByChildCache caches.ParentStopsByChildCache) {
	realtimeRoute := primaryRoute.Group("/realtime")

	//Returns all the locations of vehicles from the AT api
	realtimeRoute.POST("/live", func(c echo.Context) error {
		filterTripId := c.FormValue("tripId")
		vehicleTypeFilter := c.FormValue("vehicle_type")
		boundsStr := c.FormValue("bounds")

		var rawBounds [][]float64
		var hasBounds = true

		if boundsStr == "" {
			// Default to [[0,0],[0,0]]
			hasBounds = false
			rawBounds = [][]float64{
				{0.0, 0.0},
				{0.0, 0.0},
			}
		} else {
			// Try to unmarshal JSON input
			if err := json.Unmarshal([]byte(boundsStr), &rawBounds); err != nil {
				return JsonApiResponse(c, http.StatusBadRequest, "Invalid bounds format", nil, ResponseDetails("bounds", boundsStr, "details", "Bounds must be a valid JSON array in the format [[lat1,lng1],[lat2,lng2]]", "error", err.Error()))
			}

			// Basic validation
			if len(rawBounds) != 2 || len(rawBounds[0]) != 2 || len(rawBounds[1]) != 2 {
				return JsonApiResponse(c, http.StatusBadRequest, "Bounds must be in the format [[lat1,lng1],[lat2,lng2]]", nil, ResponseDetails("bounds", boundsStr, "details", "Bounds must be a valid JSON array in the format [[lat1,lng1],[lat2,lng2]]"))
			}
		}

		point1 := LatLng{Lat: rawBounds[0][0], Lng: rawBounds[0][1]}
		point2 := LatLng{Lat: rawBounds[1][0], Lng: rawBounds[1][1]}

		vehicles, err := realtime.GetVehicles()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "No vehicles found in the GTFS data", "error", err.Error()))
		}

		tripUpdates, err := realtime.GetTripUpdates()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "No trip updates found in the GTFS data", "error", err.Error()))
		}

		var response []VehiclesResponse = []VehiclesResponse{}

		cachedRoutes := getRouteCache()
		cachedStopsForTrips := getStopsForTripCache()

		for _, vehicle := range vehicles {
			if hasBounds && !pointInBounds(float64(vehicle.GetPosition().GetLatitude()), float64(vehicle.GetPosition().GetLongitude()), point1, point2) {
				//skip
				continue
			}
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
				if vehicleTypeFilter != "" && vehicleTypeFilter != "all" && !strings.EqualFold(routeData.VehicleType, strings.ToLower(vehicleTypeFilter)) {
					continue
				}
			}

			tripUpdate, err := tripUpdates.ByTripID(currentTripId)
			if err != nil {
				continue //skip because it's probably not in service
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

				stopUpdates := tripUpdate.GetStopTimeUpdate()

				nextStopSequenceNumber, _, _, simpleState := getNextStopSequence(stopUpdates, stopsForTripData.LowestSequence, localTimeZone)

				tripData.FirstStop = getXStop(stopsForTrip, 0, getParentStopByChildCache)
				tripData.CurrentStop = getXStop(stopsForTrip, min(nextStopSequenceNumber-1, len(stopsForTrip)-1), getParentStopByChildCache)
				tripData.NextStop = getXStop(stopsForTrip, min(nextStopSequenceNumber, len(stopsForTrip)-1), getParentStopByChildCache)
				tripData.FinalStop = getXStop(stopsForTrip, len(stopsForTrip)-1, getParentStopByChildCache)
				responseData.State = simpleState

				if filterTripId != "" {
					line, err := NewTripShapeDistance(currentTripId, gtfsData)
					if err == nil {
						distanceFromLine, err := line.DistanceFromLine(
							float64(vehicle.GetPosition().GetLatitude()),
							float64(vehicle.GetPosition().GetLongitude()),
						)
						if err == nil && distanceFromLine > 500.0 {
							responseData.OffCourse = true
						}
					}
				}

				responseData.Trip = &tripData
			}

			response = append(response, responseData)
		}

		return JsonApiResponse(c, http.StatusOK, "", response)
	})

	//Returns alerts from AT for a stop
	realtimeRoute.GET("/alerts/:stopName", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stopName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop name", nil, ResponseDetails("stopName", stopNameEncoded, "details", "Invalid stop name format", "error", err.Error()))
		}

		var filterByToday = false
		if today := c.QueryParam("today"); today == "true" {
			filterByToday = true
		}

		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop name/code", nil, ResponseDetails("stopName", stopName, "details", "Stop not found", "error", err.Error()))
		}

		//Get all the child stops of our parent stop, basically platforms, so we can then get all the routes that stop there
		childStops, err := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "", nil, ResponseDetails("stopName", stopName, "details", "No child stops found for the given stop", "error", err.Error()))
		}

		alerts, err := realtime.GetAlerts()
		if err != nil {
			return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("stopName", stopName, "details", "No alerts found for the given stop", "error", err.Error()))
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
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "no routes found for stop: "+stopName))
		}

		var foundAlerts []AlertResponse

		for _, route := range foundRoutes {
			alertsForRoute, err := alerts.FindAlertsByRouteId(route.RouteId)
			if err != nil {
				continue // No alerts for this route
			}
			for _, alert := range alertsForRoute {
				if filterByToday {
					var isToday = false
					for _, period := range alert.GetActivePeriod() {
						startTime := time.Unix(int64(period.GetStart()), 0)
						nowDay := time.Now().In(localTimeZone).YearDay()
						alertDay := startTime.In(localTimeZone).YearDay()
						if nowDay == alertDay {
							isToday = true
						}
					}
					if !isToday {
						continue
					}
				}
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

		if len(foundAlerts) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no alerts found", nil, ResponseDetails("stopName", stopName, "details", "No alerts found for the given stop"))
		}
		//Sort by start, smallest to biggest
		sort.Slice(foundAlerts, func(i, j int) bool {
			return foundAlerts[i].StartDate < foundAlerts[j].StartDate
		})

		return JsonApiResponse(c, http.StatusOK, "", foundAlerts)
	})

	realtimeRoute.GET("/stop-times", func(c echo.Context) error {
		filterTripId := c.QueryParam("tripId")
		if filterTripId == "" {
			return JsonApiResponse(c, http.StatusBadRequest, "Missing trip id", ResponseDetails("details", "no trip id provided"))
		}

		stopsForTrip, err := gtfsData.GetStopTimesForTripID(filterTripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", ResponseDetails("details", "no stops found for trip", "error", err.Error()))
		}

		tripUpdates, err := realtime.GetTripUpdates()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "No trip updates found in the GTFS data", "error", err.Error()))
		}
		updatesForTrip, err := tripUpdates.ByTripID(filterTripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid trip id", nil, ResponseDetails("details", "No trip update found for the trip id", "error", err.Error()))
		}

		vehicles, err := realtime.GetVehicles()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "No vehicles found in the GTFS data", "error", err.Error()))
		}

		var vLat float32 = 0
		var vLon float32 = 0

		vehicleForTrip, err := vehicles.ByTripID(filterTripId)
		if err == nil {
			vLat = vehicleForTrip.GetPosition().GetLatitude()
			vLon = vehicleForTrip.GetPosition().GetLongitude()
		} else {
			for _, stop := range stopsForTrip {
				vLat = float32(stop.StopLat)
				vLon = float32(stop.StopLon)
				break // Only take the first stop
			}
		}

		stopTimesForStops := getPredictedStopArrivalTimesForTrip(updatesForTrip.GetStopTimeUpdate(), localTimeZone)
		//get stops for trip id
		type StopTimes struct {
			StopId        string  `json:"stop_id"` //child stop id
			ArrivalTime   int64   `json:"arrival_time"`
			DepartureTime int64   `json:"departure_time"`
			ScheduledTime int64   `json:"scheduled_time"`
			Skipped       bool    `json:"skipped"`
			Passed        bool    `json:"passed"`
			DistanceAway  float64 `json:"dist"`
		}
		var result []StopTimes

		now := time.Now().In(localTimeZone)

		_, lowestSequence, err := gtfsData.GetStopsForTripID(filterTripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", err.Error()))
		}

		nextStopSequenceNumber, _, _, _ := getNextStopSequence(updatesForTrip.StopTimeUpdate, lowestSequence, localTimeZone)

		line, err := NewTripShapeDistance(filterTripId, gtfsData)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", err.Error()))
		}

		for _, stop := range stopsForTrip {
			var data StopTimes

			if stop.ParentStation != "" {
				data.StopId = stop.ParentStation
			} else {
				data.StopId = stop.StopId
			}

			if nextStopSequenceNumber > (stop.Sequence - lowestSequence) {
				data.Passed = true
			}

			defaultArrivalTime, err := time.ParseInLocation("15:04:05", stop.ArrivalTime, localTimeZone)
			if err != nil {
				continue
			}
			defaultArrivalTime = time.Date(now.Year(), now.Month(), now.Day(), defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(), 0, localTimeZone)
			data.ScheduledTime = defaultArrivalTime.UnixMilli()

			update, found := stopTimesForStops[stop.StopId]
			if found {
				data.Skipped = update.Skipped
			}

			if !data.Passed {
				data.ArrivalTime = data.ScheduledTime + int64(updatesForTrip.GetDelay())*1000
				data.DepartureTime = data.ScheduledTime + int64(updatesForTrip.GetDelay())*1000
			} else {
				data.ArrivalTime = data.ScheduledTime
				data.DepartureTime = data.ScheduledTime
			}

			dist, err := line.Dist(float64(vLat), float64(vLon), stop.StopLat, stop.StopLon)
			if err == nil {
				data.DistanceAway = dist.DistanceToStop
			}

			result = append(result, data)
		}

		return JsonApiResponse(c, http.StatusOK, "", result)
	})

	realtimeRoute.GET("/find-my-vehicle/:lat/:lon", func(c echo.Context) error {
		latStr := c.PathParam("lat")
		lonStr := c.PathParam("lon")

		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid latitude", nil, ResponseDetails("lat", latStr, "error", err.Error()))
		}
		lon, err := strconv.ParseFloat(lonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "Invalid longitude", nil, ResponseDetails("lon", lonStr, "error", err.Error()))
		}

		vehicles, err := realtime.GetVehicles()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", err.Error()))
		}

		type vehicleDistance struct {
			Vehicle  *proto.VehiclePosition
			Distance float64
		}

		var distances []vehicleDistance

		for _, vehicle := range vehicles {
			pos := vehicle.GetPosition()
			dist := haversine(lat, lon, float64(pos.GetLatitude()), float64(pos.GetLongitude()))
			distances = append(distances, vehicleDistance{
				Vehicle:  vehicle,
				Distance: dist,
			})
		}

		// Sort by distance (always get closest vehicles first)
		sort.Slice(distances, func(i, j int) bool {
			return distances[i].Distance < distances[j].Distance
		})

		// Build result list of up to 3 closest
		var results []map[string]interface{}
		count := 0

		for _, vd := range distances {
			if vd.Distance <= 50 || count == 0 {
				tripData, err := gtfsData.GetTripByID(vd.Vehicle.GetTrip().GetTripId())
				if err != nil {
					continue
				}

				results = append(results, map[string]interface{}{
					"tripHeadsign":          tripData.TripHeadsign,
					"routeId":               tripData.RouteID,
					"distance_from_vehicle": vd.Distance,
					"tripId":                vd.Vehicle.GetTrip().GetTripId(),
				})

				count++
				if count >= 3 {
					break
				}
			}
		}

		// Ensure at least one result (fallback to closest if none matched 50m rule)
		if len(results) == 0 && len(distances) > 0 {
			vd := distances[0]
			tripData, err := gtfsData.GetTripByID(vd.Vehicle.GetTrip().GetTripId())
			if err == nil {
				results = append(results, map[string]interface{}{
					"tripHeadsign":          tripData.TripHeadsign,
					"routeId":               tripData.RouteID,
					"distance_from_vehicle": vd.Distance,
					"tripId":                vd.Vehicle.GetTrip().GetTripId(),
				})
			}
		}

		// Always return an array
		return JsonApiResponse(c, http.StatusOK, "Closest vehicles", results)
	})

}

func pointInBounds(lat, lng float64, sw, ne LatLng) bool {
	return lat >= sw.Lat && lat <= ne.Lat && lng >= sw.Lng && lng <= ne.Lng
}

func getNextStopSequence(stopUpdates []*proto.TripUpdate_StopTimeUpdate, lowestSequence int, localTimeZone *time.Location) (int, *time.Time, string, string) {
	if len(stopUpdates) == 0 {
		return 0, nil, "Unknown", ""
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
	var simpleState = "Unknown"
	if arrivalTimestamp != 0 && departureTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching the stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival pending): " + arrivalTimeLocal.String()
			simpleState = "Arriving"
		} else if now.Before(departureTimeLocal) {
			// At the stop, not yet departed
			nextStopSequenceNumber = sequence
			state = "At stop (awaiting departure): " + departureTimeLocal.String()
			simpleState = "Arrived"
		} else {
			// Already departed → next stop is the next one
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop: " + departureTimeLocal.String()
			simpleState = "Departed"
		}
	} else if arrivalTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival only): " + arrivalTimeLocal.String()
			simpleState = "Arriving"
		} else {
			// Already arrived → next stop must be next
			nextStopSequenceNumber = sequence + 1
			state = "Arrived at stop (arrival only): " + arrivalTimeLocal.String()
			simpleState = "Arrived"
		}
	} else if departureTimestamp != 0 {
		if now.Before(departureTimeLocal) {
			// Still at stop → haven't left yet
			nextStopSequenceNumber = sequence
			state = "Waiting to depart (departure only): " + departureTimeLocal.String()
			simpleState = "Boarding"
		} else {
			// Already departed
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop (departure only): " + departureTimeLocal.String()
			simpleState = "Departed"
		}
	}

	nextStopSequenceNumber = nextStopSequenceNumber - lowestSequence

	return nextStopSequenceNumber, &arrivalTimeLocal, state, simpleState
}

func getXStop(stopsForTripId []gtfs.Stop, currentStop int, cachedStops caches.ParentStopsByChildCache) ServicesStop {
	stopData := stopsForTripId[max(currentStop, 0)]
	if stopData.ParentStation != "" {
		parentStop, ok := cachedStops()[stopData.StopId]
		if ok && parentStop.StopName != "" {
			stopData.StopName = parentStop.StopName
			stopData.StopId = stopData.ParentStation
		}
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

type DelayTimes struct {
	ArrivalTime   time.Time
	DepartureTime time.Time
	Skipped       bool
	ScheduledTime time.Time
}

func getPredictedStopArrivalTimesForTrip(stopUpdates []*proto.TripUpdate_StopTimeUpdate, localTimeZone *time.Location) map[string]DelayTimes {
	results := make(map[string]DelayTimes)

	for _, update := range stopUpdates {
		stopId := update.GetStopId()

		var arrivalTime, departureTime time.Time

		// GTFS-RT: If time is 0, it means no update is available for that field.
		if update.Arrival != nil && update.Arrival.Time != nil && update.GetArrival().GetTime() > 0 {
			arrivalTime = time.Unix(update.GetArrival().GetTime(), 0).In(localTimeZone)
		}
		if update.Departure != nil && update.Departure.Time != nil && update.GetDeparture().GetTime() > 0 {
			departureTime = time.Unix(update.GetDeparture().GetTime(), 0).In(localTimeZone)
		}

		// If only one of arrival/departure is set, use that for both (fallback)
		if arrivalTime.IsZero() && !departureTime.IsZero() {
			arrivalTime = departureTime
		}
		if departureTime.IsZero() && !arrivalTime.IsZero() {
			departureTime = arrivalTime
		}

		var stopSkipped = false

		switch update.GetScheduleRelationship().Enum().String() {
		case "SKIPPED":
			stopSkipped = true
		case "NO_DATA":
		case "UNSCHEDULED":
			//skip
			continue
		}

		if stopId != "" {
			results[stopId] = DelayTimes{
				ArrivalTime:   arrivalTime,
				DepartureTime: departureTime,
				Skipped:       stopSkipped,
			}
		}
	}

	return results
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
	OffCourse    bool             `json:"off_course"`
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
