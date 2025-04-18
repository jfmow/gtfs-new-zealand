package providers

import (
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupStopsRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getParentStopsCache func() []gtfs.Stop, getAllStopsCache func() []gtfs.Stop, getStopsForTripCache func() map[string]stopsForTripId) {
	stopsRoute := primaryRoute.Group("/stops")
	stopsRoute.Use(middleware.GzipWithConfig(gzipConfig))

	//Returns stops for a trip by tripId
	stopsRoute.GET("/:tripId", func(c echo.Context) error {
		tripIdEncoded := c.PathParam("tripId")
		tripId, err := url.PathUnescape(tripIdEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid trip id",
				Data:    nil,
			})
		}

		stopsForTripCache := getStopsForTripCache()

		stops, ok := stopsForTripCache[tripId]
		if len(stops.Stops) == 0 || !ok {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no stops found for trip",
				Data:    nil,
			})
		}

		var result []ServicesStop
		for _, i := range stops.Stops {
			var responseData ServicesStop
			stop, err := gtfsData.GetParentStopByChildStopID(i.StopId)
			if err != nil {
				return c.JSON(http.StatusNotFound, Response{
					Code:    http.StatusNotFound,
					Message: "no parent stop found for stop",
					Data:    nil,
				})
			}

			responseData.Id = stop.StopId
			responseData.Lat = stop.StopLat
			responseData.Lon = stop.StopLon
			responseData.Name = stop.StopName + " " + stop.StopCode
			responseData.Platform = i.PlatformNumber
			responseData.Sequence = i.Sequence

			result = append(result, responseData)
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    result,
		})
	})

	//Returns the closest stop to a given lat,lon
	stopsRoute.POST("/closest-stop", func(c echo.Context) error {
		latStr := c.FormValue("lat")
		lonStr := c.FormValue("lon")

		// Convert lat and lon to float64
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid lat",
				Data:    nil,
			})
		}

		lon, err := strconv.ParseFloat(lonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid lon",
				Data:    nil,
			})
		}

		stops := getAllStopsCache()
		if len(stops) == 0 {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no stops found",
				Data:    nil,
			})
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

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    closetStop,
		})
	})

	//Returns all the stops matching the name, is a search function. e.g bald returns [Baldwin Ave Train Station, ymca...etc] stop data
	stopsRoute.GET("/find-stop/:stopName", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stopName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop",
				Data:    nil,
			})
		}
		children := c.QueryParam("children")

		stops, err := gtfsData.SearchForStopsByNameOrCode(stopName, children == "true")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no stops matching found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    stops,
		})
	})

	//Returns a list of all stops from the AT api
	primaryRoute.GET("/stops", func(c echo.Context) error {
		noChildren := c.QueryParam("noChildren")
		var stops []gtfs.Stop
		if noChildren == "1" {
			stops = getParentStopsCache()
		} else {
			stops = getAllStopsCache()
		}
		if len(stops) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no stops found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    stops,
		})

	})
}
