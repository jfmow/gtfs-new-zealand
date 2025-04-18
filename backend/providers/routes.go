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

func setupRoutesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getRouteCache func() map[string]gtfs.Route) {
	routesRoute := primaryRoute.Group("/routes")
	routesRoute.Use(middleware.GzipWithConfig(gzipConfig))

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
		cachedRoutes := getRouteCache()
		route, ok := cachedRoutes[routeId]

		if !ok {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no route found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    route,
		})
	})

	//Returns a list of routes from the AT api
	primaryRoute.GET("/routes", func(c echo.Context) error {
		cachedRoutes := getRouteCache()

		if len(cachedRoutes) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no routes found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    cachedRoutes,
		})
	})
}
