package providers

import (
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/at-trains-api/providers/notifications"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

var gzipConfig = middleware.GzipConfig{
	Level: 5,
}

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
	TraceID string `json:"trace_id"`
}

func JsonApiResponse(c echo.Context, code int, message string, data any, details ...any) error {
	traceID := ""
	if v := c.Get("trace_id"); v != nil {
		if s, ok := v.(string); ok {
			traceID = s
		}
	}

	if len(details) > 0 {
		// Store details in context for middleware to log later
		c.Set("log_details", details[0])
	}

	return c.JSON(code, Response{
		Code:    code,
		Message: message,
		Data:    data,
		TraceID: traceID,
	})
}

func ResponseDetails(pairs ...any) map[string]any {
	m := make(map[string]any)
	length := len(pairs)
	for i := 0; i < length; i += 2 {
		if i+1 < length {
			key, ok := pairs[i].(string)
			if ok {
				m[key] = pairs[i+1]
			}
		}
	}
	return m
}

func SetupProvider(primaryRouter *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, gtfsName string, localTimeZone *time.Location) {
	primaryRouter.Use(middleware.GzipWithConfig(gzipConfig))

	caches := caches.CreateCaches(gtfsData)

	setupServicesRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache)
	setupRoutesRoutes(primaryRouter, gtfsData, caches.GetRouteCache)
	setupStopsRoutes(primaryRouter, gtfsData, caches.GetParentStopsCache, caches.GetAllStopsCache, caches.GetStopsForTripCache)
	setupRealtimeRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache, caches.GetRouteCache, caches.GetParentStopsByChildCache)
	setupNavigationRoutes(primaryRouter, gtfsData)

	notifications.SetupNotificationsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetParentStopsByChildCache, caches.GetStopsForTripCache)

	/*hsdb := history.SetupHistoricalDataStorage(realtime, gtfsName, localTimeZone)

	primaryRouter.GET("/hs/:trip", func(c echo.Context) error {
		encodedtripId := c.PathParam("trip")
		tripId, err := url.PathUnescape(encodedtripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid trip", nil, ResponseDetails("tripId", encodedtripId, "details", "Invalid trip ID format", "error", err.Error()))
		}
		updates, positions := hsdb.GetHistoricTrip(tripId)
		return JsonApiResponse(c, 200, "OK", map[string]any{
			"updates":   updates,
			"positions": positions,
		})
	})

	primaryRouter.GET("/hs", func(c echo.Context) error {
		pageParam := c.QueryParam("page")
		sizeParam := c.QueryParam("size")

		page := 1
		size := 10

		if pageParam != "" {
			fmt.Sscanf(pageParam, "%d", &page)
		}
		if sizeParam != "" {
			fmt.Sscanf(sizeParam, "%d", &size)
		}

		if size > 100 {
			size = 100
		}

		trips, totalCount, totalPages, err := hsdb.GetRecentTrips(page, size)
		if err != nil {
			log.Printf("error getting recent trips: %v", err)
			return JsonApiResponse(c, 500, "Database Error", nil)
		}

		response := map[string]any{
			"page":        page,
			"page_size":   size,
			"total_count": totalCount,
			"total_pages": totalPages,
			"trips":       trips,
		}

		return JsonApiResponse(c, 200, "OK", response)
	})

	// GET historic trips by route id with optional start/end timestamp query params
	// Example: /hs/route/ROUTE123?start=1690000000&end=1690100000
	primaryRouter.GET("/hs/route/:route", func(c echo.Context) error {
		encodedrouteId := c.PathParam("route")
		routeId, err := url.PathUnescape(encodedrouteId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route", nil, ResponseDetails("routeId", encodedrouteId, "details", "Invalid route ID format", "error", err.Error()))
		}

		var startPtr *int64
		var endPtr *int64

		if s := c.QueryParam("start"); s != "" {
			if v, err := strconv.ParseInt(s, 10, 64); err == nil {
				startPtr = &v
			}
		}
		if e := c.QueryParam("end"); e != "" {
			if v, err := strconv.ParseInt(e, 10, 64); err == nil {
				endPtr = &v
			}
		}

		updates, err := hsdb.GetHistoricTripsByRoute(routeId, startPtr, endPtr)
		if err != nil {
			fmt.Println(err)
			return JsonApiResponse(c, 500, "Error", nil, map[string]any{"error": err.Error()})
		}

		trips, err := gtfsData.GetTripsByIDs(updates)
		if err != nil {
			return JsonApiResponse(c, 500, "Error", nil, map[string]any{"error": err.Error()})
		}

		return JsonApiResponse(c, 200, "OK", trips)
	})*/
}
