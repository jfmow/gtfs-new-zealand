package providers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	"github.com/labstack/echo/v5"
)

func setupStopsRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, getParentStopsCache caches.ParentStopsCache, getAllStopsCache caches.AllStopsCache, getStopsForTripCache caches.StopsForTripCache) {
	stopsRoute := primaryRoute.Group("/stops")

	//Returns stops for a trip by tripId
	stopsRoute.GET("/:tripId", func(c echo.Context) error {
		tripIdEncoded := c.PathParam("tripId")
		tripId, err := url.PathUnescape(tripIdEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid trip id", nil, ResponseDetails("tripId", tripIdEncoded, "details", "Invalid trip ID format", "error", err.Error()))
		}

		stopsForTripCache := getStopsForTripCache()

		stops, ok := stopsForTripCache[tripId]
		if len(stops.Stops) == 0 || !ok {
			return JsonApiResponse(c, http.StatusBadRequest, "no stops found for trip", nil, ResponseDetails("tripId", tripId, "details", "No stops available for the given trip ID in the cache"))
		}

		var result []ServicesStop
		for _, i := range stops.Stops {
			var responseData ServicesStop
			stop, err := gtfsData.GetParentStopByChildStopID(i.StopId)
			if err != nil {
				return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("stopId", i.StopId, "details", "No parent stop available for the given child stop ID in the gtfs data", "error", err.Error()))
			}

			responseData.Id = stop.StopId
			responseData.Lat = stop.StopLat
			responseData.Lon = stop.StopLon
			responseData.Name = stop.StopName + " " + stop.StopCode
			responseData.Platform = i.PlatformNumber
			responseData.Sequence = i.Sequence

			result = append(result, responseData)
		}

		return JsonApiResponse(c, http.StatusOK, "", result)
	})

	//Returns the closest stop to a given lat,lon
	stopsRoute.POST("/closest-stop", func(c echo.Context) error {
		latStr := c.FormValue("lat")
		lonStr := c.FormValue("lon")

		// Convert lat and lon to float64
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid lat", nil, ResponseDetails("lat", latStr, "details", "Invalid latitude format", "error", err.Error()))
		}

		lon, err := strconv.ParseFloat(lonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid lon", nil, ResponseDetails("lon", lonStr, "details", "Invalid longitude format", "error", err.Error()))
		}

		stops := getAllStopsCache()
		if len(stops) == 0 {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", "No stops available in the cache"))
		}

		var sortedArray gtfs.Stops
		for _, i := range stops {
			if i.LocationType == 1 {
				sortedArray = append(sortedArray, i)
			} else if i.LocationType == 0 && i.ParentStation == "" {
				sortedArray = append(sortedArray, i)
			}
		}

		closetStop := sortedArray.FindClosestStops(lat, lon)

		return JsonApiResponse(c, http.StatusOK, "", closetStop)
	})

	//Returns all the stops matching the name, is a search function. e.g bald returns [Baldwin Ave Train Station, ymca...etc] stop data
	stopsRoute.GET("/find-stop/:stopName", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stopName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop", nil, ResponseDetails("stopName", stopNameEncoded, "details", "Invalid stop name format", "error", err.Error()))
		}
		children := c.QueryParam("children")

		stops, err := gtfsData.SearchForStopsByNameOrCode(stopName, children == "true")
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid stop", nil, ResponseDetails("stopName", stopName, "details", "No stops matching the given name or code found", "error", err.Error()))
		}

		return JsonApiResponse(c, http.StatusOK, "", stops)
	})

	//Returns a list of all stops from the AT api
	primaryRoute.GET("/stops", func(c echo.Context) error {
		filterChildren := c.QueryParam("children")
		var noChildren bool
		switch filterChildren {
		case "true":
			noChildren = false
		case "false":
			noChildren = true
		default:
			if filterChildren != "" {
				return JsonApiResponse(c, http.StatusNotFound, "Invalid children filter", nil, ResponseDetails("children", filterChildren, "details", "Children filter must be 'yes' or 'no'"))
			}
		}
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
				return JsonApiResponse(c, http.StatusBadRequest, "Invalid bounds format", nil, ResponseDetails("bounds", boundsStr, "details", "Invalid bounds format", "error", err.Error()))
			}

			// Basic validation
			if len(rawBounds) != 2 || len(rawBounds[0]) != 2 || len(rawBounds[1]) != 2 {
				return JsonApiResponse(c, http.StatusBadRequest, "Invalid bounds format", nil, ResponseDetails("bounds", boundsStr, "details", "Bounds must be in the format [[lat1,lng1],[lat2,lng2]]"))
			}
		}

		point1 := LatLng{Lat: rawBounds[0][0], Lng: rawBounds[0][1]}
		point2 := LatLng{Lat: rawBounds[1][0], Lng: rawBounds[1][1]}

		var stops []gtfs.Stop
		if noChildren {
			stops = getParentStopsCache()
		} else {
			stops = getAllStopsCache()
		}
		if len(stops) == 0 {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("error", "No stops available in the cache"))
		}

		var filteredStops []gtfs.Stop

		for _, stop := range stops {
			if hasBounds && !pointInBounds(stop.StopLat, stop.StopLon, point1, point2) {
				continue
			} else {
				filteredStops = append(filteredStops, stop)
			}
		}

		return JsonApiResponse(c, http.StatusOK, "", filteredStops)

	})
}
