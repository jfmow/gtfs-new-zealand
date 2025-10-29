package providers

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/jfmow/gtfs"
	"github.com/labstack/echo/v5"
)

func setupRoutesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, getRouteCache func() map[string]gtfs.Route) {
	routesRoute := primaryRoute.Group("/routes")

	routesRoute.GET("/:routeId", func(c echo.Context) error {
		routeIdEncoded := c.PathParam("routeId")
		routeId, err := url.PathUnescape(routeIdEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route id", nil, ResponseDetails("routeId", routeIdEncoded, "details", "Invalid route ID format", "error", err.Error()))
		}
		cachedRoutes := getRouteCache()
		route, ok := cachedRoutes[routeId]

		if !ok {
			return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("routeId", routeId, "details", "No route found for the given route ID in the cache"))
		}

		return JsonApiResponse(c, http.StatusOK, "", route)
	})

	primaryRoute.GET("/routes", func(c echo.Context) error {
		cachedRoutes := getRouteCache()

		if len(cachedRoutes) == 0 {
			return JsonApiResponse(c, http.StatusNotFound, "no routes found", nil, ResponseDetails("details", "No routes available in the cache"))
		}

		return JsonApiResponse(c, http.StatusOK, "", cachedRoutes)
	})

	routesRoute.GET("/find-route/:routeName", func(c echo.Context) error {
		routeNameEncoded := c.PathParam("routeName")
		routeName, err := url.PathUnescape(routeNameEncoded)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route", nil, ResponseDetails("routeName", routeNameEncoded, "details", "Invalid route name format", "error", err.Error()))
		}

		routes, err := gtfsData.SearchForRouteByNameOrID(routeName)
		if err != nil {
			fmt.Println(err)
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route", nil, ResponseDetails("routeName", routeName, "details", "No routes matching the given name found", "error", err.Error()))
		}

		return JsonApiResponse(c, http.StatusOK, "", routes)
	})
}
