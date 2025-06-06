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
	Data    any    `json:"data"`
	Time    int64  `json:"time"`
}

func SetupProvider(primaryRouter *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {
	caches := caches.CreateCaches(gtfsData)
	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	setupServicesRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache, caches.GetParentStopsCache)
	setupRoutesRoutes(primaryRouter, realtime, localTimeZone, caches.GetRouteCache)
	setupStopsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetParentStopsCache, caches.GetAllStopsCache, caches.GetStopsForTripCache)
	setupRealtimeRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetStopsForTripCache, caches.GetRouteCache, caches.GetParentStopsByChildCache)
	setupNavigationRoutes(primaryRouter, gtfsData, realtime, localTimeZone)

	if val := os.Getenv("PRODUCTION"); val == "true" {
		notifications.SetupNotificationsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, caches.GetParentStopsByChildCache, caches.GetStopsForTripCache)
	}

}
