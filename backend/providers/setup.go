package providers

import (
	"log"
	"os"
	"time"

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

type stopsForTripId struct {
	Stops          []gtfs.Stop
	LowestSequence int
}

func SetupProvider(primaryRouter *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location) {

	getStopsForTripCache, err := gtfs.GenerateACache(
		func() (map[string][]gtfs.Stop, error) {
			trips, err := gtfsData.GetStopsForTrips(2)
			return trips, err
		},
		func(input map[string][]gtfs.Stop) (map[string]stopsForTripId, error) {
			result := make(map[string]stopsForTripId)
			for key, trip := range input {
				lowest := -1
				for _, stop := range trip {
					if stop.Sequence < lowest || lowest == -1 {
						lowest = stop.Sequence
					}
				}
				result[key] = stopsForTripId{
					Stops:          trip,
					LowestSequence: lowest,
				}
			}
			return result, nil
		},
		make(map[string]stopsForTripId, 0),
		gtfsData,
	)
	if err != nil {
		log.Printf("Failed to init trip stops cache: %v", err)
	}

	//Does not include child stops
	getParentStopsCache, err := gtfs.GenerateACache(func() ([]gtfs.Stop, error) {
		stops, err := gtfsData.GetStops(false)
		return stops, err
	}, gtfs.Identity[[]gtfs.Stop], nil, gtfsData)
	if err != nil {
		log.Fatal(err)
	}

	getParentStopsByChildCache, err := gtfs.GenerateACache(func() (map[string]gtfs.Stop, error) {
		allStops, err := gtfsData.GetStopsMap(true)
		if err != nil {
			return nil, err
		}
		parentStops, err := gtfsData.GetStopsMap(false)
		if err != nil {
			return nil, err
		}
		var result map[string]gtfs.Stop = make(map[string]gtfs.Stop)
		for _, stop := range allStops {
			if stop.IsChildStop {
				if parentStop, found := parentStops[stop.ParentStation]; found {
					result[stop.StopId] = parentStop
				}
			} else if stop.ParentStation == "" {
				result[stop.StopId] = stop
			}
		}
		return result, nil
	}, gtfs.Identity[map[string]gtfs.Stop], nil, gtfsData)
	if err != nil {
		log.Fatal(err)
	}

	//Does include child stops
	getAllStopsCache, err := gtfs.GenerateACache(func() ([]gtfs.Stop, error) {
		stops, err := gtfsData.GetStops(true)
		return stops, err
	}, gtfs.Identity[[]gtfs.Stop], nil, gtfsData)
	if err != nil {
		log.Fatal(err)
	}

	getRouteCache, err := gtfs.GenerateACache(gtfsData.GetRoutes, func(routes []gtfs.Route) (map[string]gtfs.Route, error) {
		newCache := make(map[string]gtfs.Route)
		for _, route := range routes {
			newCache[route.RouteId] = route
		}
		return newCache, nil
	}, make(map[string]gtfs.Route, 0), gtfsData)
	if err != nil {
		log.Printf("Failed to init routes cache: %v", err)
	}

	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	setupServicesRoutes(primaryRouter, gtfsData, realtime, localTimeZone, getStopsForTripCache, getParentStopsCache)
	setupRoutesRoutes(primaryRouter, realtime, localTimeZone, getRouteCache)
	setupStopsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, getParentStopsCache, getAllStopsCache, getStopsForTripCache)
	setupRealtimeRoutes(primaryRouter, gtfsData, realtime, localTimeZone, getStopsForTripCache, getRouteCache)
	setupNavigationRoutes(primaryRouter, gtfsData, realtime, localTimeZone)

	if val := os.Getenv("PRODUCTION"); val == "true" {
		notifications.SetupNotificationsRoutes(primaryRouter, gtfsData, realtime, localTimeZone, getParentStopsByChildCache)
	}

}
