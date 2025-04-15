package providers

import (
	"net/http"
	"net/url"
	"time"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupRoutesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {
	routesRoute := primaryRoute.Group("/routes")
	routesRoute.Use(middleware.GzipWithConfig(gzipConfig))

	//TODO: remove one of these

	//Return a route by routeId
	routesRoute.GET("/:routeId", func(c echo.Context) error {
		routeIdEncoded := c.PathParam("routeId")
		routeId, err := url.PathUnescape(routeIdEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid route id",
				Data:    nil,
			})
		}
		routes, err := gtfsData.SearchForRouteByID(routeId)

		if len(routes) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no route found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    routes,
		})
	})

	//Returns a list of routes from the AT api
	primaryRoute.GET("/routes", func(c echo.Context) error {
		routes, err := gtfsData.GetRoutes()

		if len(routes) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no routes found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    routes,
		})
	})
}
