package reliability

import (
	"fmt"
	"log"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

/*
The recorder samples the region's trip-updates feed - the copy the realtime
client already holds, so no extra requests upstream - and notes, for each
running trip, the most recent stop it has actually been at: a stop-time
update whose time has passed is an observation, not a prediction. Feeds
differ (AT sends the last stop passed; others predict ahead and drop stops
once passed), so not every stop of every trip is caught, but over weeks the
sample is plenty.

It also counts trips that ran and trips cancelled, per route and band.
*/

const (
	recordEvery = 30 * time.Second
	// Service alerts are noted this often (they change slowly; the feed
	// copy is shared, so it costs no upstream requests).
	logAlertsEvery = 5 * time.Minute
	// An observation older than this when first seen is skipped - after a
	// restart or a stale feed it can't be placed reliably.
	maxObservationAge = 10 * time.Minute
	// Trip updates not refreshed for this long are stale.
	maxUpdateAge = 5 * time.Minute
	// A delay beyond this is treated as feed noise (a trip carried over
	// from the day before, a wrong service date).
	maxPlausibleDelay = 90 * time.Minute
)

// Lookups the recorder needs from the static GTFS - funcs so tests don't
// need a database.
type lookups struct {
	// routeForTrip is the trip's route id ("" if unknown).
	routeForTrip func(tripID string) string
	// stopAt is the stop id at a trip's raw stop sequence ("" if unknown).
	stopAt func(tripID string, seq uint32) string
	// station is the parent station of a stop, or the stop itself.
	station func(stopID string) string
}

// recorder keeps what it's counted so far today, so each trip's stops and
// the trip itself are only counted once.
type recorder struct {
	region string
	tz     *time.Location
	look   lookups

	day      string
	weighted map[string]bool   // local dates already counted in day_weights
	lastSeq  map[string]uint32 // trip id -> highest stop sequence recorded
	counted  map[string]bool   // trip id -> counted as run/cancelled
	routeMem map[string]string // trip id -> route id
}

func newRecorder(region string, tz *time.Location, look lookups) *recorder {
	return &recorder{region: region, tz: tz, look: look, weighted: map[string]bool{}}
}

func (r *recorder) resetIfNewDay(now time.Time) {
	day := now.In(r.tz).Format("20060102")
	if day == r.day {
		return
	}
	// Trips past midnight keep their entries until the next morning's reset
	// rather than being recounted - a reset at 4am, not midnight.
	if r.day != "" && now.In(r.tz).Hour() < 4 {
		return
	}
	r.day = day
	r.lastSeq = map[string]uint32{}
	r.counted = map[string]bool{}
	r.routeMem = map[string]string{}
	if len(r.weighted) > 7 {
		r.weighted = map[string]bool{}
	}
}

func (r *recorder) route(trip *proto.TripDescriptor) string {
	if id := trip.GetRouteId(); id != "" {
		return id
	}
	id, ok := r.routeMem[trip.GetTripId()]
	if !ok {
		id = r.look.routeForTrip(trip.GetTripId())
		r.routeMem[trip.GetTripId()] = id
	}
	return id
}

// observe works through one snapshot of the feed, returning what to add.
func (r *recorder) observe(updates realtime.TripUpdatesMap, now time.Time) *batch {
	r.resetIfNewDay(now)
	b := newBatch()
	day := func(route string, at time.Time) *dayAgg {
		local := at.In(r.tz)
		k := dayKey{r.region, route, local.Format("2006-01-02")}
		d := b.days[k]
		if d == nil {
			d = &dayAgg{}
			b.days[k] = d
		}
		// The first thing recorded on a date makes it a day of its type, so
		// route_hours' trip counts can be averaged per day.
		if !r.weighted[k.date] {
			r.weighted[k.date] = true
			b.weights[weightKey{r.region, dayTypeOf(local)}]++
		}
		return d
	}
	hour := func(route string, at time.Time) *hourAgg {
		local := at.In(r.tz)
		k := hourKey{r.region, route, dayTypeOf(local), local.Hour()}
		h := b.hours[k]
		if h == nil {
			h = &hourAgg{}
			b.hours[k] = h
		}
		return h
	}
	countTrip := func(trip *proto.TripDescriptor, route string, at time.Time, cancelled bool) {
		if route == "" || r.counted[trip.GetTripId()] {
			return
		}
		r.counted[trip.GetTripId()] = true
		k := routeKey{r.region, route, bandFor(at.In(r.tz))}
		a := b.routes[k]
		if a == nil {
			a = &routeAgg{}
			b.routes[k] = a
		}
		a.trips++
		d := day(route, at)
		d.trips++
		if cancelled {
			a.cancelled++
			d.cancelled++
		} else {
			hour(route, at).trips++
		}
	}

	for _, tu := range updates {
		trip := tu.GetTrip()
		if trip == nil || trip.GetTripId() == "" {
			continue
		}
		if ts := tu.GetTimestamp(); ts > 0 && now.Sub(time.Unix(int64(ts), 0)) > maxUpdateAge {
			continue
		}
		start, hasStart := tripStart(trip, r.tz)

		if trip.GetScheduleRelationship() == proto.TripDescriptor_CANCELED {
			// Counted once its start time is near, not when the day's
			// cancellations are first published - same trip either way.
			if hasStart && now.After(start.Add(-time.Hour)) {
				countTrip(trip, r.route(trip), start, true)
			}
			continue
		}
		if hasStart && start.After(now) {
			continue // not running yet (AT publishes updates for those too)
		}

		// The furthest-along stop the trip has already been at.
		var best *proto.TripUpdate_StopTimeUpdate
		var bestAt time.Time
		var bestDelay int
		for _, stu := range tu.GetStopTimeUpdate() {
			if stu.GetScheduleRelationship() != proto.TripUpdate_StopTimeUpdate_SCHEDULED {
				continue
			}
			ev := stu.GetDeparture()
			if ev.GetTime() == 0 || ev.Delay == nil {
				ev = stu.GetArrival()
			}
			if ev.GetTime() == 0 || ev.Delay == nil {
				continue
			}
			at := time.Unix(ev.GetTime(), 0)
			if at.After(now) || now.Sub(at) > maxObservationAge {
				continue
			}
			delay := int(ev.GetDelay())
			if time.Duration(abs(delay))*time.Second > maxPlausibleDelay {
				continue
			}
			if best == nil || stu.GetStopSequence() > best.GetStopSequence() {
				best, bestAt, bestDelay = stu, at, delay
			}
		}
		if best == nil {
			continue
		}
		seq := best.GetStopSequence()
		if last, ok := r.lastSeq[trip.GetTripId()]; ok && seq <= last {
			continue
		}
		r.lastSeq[trip.GetTripId()] = seq

		route := r.route(trip)
		stop := best.GetStopId()
		if stop == "" {
			stop = r.look.stopAt(trip.GetTripId(), seq)
		}
		if route == "" || stop == "" {
			continue
		}
		scheduled := bestAt.Add(-time.Duration(bestDelay) * time.Second)
		if !hasStart {
			start = scheduled
		}
		countTrip(trip, route, start, false)

		k := stopKey{r.region, route, r.look.station(stop), bandFor(scheduled.In(r.tz))}
		a := b.stops[k]
		if a == nil {
			a = &stopAgg{}
			b.stops[k] = a
		}
		a.add(bestDelay)
		hour(route, scheduled).add(bestDelay)
		day(route, scheduled).add(bestDelay)
	}
	return b
}

// dayTypeOf - "wd", "sat" or "sun".
func dayTypeOf(t time.Time) string {
	switch t.Weekday() {
	case time.Saturday:
		return "sat"
	case time.Sunday:
		return "sun"
	}
	return "wd"
}

// tripStart is the trip's scheduled start from its descriptor, counted from
// noon minus 12h like GTFS times (right on DST change days).
func tripStart(trip *proto.TripDescriptor, tz *time.Location) (time.Time, bool) {
	day, err := time.ParseInLocation("20060102", trip.GetStartDate(), tz)
	if err != nil {
		return time.Time{}, false
	}
	var h, m, s int
	if n, err := fmt.Sscanf(trip.GetStartTime(), "%d:%d:%d", &h, &m, &s); err != nil || n != 3 {
		return time.Time{}, false
	}
	dayStart := time.Date(day.Year(), day.Month(), day.Day(), 12, 0, 0, 0, tz).Add(-12 * time.Hour)
	return dayStart.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second), true
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Start runs the region's recorder in the background, writing to store. A
// nil store or a region without realtime does nothing.
func Start(store *Store, region string, rt realtime.Realtime, gtfsData gtfs.Database, tz *time.Location, stationOf func(stopID string) string) {
	if store == nil {
		return
	}
	stopsMemo := map[string][]gtfs.Stop{}
	look := lookups{
		routeForTrip: func(tripID string) string {
			routes, err := gtfsData.GetRouteByTripID(tripID)
			if err != nil {
				return ""
			}
			for id := range routes {
				return id
			}
			return ""
		},
		stopAt: func(tripID string, seq uint32) string {
			stops, ok := stopsMemo[tripID]
			if !ok {
				stops, _, _ = gtfsData.GetStopsForTripID(tripID)
				if len(stopsMemo) > 5000 {
					stopsMemo = map[string][]gtfs.Stop{}
				}
				stopsMemo[tripID] = stops
			}
			for _, s := range stops {
				if s.Sequence == int(seq) {
					return s.StopId
				}
			}
			return ""
		},
		station: stationOf,
	}
	rec := newRecorder(region, tz, look)

	go func() {
		defer func() {
			if p := recover(); p != nil {
				log.Printf("reliability: %s recorder stopped: %v", region, p)
			}
		}()
		tick := time.NewTicker(recordEvery)
		defer tick.Stop()
		var lastAlerts time.Time
		for now := range tick.C {
			if err := store.decay(now); err != nil {
				log.Printf("reliability: decay: %v", err)
			}
			if now.Sub(lastAlerts) >= logAlertsEvery {
				lastAlerts = now
				if alerts, err := rt.GetAlerts(); err == nil {
					if err := store.logAlerts(region, alerts, now, look.routeForTrip); err != nil {
						log.Printf("reliability: %s alerts: %v", region, err)
					}
				}
			}
			updates, err := rt.GetTripUpdates()
			if err != nil || len(updates) == 0 {
				continue
			}
			if err := store.flush(rec.observe(updates, now)); err != nil {
				log.Printf("reliability: %s flush: %v", region, err)
			}
		}
	}()
}
