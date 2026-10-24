package reliability

import (
	"sort"
	"strings"
	"time"

	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// logAlerts notes the alerts in force now: new ones get a row, ones already
// logged have their last-seen time moved on. Each row lists the routes it
// names - directly, or through a trip.
func (s *Store) logAlerts(region string, alerts realtime.AlertMap, now time.Time, routeForTrip func(string) string) error {
	if s == nil || len(alerts) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO alert_log (region, alert_id, first_seen, last_seen, header, effect, cause, routes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (region, alert_id) DO UPDATE SET last_seen = excluded.last_seen,
			header = excluded.header, routes = excluded.routes`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for id, a := range alerts {
		if a == nil || !alertActive(a, now) {
			continue
		}
		routes := alertRoutes(a, routeForTrip)
		if len(routes) == 0 {
			continue
		}
		header := ""
		if t := a.GetHeaderText().GetTranslation(); len(t) > 0 {
			header = t[0].GetText()
		}
		if _, err := stmt.Exec(region, id, now.Unix(), now.Unix(), header,
			a.GetEffect().String(), a.GetCause().String(), strings.Join(routes, ",")); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// alertActive: one of a's periods covers now, or it has none.
func alertActive(a *proto.Alert, now time.Time) bool {
	periods := a.GetActivePeriod()
	if len(periods) == 0 {
		return true
	}
	for _, p := range periods {
		start, end := int64(p.GetStart()), int64(p.GetEnd())
		if (start == 0 || start <= now.Unix()) && (end == 0 || end >= now.Unix()) {
			return true
		}
	}
	return false
}

func alertRoutes(a *proto.Alert, routeForTrip func(string) string) []string {
	seen := map[string]bool{}
	for _, e := range a.GetInformedEntity() {
		route := e.GetRouteId()
		if route == "" && e.GetTrip().GetTripId() != "" && routeForTrip != nil {
			route = routeForTrip(e.GetTrip().GetTripId())
		}
		if route != "" {
			seen[route] = true
		}
	}
	out := make([]string, 0, len(seen))
	for r := range seen {
		out = append(out, r)
	}
	sort.Strings(out)
	return out
}
