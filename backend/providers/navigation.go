package providers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jfmow/at-trains-api/api/routing"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupNavigationRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {
	navigationRoute := primaryRoute.Group("/map")
	navigationRoute.Use(middleware.GzipWithConfig(gzipConfig))

	//Returns the route of a route as geo json
	navigationRoute.POST("/geojson/shapes", func(c echo.Context) error {
		tripId := c.FormValue("tripId")
		routeId := c.FormValue("routeId")

		shapes, err := gtfsData.GetShapeByTripID(tripId)
		if err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no route line found",
				Data:    nil,
			})
		}
		geoJson, err := shapes.ToGeoJSON()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "problem generating route line",
				Data:    nil,
			})
		}

		route, err := gtfsData.GetRouteByID(routeId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid route id",
				Data:    nil,
			})
		}

		type MapResponse struct {
			Color   string `json:"color"`
			GeoJson any    `json:"geojson"`
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data: MapResponse{
				GeoJson: geoJson,
				Color:   route.RouteColor,
			},
		})
	})

	//Finds a walking route from lat,lon to lat,lon using osrm
	navigationRoute.POST("/nav", func(c echo.Context) error {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
		defer cancel()

		slatStr := c.FormValue("startLat")
		slonStr := c.FormValue("startLon")
		elatStr := c.FormValue("endLat")
		elonStr := c.FormValue("endLon")
		method := c.FormValue("method")

		if method == "" {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "missing method (walking/driving)",
				Data:    nil,
			})
		}

		// Convert lat and lon to float64
		slat, err := strconv.ParseFloat(slatStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lat",
				Data:    nil,
			})
		}

		slon, err := strconv.ParseFloat(slonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lon",
				Data:    nil,
			})
		}

		elat, err := strconv.ParseFloat(elatStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lat",
				Data:    nil,
			})
		}

		elon, err := strconv.ParseFloat(elonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lon",
				Data:    nil,
			})
		}

		if slat == 0 || slon == 0 {
			return c.JSON(http.StatusTeapot, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lat & lon",
				Data:    nil,
			})
		}
		if elat == 0 || elon == 0 {
			return c.JSON(http.StatusTeapot, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lat & lon",
				Data:    nil,
			})
		}

		start := routing.Coordinates{Lat: slat, Lon: slon} // Start point
		end := routing.Coordinates{Lat: elat, Lon: elon}   // End point

		var result routing.GeoJSONResponse
		done := make(chan struct{})

		go func() {
			defer close(done)
			switch method {
			case "walking":
				result = routing.GetWalkingDirections(start, end)
			case "driving":
				result = routing.GetDrivingDirections(start, end)
			default:
				c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid method",
					Data:    nil,
				})
				return
			}
		}()

		select {
		case <-ctx.Done():
			log.Println("Request timed out")
			return c.JSON(http.StatusRequestTimeout, Response{
				Code:    http.StatusRequestTimeout,
				Message: "request took too long",
				Data:    nil,
			})
		case <-done:
			if len(result.Features) == 0 {
				return c.JSON(http.StatusNotFound, Response{
					Code:    http.StatusNotFound,
					Message: "no route found",
					Data:    nil,
				})
			}
			return c.JSON(http.StatusOK, Response{
				Code:    http.StatusOK,
				Message: "",
				Data:    result,
			})
		}
	})
}
