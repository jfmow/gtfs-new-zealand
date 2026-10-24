package providers

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/at-trains-api/providers/reliability"
	"github.com/jfmow/at-trains-api/providers/timetable"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

// Caps on one request's list (a journey has a handful of rides and changes;
// a board asks per stop instead).
const (
	maxReliabilityRides = 12
	maxConnections      = 8
)

// setupReliabilityRoutes starts the region's reliability recorder and
// serves what it has learnt:
//
//	GET /reliability/stop?stop=<id>&at=<unix>
//	    every route at a stop (or its station) -> how it usually runs then,
//	    and the real wait for frequent ones
//	GET /reliability/rides?rides=<route>|<stop>|<unix>,...
//	    the same for a journey's rides, in order (null where unknown)
//	GET /reliability/connections?changes=<routeA>|<stopA>|<unixA>|<routeB>|<stopB>|<unixB>|<slack s>,...
//	    how often each change works out, in order (null where unknown)
//	GET /reliability/route?route=<id>&day=wd|sat|sun
//	    a route: overall, by time of week, hour by hour, its trend, alerts,
//	    where it's latest, and a map line coloured by lateness
//	GET /reliability/league
//	    every route with enough data, most on time first, over the last week
func setupReliabilityRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, region, dbName string, localTimeZone *time.Location, getParentStopByChildCache caches.ParentStopsByChildCache, getRouteCache caches.RouteCache, getAllStopsCache caches.AllStopsCache) {
	store := reliability.Shared()
	stationOf := func(stopID string) string {
		if parent, ok := getParentStopByChildCache()[stopID]; ok && parent.StopId != "" {
			return parent.StopId
		}
		return stopID
	}
	reliability.Start(store, region, realtime, gtfsData, localTimeZone, stationOf)

	tt, err := timetable.Open(filepath.Join(gtfs.GetWorkDir(), "gtfs", fmt.Sprintf("gtfs-%s.db", dbName)), localTimeZone)
	if err != nil {
		log.Printf("reliability: %s timetable: %v", region, err)
	}

	at := func(raw string) time.Time {
		if u, err := strconv.ParseInt(raw, 10, 64); err == nil && u > 0 {
			return time.Unix(u, 0).In(localTimeZone)
		}
		return time.Now().In(localTimeZone)
	}

	group := primaryRoute.Group("/reliability")

	group.GET("/stop", func(c echo.Context) error {
		stop := c.QueryParam("stop")
		if stop == "" {
			return JsonApiResponse(c, http.StatusBadRequest, "missing stop", nil)
		}
		when := at(c.QueryParam("at"))
		station := stationOf(stop)
		routes := store.ForStop(region, station, when)
		waits := map[string]reliability.Wait{}
		for route := range routes {
			if headway, ok := tt.Headway(route, station, when); ok {
				if w, ok := store.WaitAt(region, route, station, when, headway); ok {
					waits[route] = w
				}
			}
		}
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"routes": routes, "waits": waits})
	})

	group.GET("/rides", func(c echo.Context) error {
		raw := strings.Split(c.QueryParam("rides"), ",")
		if len(raw) > maxReliabilityRides {
			raw = raw[:maxReliabilityRides]
		}
		out := make([]*reliability.Stat, 0, len(raw))
		for _, ride := range raw {
			parts := strings.Split(ride, "|")
			if len(parts) != 3 || parts[0] == "" || parts[1] == "" {
				out = append(out, nil)
				continue
			}
			if st, ok := store.ForRide(region, parts[0], stationOf(parts[1]), at(parts[2])); ok {
				out = append(out, &st)
			} else {
				out = append(out, nil)
			}
		}
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"rides": out})
	})

	group.GET("/connections", func(c echo.Context) error {
		raw := strings.Split(c.QueryParam("changes"), ",")
		if len(raw) > maxConnections {
			raw = raw[:maxConnections]
		}
		out := make([]*reliability.Connection, 0, len(raw))
		for _, change := range raw {
			p := strings.Split(change, "|")
			if len(p) != 7 {
				out = append(out, nil)
				continue
			}
			slack, err := strconv.Atoi(strings.TrimSpace(p[6]))
			if err != nil {
				out = append(out, nil)
				continue
			}
			if conn, ok := store.ConnectionOdds(region, p[0], stationOf(p[1]), at(p[2]), p[3], stationOf(p[4]), at(p[5]), time.Duration(slack)*time.Second); ok {
				out = append(out, &conn)
			} else {
				out = append(out, nil)
			}
		}
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"changes": out})
	})

	group.GET("/route", func(c echo.Context) error {
		routeID := c.QueryParam("route")
		route, ok := getRouteCache()[routeID]
		if routeID == "" || !ok {
			return JsonApiResponse(c, http.StatusNotFound, "route not found", nil)
		}
		now := time.Now().In(localTimeZone)
		day := c.QueryParam("day")
		if day != "wd" && day != "sat" && day != "sun" {
			day = dayTypeOf(now)
		}
		stops := map[string]gtfs.Stop{}
		for _, s := range getAllStopsCache() {
			stops[s.StopId] = s
		}
		report := store.ForRoute(region, routeID, func(id string) string { return stops[id].StopName })

		return JsonApiResponse(c, http.StatusOK, "", map[string]any{
			"route":  route,
			"report": report,
			"hours": map[string]any{
				"day":       day,
				"live":      store.ForRouteHours(region, routeID, day),
				"scheduled": tt.TripsByHour(routeID, nextDayOfType(now, day)),
			},
			"trend":  store.ForRouteTrend(region, routeID, now),
			"alerts": store.ForRouteAlerts(region, routeID),
			"map":    routeHeatMap(gtfsData, tt, store, region, routeID, now, stationOf, stops),
		})
	})

	group.GET("/league", func(c echo.Context) error {
		routes := getRouteCache()
		type row struct {
			reliability.LeagueRow
			ShortName string `json:"short_name"`
			Color     string `json:"color"`
		}
		out := []row{}
		for _, r := range store.League(region, time.Now().In(localTimeZone)) {
			route, ok := routes[r.RouteID]
			if !ok {
				continue
			}
			out = append(out, row{r, route.RouteShortName, route.RouteColor})
		}
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"routes": out, "days": 7})
	})
}

func dayTypeOf(t time.Time) string {
	switch t.Weekday() {
	case time.Saturday:
		return "sat"
	case time.Sunday:
		return "sun"
	}
	return "wd"
}

// nextDayOfType is today if it's of the type, else the next such day -
// whose timetable stands for the type.
func nextDayOfType(now time.Time, day string) time.Time {
	for i := 0; i < 7; i++ {
		d := now.AddDate(0, 0, i)
		if dayTypeOf(d) == day {
			return d
		}
	}
	return now
}

// heatStop is a stop on the route map, with how late the route usually is
// there.
type heatStop struct {
	Name       string  `json:"name"`
	Lat        float64 `json:"lat"`
	Lon        float64 `json:"lon"`
	TypicalMin *int    `json:"typical_min,omitempty"`
	Level      string  `json:"level,omitempty"`
}

// heatColor is a stretch's colour (the status palette): early, on time, a
// little late, late, very late - and grey where there's no data.
func heatColor(st *reliability.Stat) string {
	switch {
	case st == nil:
		return "#9ca3af"
	case st.TypicalMin <= -2:
		return "#2a78d6"
	case st.TypicalMin <= 1:
		return "#0ca30c"
	case st.TypicalMin <= 3:
		return "#fab219"
	case st.TypicalMin <= 5:
		return "#ec835a"
	default:
		return "#d03b3b"
	}
}

// routeHeatMap draws the route's longest trip, each stretch between stops
// coloured by how late the route usually is at the stop it leads to.
func routeHeatMap(gtfsData gtfs.Database, tt *timetable.Timetable, store *reliability.Store, region, routeID string, now time.Time, stationOf func(string) string, allStops map[string]gtfs.Stop) map[string]any {
	empty := map[string]any{"line": nil, "stops": []heatStop{}}
	trip, ok := tt.LongestTrip(routeID, now)
	if !ok {
		return empty
	}
	shape, err := gtfsData.GetShapeByTripID(trip)
	tripStops, _, sErr := gtfsData.GetStopsForTripID(trip)
	if err != nil || sErr != nil || len(shape.Coordinates) < 2 || len(tripStops) < 2 {
		return empty
	}
	byStation := store.ForRouteStops(region, routeID)

	stops := make([]heatStop, 0, len(tripStops))
	stats := make([]*reliability.Stat, 0, len(tripStops))
	for _, s := range tripStops {
		hs := heatStop{Name: s.StopName, Lat: s.StopLat, Lon: s.StopLon}
		if full, ok := allStops[s.StopId]; ok && hs.Name == "" {
			hs.Name = full.StopName
		}
		var stp *reliability.Stat
		if st, has := byStation[stationOf(s.StopId)]; has {
			stp = &st
			m := st.TypicalMin
			hs.TypicalMin, hs.Level = &m, st.Level
		}
		stops = append(stops, hs)
		stats = append(stats, stp)
	}

	// Each stop's nearest point along the shape, never going backwards.
	idx := make([]int, len(tripStops))
	from := 0
	for i, s := range tripStops {
		best, bestD := from, math.MaxFloat64
		for j := from; j < len(shape.Coordinates); j++ {
			p := shape.Coordinates[j]
			d := (p.Lat-s.StopLat)*(p.Lat-s.StopLat) + (p.Lon-s.StopLon)*(p.Lon-s.StopLon)
			if d < bestD {
				best, bestD = j, d
			}
		}
		idx[i], from = best, best
	}
	features := []map[string]any{}
	for i := 1; i < len(idx); i++ {
		a, b := idx[i-1], idx[i]
		if b <= a {
			continue
		}
		coords := make([][]float64, 0, b-a+1)
		for _, p := range shape.Coordinates[a : b+1] {
			coords = append(coords, []float64{p.Lon, p.Lat})
		}
		features = append(features, map[string]any{
			"type":       "Feature",
			"geometry":   map[string]any{"type": "LineString", "coordinates": coords},
			"properties": map[string]any{"color": heatColor(stats[i])},
		})
	}
	return map[string]any{
		"line":  map[string]any{"type": "FeatureCollection", "features": features},
		"stops": stops,
	}
}
