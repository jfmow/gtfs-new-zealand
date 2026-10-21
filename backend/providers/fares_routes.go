package providers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/providers/fares"
	"github.com/jfmow/gtfs"
	"github.com/labstack/echo/v5"
)

// maxFarePlans caps one /fares request (a results list is ~5 journeys).
const maxFarePlans = 10

// setupFaresRoutes serves fare estimates for planned journeys:
//
//	GET /fares?plans=<plan id>,...&concession=<fares.Concession>
//	    -> {"fares": {id: Estimate | null}}
//	GET /fares/types -> {"types": [Option]} - the fare types the region offers
//
// Plans are looked up by id in the plan store, where /services/plan put
// them.
func setupFaresRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, region, dbName string, localTimeZone *time.Location) {
	zones := &stopZones{path: filepath.Join(gtfs.GetWorkDir(), "gtfs", fmt.Sprintf("gtfs-%s.db", dbName))}
	trips := &tripStopsMemo{gtfsData: gtfsData, byTrip: map[string][]gtfs.Stop{}}
	calc := fares.For(region, fares.Deps{StopsOnTrip: trips.get, ZoneOf: zones.get, TZ: localTimeZone})

	primaryRoute.GET("/fares/types", func(c echo.Context) error {
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"types": fares.Options(region)})
	})

	primaryRoute.GET("/fares", func(c echo.Context) error {
		concession := fares.ParseConcession(c.QueryParam("concession"))
		out := map[string]*fares.Estimate{}
		ids := strings.Split(c.QueryParam("plans"), ",")
		if len(ids) > maxFarePlans {
			ids = ids[:maxFarePlans]
		}
		for _, id := range ids {
			if id == "" {
				continue
			}
			out[id] = nil
			if calc == nil {
				continue
			}
			if plan, ok := GetCachedPlan(id); ok {
				if e, ok := calc.Estimate(plan, concession); ok {
					out[id] = &e
				}
			}
		}
		return JsonApiResponse(c, http.StatusOK, "", map[string]any{"fares": out})
	})
}

// tripStopsMemo keeps trips' stop lists - a results list asks for the same
// trips repeatedly. Cleared wholesale when it grows large.
type tripStopsMemo struct {
	gtfsData gtfs.Database
	mu       sync.Mutex
	byTrip   map[string][]gtfs.Stop
}

func (m *tripStopsMemo) get(tripID string) []gtfs.Stop {
	m.mu.Lock()
	stops, ok := m.byTrip[tripID]
	m.mu.Unlock()
	if ok {
		return stops
	}
	stops, _, _ = m.gtfsData.GetStopsForTripID(tripID)
	m.mu.Lock()
	if len(m.byTrip) > 2000 {
		m.byTrip = map[string][]gtfs.Stop{}
	}
	m.byTrip[tripID] = stops
	m.mu.Unlock()
	return stops
}

// stopZones is stop_id -> zone_id, read straight from the region's GTFS
// database (the gtfs package doesn't expose zone_id). Loaded on first use
// and again a day later, after the nightly feed refresh.
type stopZones struct {
	path   string
	mu     sync.Mutex
	zones  map[string]string
	loaded time.Time
}

func (z *stopZones) get(stopID string) string {
	z.mu.Lock()
	defer z.mu.Unlock()
	if z.zones == nil || time.Since(z.loaded) > 24*time.Hour {
		if zones, err := loadStopZones(z.path); err == nil {
			z.zones = zones
		} else if z.zones == nil {
			log.Printf("fares: stop zones from %s: %v", z.path, err)
			z.zones = map[string]string{}
		}
		z.loaded = time.Now()
	}
	return z.zones[stopID]
}

func loadStopZones(path string) (map[string]string, error) {
	db, err := sql.Open("sqlite3", "file:"+path+"?mode=ro&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT stop_id, zone_id FROM stops WHERE zone_id <> ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, zone string
		if rows.Scan(&id, &zone) == nil {
			out[id] = zone
		}
	}
	return out, rows.Err()
}
