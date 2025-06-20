package providers

import (
	"os"
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
	traceID, _ := c.Get("trace_id").(string)

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

func SetupProvider(primaryRouter *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {
	caches := caches.CreateCaches(gtfsData)
	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	setupServicesRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache)
	setupRoutesRoutes(primaryRouter, caches.GetRouteCache)
	setupStopsRoutes(primaryRouter, gtfsData, caches.GetParentStopsCache, caches.GetAllStopsCache, caches.GetStopsForTripCache)
	setupRealtimeRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache, caches.GetRouteCache, caches.GetParentStopsByChildCache)
	setupNavigationRoutes(primaryRouter, gtfsData)

	if val := os.Getenv("PRODUCTION"); val == "true" {
		notifications.SetupNotificationsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetParentStopsByChildCache, caches.GetStopsForTripCache)
	}

}
