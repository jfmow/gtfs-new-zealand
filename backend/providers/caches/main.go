package caches

import (
	"log"

	"github.com/jfmow/gtfs"
)

type StopsForTripId struct {
	Stops          []gtfs.Stop
	LowestSequence int
}

type StopsForTripCache func() map[string]StopsForTripId
type ParentStopsCache func() []gtfs.Stop
type ParentStopsByChildCache func() map[string]gtfs.Stop
type AllStopsCache func() []gtfs.Stop
type RouteCache func() map[string]gtfs.Route

type Caches struct {
	GetStopsForTripCache       StopsForTripCache
	GetParentStopsCache        ParentStopsCache
	GetParentStopsByChildCache ParentStopsByChildCache
	GetAllStopsCache           AllStopsCache
	GetRouteCache              RouteCache
}

func CreateCaches(gtfsData gtfs.Database) Caches {
	getStopsForTripCache, err := gtfs.GenerateACache(
		func() (map[string][]gtfs.Stop, error) {
			trips, err := gtfsData.GetStopsForTrips(2)
			return trips, err
		},
		func(input map[string][]gtfs.Stop) (map[string]StopsForTripId, error) {
			result := make(map[string]StopsForTripId)
			for key, trip := range input {
				lowest := -1
				for _, stop := range trip {
					if stop.Sequence < lowest || lowest == -1 {
						lowest = stop.Sequence
					}
				}
				result[key] = StopsForTripId{
					Stops:          trip,
					LowestSequence: lowest,
				}
			}
			return result, nil
		},
		make(map[string]StopsForTripId, 0),
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

	return Caches{
		GetStopsForTripCache:       getStopsForTripCache,
		GetParentStopsCache:        getParentStopsCache,
		GetParentStopsByChildCache: getParentStopsByChildCache,
		GetAllStopsCache:           getAllStopsCache,
		GetRouteCache:              getRouteCache,
	}
}
