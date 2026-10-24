// Package timetable answers timetable questions the gtfs package doesn't:
// how often a route runs through the day, and the gap between its services
// at a stop. It reads the region's GTFS SQLite file directly, read-only.
package timetable

import (
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Timetable is one region's static timetable. Methods tolerate a nil
// Timetable (no answers).
type Timetable struct {
	db *sql.DB
	tz *time.Location

	mu       sync.Mutex
	services map[string][]string // service date -> active service ids
}

// Open opens the GTFS database at path read-only.
func Open(path string, tz *time.Location) (*Timetable, error) {
	db, err := sql.Open("sqlite3", "file:"+path+"?mode=ro&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return &Timetable{db: db, tz: tz, services: map[string][]string{}}, nil
}

// serviceDay is the date a time falls on, timetable-wise, and the moment
// GTFS times on it count from (noon minus 12h - right on DST days).
func (t *Timetable) serviceDay(at time.Time) (date string, origin time.Time) {
	local := at.In(t.tz)
	origin = time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, t.tz).Add(-12 * time.Hour)
	return local.Format("20060102"), origin
}

// activeServices is the service ids running on date ("20060102") - its
// weekday in calendar, give or take calendar_dates.
func (t *Timetable) activeServices(date string) []string {
	t.mu.Lock()
	if s, ok := t.services[date]; ok {
		t.mu.Unlock()
		return s
	}
	t.mu.Unlock()

	day, err := time.ParseInLocation("20060102", date, t.tz)
	if err != nil {
		return nil
	}
	weekday := strings.ToLower(day.Weekday().String())
	active := map[string]bool{}
	if rows, err := t.db.Query(`SELECT service_id FROM calendar WHERE `+weekday+` = 1 AND start_date <= ? AND end_date >= ?`, date, date); err == nil {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				active[id] = true
			}
		}
		rows.Close()
	}
	if rows, err := t.db.Query(`SELECT service_id, exception_type FROM calendar_dates WHERE date = ?`, date); err == nil {
		for rows.Next() {
			var id string
			var kind int
			if rows.Scan(&id, &kind) == nil {
				active[id] = kind == 1
			}
		}
		rows.Close()
	}
	out := make([]string, 0, len(active))
	for id, on := range active {
		if on {
			out = append(out, id)
		}
	}
	t.mu.Lock()
	if len(t.services) > 14 {
		t.services = map[string][]string{}
	}
	t.services[date] = out
	t.mu.Unlock()
	return out
}

// inList - "?, ?, ?" and the args for an IN (...).
func inList(values []string) (string, []any) {
	args := make([]any, len(values))
	for i, v := range values {
		args[i] = v
	}
	return strings.TrimSuffix(strings.Repeat("?, ", len(values)), ", "), args
}

// clock - seconds into the service day -> "HH:MM:SS" (hours can pass 24).
func clock(sec int) string {
	return fmt.Sprintf("%02d:%02d:%02d", sec/3600, sec/60%60, sec%60)
}

// seconds parses "HH:MM:SS" (hours can pass 24).
func seconds(hms string) (int, bool) {
	var h, m, s int
	if n, err := fmt.Sscanf(hms, "%d:%d:%d", &h, &m, &s); err != nil || n != 3 {
		return 0, false
	}
	return h*3600 + m*60 + s, true
}

// TripsByHour is how many of route's trips start in each hour of the
// service day at's date falls on (index 24+ for trips after midnight).
func (t *Timetable) TripsByHour(route string, at time.Time) []int {
	out := make([]int, 24)
	if t == nil {
		return out
	}
	date, _ := t.serviceDay(at)
	services := t.activeServices(date)
	if len(services) == 0 {
		return out
	}
	marks, args := inList(services)
	rows, err := t.db.Query(`SELECT MIN(st.departure_time) FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
		WHERE t.route_id = ? AND t.service_id IN (`+marks+`) GROUP BY t.trip_id`, append([]any{route}, args...)...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var dep string
		if rows.Scan(&dep) != nil {
			continue
		}
		if sec, ok := seconds(dep); ok {
			h := sec / 3600
			for h >= len(out) {
				out = append(out, 0)
			}
			out[h]++
		}
	}
	return out
}

// Headway is the timetable's average gap between route's services at a
// station (any of its platforms) in the hour either side of at - false if
// fewer than two run.
func (t *Timetable) Headway(route, station string, at time.Time) (time.Duration, bool) {
	if t == nil {
		return 0, false
	}
	date, origin := t.serviceDay(at)
	services := t.activeServices(date)
	if len(services) == 0 {
		return 0, false
	}
	now := int(at.Sub(origin).Seconds())
	marks, args := inList(services)
	q := append([]any{route, station, station, clock(max(0, now-3600)), clock(now + 3600)}, args...)
	var n int
	err := t.db.QueryRow(`SELECT COUNT(*) FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
		WHERE t.route_id = ? AND st.stop_id IN (SELECT stop_id FROM stops WHERE stop_id = ? OR parent_station = ?)
		  AND st.departure_time BETWEEN ? AND ? AND t.service_id IN (`+marks+`)`, q...).Scan(&n)
	if err != nil || n < 2 {
		return 0, false
	}
	return time.Duration(float64(2*time.Hour) / float64(n)), true
}

// LongestTrip is the route's trip with the most stops on at's service day
// (any day if none run then) - the one to draw the route with.
func (t *Timetable) LongestTrip(route string, at time.Time) (string, bool) {
	if t == nil {
		return "", false
	}
	date, _ := t.serviceDay(at)
	services := t.activeServices(date)
	var trip string
	if len(services) > 0 {
		marks, args := inList(services)
		_ = t.db.QueryRow(`SELECT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
			WHERE t.route_id = ? AND t.service_id IN (`+marks+`) GROUP BY t.trip_id ORDER BY COUNT(*) DESC LIMIT 1`,
			append([]any{route}, args...)...).Scan(&trip)
	}
	if trip == "" {
		_ = t.db.QueryRow(`SELECT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
			WHERE t.route_id = ? GROUP BY t.trip_id ORDER BY COUNT(*) DESC LIMIT 1`, route).Scan(&trip)
	}
	return trip, trip != ""
}
