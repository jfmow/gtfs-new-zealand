package providers

import (
	"encoding/json"
	"errors"
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

// parseGTFSClock parses a GTFS "HH:MM:SS" time-of-day - where the hour may be
// >= 24 for service that runs past midnight - and anchors it to `date`'s
// calendar day, rolling the extra hours into the following day. Returns false on
// an unparseable value.
func parseGTFSClock(clock string, date time.Time, loc *time.Location) (time.Time, bool) {
	parts := strings.Split(strings.TrimSpace(clock), ":")
	if len(parts) < 2 {
		return time.Time{}, false
	}
	h, errH := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	s := 0
	if len(parts) >= 3 {
		s, _ = strconv.Atoi(parts[2])
	}
	if errH != nil || errM != nil || h < 0 || m < 0 || s < 0 {
		return time.Time{}, false
	}
	midnight := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, loc)
	return midnight.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second), true
}

func clampInt32Seconds(v int32, lo, hi int32) int32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func setupRealtimeRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache caches.StopsForTripCache, getRouteCache caches.RouteCache, getParentStopByChildCache caches.ParentStopsByChildCache) {
	realtimeRoute := primaryRoute.Group("/realtime")

	//Returns all the locations of vehicles from the AT api
	realtimeRoute.GET("/live", func(c echo.Context) error {
		// ==================================================================
		// Read and decode query parameters
		// ==================================================================
		// All params are URL-escaped by default, so unescape first.
		// tripId accepts a single trip ID (legacy) or a comma-separated list of
		// trip IDs (e.g. all transit legs of a planned journey) - both filter to
		// exactly the given set of trips, matched by ID membership.
		tripIDParam, err := url.PathUnescape(c.QueryParam("tripId"))
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid trip id", nil,
				ResponseDetails("tripId", c.QueryParam("tripId"), "error", err.Error()))
		}

		tripIDs := make(map[string]bool)
		for _, id := range strings.Split(tripIDParam, ",") {
			if id = strings.TrimSpace(id); id != "" {
				tripIDs[id] = true
			}
		}

		vehicleTypeFilter, err := url.PathUnescape(c.QueryParam("type"))
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid vehicle type", nil,
				ResponseDetails("vehicle_type", c.QueryParam("type"), "error", err.Error()))
		}

		boundsStr, err := url.PathUnescape(c.QueryParam("bounds"))
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid bounds", nil,
				ResponseDetails("bounds", c.QueryParam("bounds"), "error", err.Error()))
		}

		// ==================================================================
		// Parse bounds (optional)
		// ==================================================================
		// Bounds restrict vehicles to a visible map area.
		// If omitted, all vehicles are returned.
		hasBounds := boundsStr != ""
		rawBounds := [][]float64{{0, 0}, {0, 0}}

		if hasBounds {
			// Expect [[lat1,lng1],[lat2,lng2]]
			if err := json.Unmarshal([]byte(boundsStr), &rawBounds); err != nil ||
				len(rawBounds) != 2 || len(rawBounds[0]) != 2 || len(rawBounds[1]) != 2 {

				return JsonApiResponse(
					c,
					http.StatusBadRequest,
					"invalid bounds format",
					nil,
					ResponseDetails(
						"bounds",
						boundsStr,
						"details",
						"Expected [[lat1,lng1],[lat2,lng2]]",
					),
				)
			}
		}

		// Normalize bounds into LatLng structs for easy reuse
		boundA := LatLng{Lat: rawBounds[0][0], Lng: rawBounds[0][1]}
		boundB := LatLng{Lat: rawBounds[1][0], Lng: rawBounds[1][1]}

		// ==================================================================
		// Load realtime GTFS feeds
		// ==================================================================
		// Vehicles = live positions
		// TripUpdates = service status + stop progression
		vehicles, err := realtime.GetVehicles()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil,
				ResponseDetails("error", "No vehicles found", "details", err.Error()))
		}

		tripUpdates, err := realtime.GetTripUpdates()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil,
				ResponseDetails("error", "No trip updates found", "details", err.Error()))
		}

		// ==================================================================
		// Preload caches to avoid repeated DB / file access
		// ==================================================================
		routeCache := getRouteCache()
		stopsForTripCache := getStopsForTripCache()

		response := make([]VehiclesResponse, 0)

		// ==================================================================
		// Main vehicle processing loop
		// ==================================================================
		for _, vehicle := range vehicles {
			pos := vehicle.GetPosition()
			lat, lng := float64(pos.GetLatitude()), float64(pos.GetLongitude())

			// A vehicle entity with no Position field set still returns a
			// (non-nil) zero-value struct from GetPosition() - lat/lng both
			// 0, "Null Island" in the Gulf of Guinea. Without this check that
			// sails through as a "valid" position and the frontend animates
			// the marker flying there before snapping back next poll.
			if lat == 0 && lng == 0 {
				continue
			}

			// Skip vehicles outside the requested map bounds
			if hasBounds && !pointInBounds(lat, lng, boundA, boundB) {
				continue
			}

			trip := vehicle.GetTrip()
			tripIDCur := trip.GetTripId()
			routeID := trip.GetRouteId()

			// Skip vehicles without valid trip or route data
			if tripIDCur == "" || routeID == "" {
				continue
			}

			// If specific trips are requested, only include those trips
			if len(tripIDs) > 0 && !tripIDs[tripIDCur] {
				continue
			}

			// ------------------------------------------------------------------
			// Trip update validation
			// ------------------------------------------------------------------
			// Ensure the trip has started and is currently in service
			tripUpdate, err := tripUpdates.ByTripID(tripIDCur)
			if err != nil || !checkIfTripStarted(
				tripUpdate.GetTrip().GetStartTime(),
				tripUpdate.GetTrip().GetStartDate(),
				localTimeZone,
			) {
				continue
			}

			// ------------------------------------------------------------------
			// Route lookup + vehicle type filtering
			// ------------------------------------------------------------------
			routeData, err := getVehicleRouteData(routeID, routeCache)
			if err != nil {
				continue
			}

			// Allow filtering by vehicle type (bus, rail, etc.)
			if vehicleTypeFilter != "" &&
				vehicleTypeFilter != "all" &&
				!strings.EqualFold(routeData.VehicleType, vehicleTypeFilter) {
				continue
			}

			// ------------------------------------------------------------------
			// Base response payload
			// ------------------------------------------------------------------
			resp := VehiclesResponse{
				TripId:       tripIDCur,
				Route:        *routeData,
				VehicleType:  strings.ToLower(routeData.VehicleType),
				Position:     VehiclesPosition{Lat: pos.GetLatitude(), Lon: pos.GetLongitude(), Bearing: pos.GetBearing()},
				Occupancy:    int8(vehicle.GetOccupancyStatus()),
				LicensePlate: vehicle.GetVehicle().GetLicensePlate(),
			}

			// ------------------------------------------------------------------
			// Detailed trip information (only when specific trip(s) are requested)
			// ------------------------------------------------------------------
			// Skipped for the unfiltered/bounds-based list view (could be many
			// vehicles) for performance. Safe to always populate here since a
			// trip-ID filter bounds this to at most a handful of vehicles (e.g.
			// the legs of one planned journey), and the lookups below are cheap
			// cache/map hits.
			if len(tripIDs) > 0 {
				currentTrip, err := gtfsData.GetTripByID(tripIDCur)
				if err != nil {
					continue
				}

				stopsData, ok := stopsForTripCache[tripIDCur]
				if !ok || len(stopsData.Stops) == 0 || stopsData.LowestSequence == -1 {
					continue
				}

				// Ensure stops are ordered by sequence
				sort.Slice(stopsData.Stops, func(i, j int) bool {
					return stopsData.Stops[i].Sequence < stopsData.Stops[j].Sequence
				})

				// Determine next stop and trip state (in-transit, stopped, etc.)
				nextSeq, _, state := getNextStopSequence(
					tripUpdate.GetStopTimeUpdate(),
					stopsData.LowestSequence,
					localTimeZone,
					stopsData.Stops,
					lat,
					lng,
				)

				resp.State = state
				resp.Trip = &VehiclesTrip{
					Headsign:    currentTrip.TripHeadsign,
					FirstStop:   getStopBySequenceNumber(stopsData.Stops, 0, getParentStopByChildCache),
					CurrentStop: getStopBySequenceNumber(stopsData.Stops, min(nextSeq-1, len(stopsData.Stops)-1), getParentStopByChildCache),
					NextStop:    getStopBySequenceNumber(stopsData.Stops, min(nextSeq, len(stopsData.Stops)-1), getParentStopByChildCache),
					FinalStop:   getStopBySequenceNumber(stopsData.Stops, len(stopsData.Stops)-1, getParentStopByChildCache),
				}

				// Detect vehicles that have deviated significantly from the route shape
				if line, err := NewTripShapeDistance(tripIDCur, gtfsData); err == nil {
					if dist, err := line.DistanceFromLine(lat, lng); err == nil && dist > 500 {
						resp.OffCourse = true
					}
				}
			}

			response = append(response, resp)
		}

		// ==================================================================
		// Final response
		// ==================================================================
		if len(response) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no vehicles found", nil,
				ResponseDetails("error", "No vehicles found matching the given criteria"))
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
		var routesKeys []string

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
				routesKeys = append(routesKeys, v.RouteId)
			}

		}

		if len(foundRoutes) == 0 {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("details", "no routes found for stop: "+stopName))
		}

		// Make sure this is initialised somewhere before the loop
		foundAlerts := make(map[string][]AlertResponseData)

		for _, route := range foundRoutes {
			alertsForRoute, err := alerts.FindAlertsByRouteId(route.RouteId)
			if err != nil {
				continue // No alerts for this route
			}

			for _, alert := range alertsForRoute {
				if filterByToday {
					isToday := false
					for _, period := range alert.GetActivePeriod() {
						startTime := time.Unix(int64(period.GetStart()), 0)
						nowDay := time.Now().In(localTimeZone).YearDay()
						alertDay := startTime.In(localTimeZone).YearDay()
						if nowDay == alertDay {
							isToday = true
							break // no need to keep checking
						}
					}
					if !isToday {
						continue
					}
				}

				activePeriods := alert.GetActivePeriod()
				if len(activePeriods) == 0 {
					// no start or end
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

				parsedAlert := AlertResponseData{
					StartDate:   int(smallestStart),
					EndDate:     int(biggestEnd),
					Cause:       alert.GetCause().String(),
					Effect:      alert.GetEffect().String(),
					Title:       firstTranslation(alert.GetHeaderText()),
					Description: firstTranslation(alert.GetDescriptionText()),
					Severity:    alert.GetSeverityLevel().String(),
				}

				// 🔑 append to the slice for this route
				foundAlerts[route.RouteId] = append(foundAlerts[route.RouteId], parsedAlert)
			}
		}

		if len(foundAlerts) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no alerts found", nil, ResponseDetails("stopName", stopName, "details", "No alerts found for the given stop"))
		}
		//Sort by start, smallest to biggest
		for routeID := range foundAlerts {
			sort.Slice(foundAlerts[routeID], func(i, j int) bool {
				return foundAlerts[routeID][i].StartDate < foundAlerts[routeID][j].StartDate
			})
		}

		response := AlertResponse{
			Alerts:          foundAlerts,
			RoutesToDisplay: routesKeys,
		}

		return JsonApiResponse(c, http.StatusOK, "", response)
	})

	//Returns alerts from AT for a single route (used to show an inline alert banner on a trip/service view)
	realtimeRoute.GET("/alerts/route/:routeId", func(c echo.Context) error {
		routeIdEncoded := c.PathParam("routeId")
		routeId, err := url.PathUnescape(routeIdEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route id", nil, ResponseDetails("routeId", routeIdEncoded, "details", "Invalid route ID format", "error", err.Error()))
		}

		alerts, err := realtime.GetAlerts()
		if err != nil {
			return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("routeId", routeId, "details", "No alerts found for the given route", "error", err.Error()))
		}

		alertsForRoute, err := alerts.FindAlertsByRouteId(routeId)
		if err != nil {
			return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("routeId", routeId, "details", "No alerts found for the given route"))
		}

		var result []AlertResponseData

		for _, alert := range alertsForRoute {
			activePeriods := alert.GetActivePeriod()
			if len(activePeriods) == 0 {
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

			result = append(result, AlertResponseData{
				RouteId:     routeId,
				StartDate:   int(smallestStart),
				EndDate:     int(biggestEnd),
				Cause:       alert.GetCause().String(),
				Effect:      alert.GetEffect().String(),
				Title:       firstTranslation(alert.GetHeaderText()),
				Description: firstTranslation(alert.GetDescriptionText()),
				Severity:    alert.GetSeverityLevel().String(),
			})
		}

		if len(result) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no alerts found", nil, ResponseDetails("routeId", routeId, "details", "No alerts found for the given route"))
		}

		sort.Slice(result, func(i, j int) bool {
			return result[i].StartDate < result[j].StartDate
		})

		return JsonApiResponse(c, http.StatusOK, "", result)
	})

	realtimeRoute.GET("/stop-times", func(c echo.Context) error {
		filterTripId := c.QueryParam("tripId")
		if filterTripId == "" {
			return JsonApiResponse(c, http.StatusBadRequest, "Missing trip id", ResponseDetails("details", "no trip id provided"))
		}

		stopsForTrip, err := gtfsData.GetStopTimesForTripID(filterTripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", ResponseDetails(
				"details", "no stops found for trip",
				"error", err.Error(),
			))
		}

		_, lowestSequence, err := gtfsData.GetStopsForTripID(filterTripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", err.Error()))
		}

		line, err := NewTripShapeDistance(filterTripId, gtfsData)
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", err.Error()))
		}

		type StopTimes struct {
			ParentStopId  string  `json:"parent_stop_id"`
			ChildStopId   string  `json:"child_stop_id"`
			ArrivalTime   int64   `json:"arrival_time"`
			DepartureTime int64   `json:"departure_time"`
			ScheduledTime int64   `json:"scheduled_time"`
			Skipped       bool    `json:"skipped"`
			Passed        bool    `json:"passed"`
			DistanceAway  float64 `json:"dist"`
		}

		var result []StopTimes
		now := time.Now().In(localTimeZone)

		// Realtime trip updates are optional.
		stopTimesForStops := getPredictedStopArrivalTimesForTrip(nil, localTimeZone)
		nextStopSequenceNumber := 0
		var tripDelay int32 = 0
		hasTripUpdate := false

		if tripUpdates, err := realtime.GetTripUpdates(); err == nil {
			if updatesForTrip, err := tripUpdates.ByTripID(filterTripId); err == nil && updatesForTrip != nil {
				hasTripUpdate = true
				stopTimesForStops = getPredictedStopArrivalTimesForTrip(
					updatesForTrip.GetStopTimeUpdate(),
					localTimeZone,
				)
				// No live vehicle position is on hand at this point yet, so this
				// falls back to trusting the prediction (see isNearStop).
				nextStopSequenceNumber, _, _ = getNextStopSequence(
					updatesForTrip.GetStopTimeUpdate(),
					lowestSequence,
					localTimeZone,
					nil,
					0,
					0,
				)
				// Clamp a stale/garbage feed delay so it doesn't shift the whole
				// tail of the trip by hours.
				tripDelay = clampInt32Seconds(updatesForTrip.GetDelay(), -10*60, 2*60*60)
			}
		}

		// Vehicle positions are optional.
		var (
			vLat float32
			vLon float32
		)

		if vehicles, err := realtime.GetVehicles(); err == nil {
			if vehicleForTrip, err := vehicles.ByTripID(filterTripId); err == nil && vehicleForTrip != nil {
				pos := vehicleForTrip.GetPosition()
				if pos != nil {
					vLat = pos.GetLatitude()
					vLon = pos.GetLongitude()
				}
			}
		}

		// Fallback to first stop if no vehicle position is available.
		if vLat == 0 && vLon == 0 {
			for _, stop := range stopsForTrip {
				vLat = float32(stop.StopLat)
				vLon = float32(stop.StopLon)
				break
			}
		}

		for _, stop := range stopsForTrip {
			var data StopTimes

			if stop.ParentStation != "" {
				data.ParentStopId = stop.ParentStation
			} else {
				data.ParentStopId = stop.StopId
			}
			data.ChildStopId = stop.StopId

			if hasTripUpdate && nextStopSequenceNumber > (stop.Sequence-lowestSequence) {
				data.Passed = true
			}

			// GTFS clock times can be >= 24:00:00 for post-midnight service;
			// parseGTFSClock handles that (time.ParseInLocation does not).
			// Anchored to `now`'s day - correct for a currently-running trip;
			// the pre-midnight tail of a trip queried just after midnight can be
			// a day off, but those stops are already Passed.
			scheduledArrival, okArr := parseGTFSClock(stop.ArrivalTime, now, localTimeZone)
			if !okArr {
				continue
			}
			scheduledDeparture, okDep := parseGTFSClock(stop.DepartureTime, now, localTimeZone)
			if !okDep {
				scheduledDeparture = scheduledArrival
			}

			data.ScheduledTime = scheduledArrival.UnixMilli()

			update, found := stopTimesForStops[stop.StopId]
			if found {
				data.Skipped = update.Skipped
			}

			switch {
			case found && !update.ArrivalTime.IsZero():
				data.ArrivalTime = update.ArrivalTime.UnixMilli()
			case !data.Passed:
				data.ArrivalTime = scheduledArrival.UnixMilli() + int64(tripDelay)*1000
			default:
				data.ArrivalTime = scheduledArrival.UnixMilli()
			}

			switch {
			case found && !update.DepartureTime.IsZero():
				data.DepartureTime = update.DepartureTime.UnixMilli()
			case !data.Passed:
				data.DepartureTime = scheduledDeparture.UnixMilli() + int64(tripDelay)*1000
			default:
				data.DepartureTime = scheduledDeparture.UnixMilli()
			}

			if dist, err := line.Dist(float64(vLat), float64(vLon), stop.StopLat, stop.StopLon); err == nil {
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
			if count >= 3 {
				break
			}

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
		}

		// Always return an array
		return JsonApiResponse(c, http.StatusOK, "Closest vehicles", results)
	})
}

// getNextStopSequence inspects a trip's StopTimeUpdates (which may include
// historical entries) and determines the next stop sequence number relative to
// lowestSequence, an associated event time (arrival or departure) and a simple
// state string. It does not assume the first item is the current stop; instead
// it uses timestamps to find the first upcoming event. If no future event is
// found it returns the sequence after the most recently departed stop.
//
// stopsForTrip and the vehicle's live lat/lon are used to confirm a predicted
// "AtStop" against the vehicle's actual position - a stale or early prediction
// otherwise reports "AtStop" (and "Current Stop" in the UI) while the vehicle is
// still visibly approaching. Pass a nil slice / zero lat,lon to skip this check
// and fall back to trusting the prediction, e.g. when no live position is available.
func getNextStopSequence(stopUpdates []*proto.TripUpdate_StopTimeUpdate, lowestSequence int, localTimeZone *time.Location, stopsForTrip []gtfs.Stop, vehicleLat, vehicleLon float64) (int, *time.Time, string) {
	if len(stopUpdates) == 0 {
		return 0, nil, "Unknown"
	}

	now := time.Now().In(localTimeZone)

	// First pass: find the earliest stop whose arrival or departure is in the future.
	// Sort stopUpdates by sequence number for consistent processing
	sort.Slice(stopUpdates, func(i, j int) bool {
		if stopUpdates[i] == nil || stopUpdates[j] == nil {
			return false
		}
		return stopUpdates[i].GetStopSequence() < stopUpdates[j].GetStopSequence()
	})

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
				return idx, &at, "Approaching"
			} else if now.After(at) {
				// The predicted arrival time has passed - only report AtStop once
				// the vehicle's live position confirms it, otherwise it's still
				// approaching (a delayed vehicle can run behind its prediction).
				if isNearStop(stopsForTrip, idx, vehicleLat, vehicleLon) {
					return idx + 1, &at, "AtStop"
				}
				return idx, &at, "Approaching"
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
				return seq - lowestSequence, &dt, "Departed"
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
		// Return the time of the last event and mark as Departed
		return nextSeq - lowestSequence, &lastTime, "Departed"
	}

	// No timestamps at all → unknown
	return 0, nil, "Unknown"
}

// Get a stop from a list of stops based on its sequence number
func getStopBySequenceNumber(stopsForTripId []gtfs.Stop, currentStop int, cachedStops caches.ParentStopsByChildCache) ServicesStop {
	stopData := stopsForTripId[max(currentStop, 0)]
	//Check if we have a parent stop
	if stopData.ParentStation != "" {
		parentStop, ok := cachedStops()[stopData.StopId]
		if ok && parentStop.StopName != "" {
			stopData.StopName = parentStop.StopName
		}
	} else {
		stopData.ParentStation = stopData.StopId
	}
	result := ServicesStop{ParentStopId: stopData.ParentStation, ChildStopId: stopData.StopId, Name: stopData.StopName, Lat: stopData.StopLat, Lon: stopData.StopLon, Platform: stopData.PlatformNumber, Sequence: stopData.Sequence}

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
		case "NO_DATA", "UNSCHEDULED":
			// The feed has no realtime for this stop - don't record a prediction.
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

/*
startTime = HH:MM:SS
startDate = YYYYMMDD

returns true by default
*/
func checkIfTripStarted(startTime, startDate string, localTimeZone *time.Location) bool {
	now := time.Now().In(localTimeZone)
	if startTime != "" && startDate != "" {
		parsedStartTime, err := time.ParseInLocation("15:04:05", startTime, localTimeZone)
		if err == nil {
			parsedStartDate, err := time.ParseInLocation("20060102", startDate, localTimeZone)
			if err == nil {
				combinedStartDateTime := time.Date(parsedStartDate.Year(), parsedStartDate.Month(), parsedStartDate.Day(), parsedStartTime.Hour(), parsedStartTime.Minute(), parsedStartTime.Second(), 0, localTimeZone)
				if now.Before(combinedStartDateTime) {
					return false
				}
			}
		}
	}
	return true
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
	// Bearing is the vehicle's direction of travel in degrees (0-360, 0 = north).
	// Optional per GTFS-RT feed: absent data and due-north are indistinguishable
	// here (both serialize as 0), so treat this as best-effort/decorative only.
	Bearing float32 `json:"bearing"`
}

// Alerts response
type AlertResponse struct {
	Alerts          map[string][]AlertResponseData `json:"alerts"`
	RoutesToDisplay []string                       `json:"routes_to_display"`
}

type AlertResponseData struct {
	RouteId     string `json:"route_id,omitempty"`
	StartDate   int    `json:"start_date"`
	EndDate     int    `json:"end_date"`
	Cause       string `json:"cause"`
	Effect      string `json:"effect"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
}

// GTFS-RT alerts aren't required to carry a translation for every field -
// GetTranslation()[0] panics on an empty slice, so every read of a
// TranslatedString in this file goes through this instead. providers/notifications
// has its own copy (different package, no import path between the two).
func firstTranslation(ts *proto.TranslatedString) string {
	translations := ts.GetTranslation()
	if len(translations) == 0 {
		return ""
	}
	return translations[0].GetText()
}
