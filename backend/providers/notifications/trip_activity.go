package notifications

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/at-trains-api/providers/vehiclestate"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// TripLiveActivity is one running trip Live Activity - a single vehicle
// counted down to the rider's stop, started from the trip tracker when they
// set a reminder (get on / get off / arriving). The client-side contract is
// `TripActivityAttributes` (mobile/modules/transit-native/ios and
// mobile/targets/widgets). Like journey activities, it's pushed with its
// own token and environment.
type TripLiveActivity struct {
	Id         int
	ClientId   int
	Region     string
	TripId     string
	StopId     string
	StopSeq    int // the trip's stop_sequence at the rider's stop; 0 = match by StopId
	Scheduled  int64
	Kind       string // get_off | arrival
	ActivityId string
	PushToken  string
	ApnsEnv    string
	LastHash   string
	LastPushed int64
	// ClientReported: the app last wrote the activity itself (Unix s).
	ClientReported int64
	Created        int64
}

const tripActivitiesSchema = `CREATE TABLE IF NOT EXISTS trip_live_activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER NOT NULL,
            region TEXT NOT NULL,
            trip_id TEXT NOT NULL,
            stop_id TEXT NOT NULL,
            stop_sequence INTEGER NOT NULL DEFAULT 0,
            scheduled_unix INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'arrival',
            activity_id TEXT NOT NULL,
            push_token TEXT NOT NULL DEFAULT '',
            apns_env TEXT NOT NULL DEFAULT '',
            last_state_hash TEXT NOT NULL DEFAULT '',
            last_pushed INTEGER NOT NULL DEFAULT 0,
            client_reported INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL,
            UNIQUE(clientId, activity_id),
            FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
        );`

// tripActivityStateVersion is bumped when the content-state shape changes.
const tripActivityStateVersion = 1

// tripActivityState mirrors `TripActivityAttributes.ContentState` field for
// field. The copy ("Get off at", "Arriving") is the widget's, from the
// activity's static attributes - this is only the live picture.
type tripActivityState struct {
	Version int `json:"version"`
	// coming (on its way) | next (your stop is its next stop) | gone (it's
	// been and gone) | cancelled
	Phase string `json:"phase"`
	// TargetUnix: when it's due at your stop - the timetable plus the
	// feed's delay there.
	TargetUnix   float64 `json:"targetUnix"`
	DelayMinutes int     `json:"delayMinutes"`
	// StopsAway: stops before yours (0 = yours is next). Only with a placed
	// vehicle - AT publishes trip updates for trips that haven't started.
	StopsAway    *int   `json:"stopsAway,omitempty"`
	NextStopName string `json:"nextStopName,omitempty"`
	HasVehicle   bool   `json:"hasVehicle"`
	IsRealtime   bool   `json:"isRealtime"`
	Skipped      bool   `json:"skipped"`
	Occupancy    *int   `json:"occupancy,omitempty"`
	UpdatedUnix  float64 `json:"updatedUnix"`
}

func (s tripActivityState) hash() string {
	s.UpdatedUnix = 0
	// The countdown moving by under 30 s isn't worth a push.
	s.TargetUnix = float64(int64(s.TargetUnix) / 30)
	b, _ := json.Marshal(s)
	sum := sha1.Sum(b)
	return hex.EncodeToString(sum[:8])
}

// ─── storage ───

func (d *Database) CreateTripLiveActivity(a TripLiveActivity) error {
	now := time.Now().Unix()
	// One trip activity per device: the app ends the old one when it starts
	// another, but a missed /end shouldn't leave the server pushing to it.
	if _, err := d.execContext(`DELETE FROM trip_live_activities WHERE clientId = ? AND activity_id != ?`, a.ClientId, a.ActivityId); err != nil {
		return err
	}
	_, err := d.execContext(
		`INSERT INTO trip_live_activities (clientId, region, trip_id, stop_id, stop_sequence, scheduled_unix, kind, activity_id, push_token, apns_env, created, client_reported)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(clientId, activity_id) DO UPDATE SET
            trip_id = excluded.trip_id, stop_id = excluded.stop_id, stop_sequence = excluded.stop_sequence,
            scheduled_unix = excluded.scheduled_unix, kind = excluded.kind, region = excluded.region,
            push_token = CASE WHEN excluded.push_token != '' THEN excluded.push_token ELSE trip_live_activities.push_token END,
            apns_env = CASE WHEN excluded.apns_env != '' THEN excluded.apns_env ELSE trip_live_activities.apns_env END,
            client_reported = excluded.client_reported, last_state_hash = ''`,
		a.ClientId, a.Region, a.TripId, a.StopId, a.StopSeq, a.Scheduled, a.Kind, a.ActivityId, a.PushToken, a.ApnsEnv, now, now,
	)
	return err
}

func (d *Database) ReportTripLiveActivity(clientId int, activityId string) error {
	_, err := d.execContext(`UPDATE trip_live_activities SET client_reported = ? WHERE clientId = ? AND activity_id = ?`, time.Now().Unix(), clientId, activityId)
	return err
}

func (d *Database) DeleteTripLiveActivity(clientId int, activityId string) error {
	_, err := d.execContext(`DELETE FROM trip_live_activities WHERE clientId = ? AND activity_id = ?`, clientId, activityId)
	return err
}

func (d *Database) recordTripActivityPush(id int, hash string, now time.Time) {
	d.execContext(`UPDATE trip_live_activities SET last_state_hash = ?, last_pushed = ? WHERE id = ?`, hash, now.Unix(), id)
}

const tripActivityColumns = `ta.id, ta.clientId, ta.region, ta.trip_id, ta.stop_id, ta.stop_sequence, ta.scheduled_unix, ta.kind,
        ta.activity_id, ta.push_token, COALESCE(NULLIF(ta.apns_env, ''), NULLIF(n.apns_env, ''), 'production'),
        ta.last_state_hash, ta.last_pushed, ta.client_reported, ta.created`

func scanTripActivity(row rowScanner) (TripLiveActivity, error) {
	var a TripLiveActivity
	err := row.Scan(&a.Id, &a.ClientId, &a.Region, &a.TripId, &a.StopId, &a.StopSeq, &a.Scheduled, &a.Kind,
		&a.ActivityId, &a.PushToken, &a.ApnsEnv, &a.LastHash, &a.LastPushed, &a.ClientReported, &a.Created)
	return a, err
}

// TripLiveActivitiesForRegion returns every trip Live Activity in one region.
func (d *Database) TripLiveActivitiesForRegion(region string) ([]TripLiveActivity, error) {
	if d == nil || d.db == nil {
		return nil, nil
	}
	rows, cancel, err := d.queryContext(`SELECT `+tripActivityColumns+`
        FROM trip_live_activities ta JOIN notifications n ON n.id = ta.clientId
        WHERE ta.region = ?`, region)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	var out []TripLiveActivity
	for rows.Next() {
		if a, err := scanTripActivity(rows); err == nil {
			out = append(out, a)
		}
	}
	return out, rows.Err()
}

// TripLiveActivityFor is the device's activity for this trip, if it has one.
func (d *Database) TripLiveActivityFor(clientId int, tripId string) (TripLiveActivity, bool) {
	if d == nil || d.db == nil {
		return TripLiveActivity{}, false
	}
	row, cancel := d.queryRowContext(`SELECT `+tripActivityColumns+`
        FROM trip_live_activities ta JOIN notifications n ON n.id = ta.clientId
        WHERE ta.clientId = ? AND ta.trip_id = ? ORDER BY ta.created DESC LIMIT 1`, clientId, tripId)
	defer cancel()
	a, err := scanTripActivity(row)
	return a, err == nil
}

// ─── state ───

// tripActivityLookup answers "where's this trip relative to the rider's
// stop" from one tick's trip updates and vehicle positions.
type tripActivityLookup func(a TripLiveActivity, now time.Time) tripActivityState

func newTripActivityLookup(rt realtime.Realtime, stopsForTripCache caches.StopsForTripCache, parentStopsCache caches.ParentStopsByChildCache, tz *time.Location) tripActivityLookup {
	updates, _ := rt.GetTripUpdates()
	vehicles, _ := rt.GetVehicles()
	var tripStops map[string]caches.StopsForTripId
	if stopsForTripCache != nil {
		tripStops = stopsForTripCache()
	}
	var parentStops map[string]gtfs.Stop
	if parentStopsCache != nil {
		parentStops = parentStopsCache()
	}
	return func(a TripLiveActivity, now time.Time) tripActivityState {
		var tu *proto.TripUpdate
		if updates != nil {
			tu, _ = updates.ByTripID(a.TripId)
		}
		var vehicle *proto.VehiclePosition
		if vehicles != nil {
			vehicle, _ = vehicles.ByTripID(a.TripId)
		}
		stopsData, haveStops := tripStops[a.TripId]
		var stops []gtfs.Stop
		if haveStops {
			stops = append(stops, stopsData.Stops...)
			sort.Slice(stops, func(i, j int) bool { return stops[i].Sequence < stops[j].Sequence })
		}
		return computeTripActivityState(a, now, tu, vehicle, stops, stopsData.LowestSequence, parentStops, tz)
	}
}

// targetIndex is the rider's stop in `stops` (sorted by sequence) - by the
// trip's own stop_sequence when known (a loop visits a stop twice), else the
// stop id or any platform of its station.
func targetIndex(stops []gtfs.Stop, a TripLiveActivity) int {
	if a.StopSeq > 0 {
		for i, s := range stops {
			if s.Sequence == a.StopSeq {
				return i
			}
		}
	}
	for i, s := range stops {
		if s.StopId == a.StopId || (s.ParentStation != "" && s.ParentStation == a.StopId) {
			return i
		}
	}
	return -1
}

func computeTripActivityState(a TripLiveActivity, now time.Time, tu *proto.TripUpdate, vehicle *proto.VehiclePosition, stops []gtfs.Stop, lowestSeq int, parentStops map[string]gtfs.Stop, tz *time.Location) tripActivityState {
	state := tripActivityState{
		Version:     tripActivityStateVersion,
		Phase:       "coming",
		TargetUnix:  float64(a.Scheduled),
		UpdatedUnix: float64(now.Unix()),
	}
	if tu == nil {
		return state
	}
	state.IsRealtime = true
	if tu.GetTrip().GetScheduleRelationship() == proto.TripDescriptor_CANCELED {
		state.Phase = "cancelled"
		return state
	}
	idx := targetIndex(stops, a)
	seq := a.StopSeq
	if idx >= 0 {
		seq = stops[idx].Sequence
	}
	delay, skipped := boardStopDelay(tu, seq, a.StopId)
	state.Skipped = skipped

	placed := false
	if vehicle != nil && idx >= 0 {
		lat, lon := float64(vehicle.GetPosition().GetLatitude()), float64(vehicle.GetPosition().GetLongitude())
		nextIdx, _, vState := vehiclestate.GetNextStopSequence(tu.GetStopTimeUpdate(), lowestSeq, tz, stops, lat, lon, vehicle)
		if vState != "Unknown" && nextIdx >= 0 {
			placed = true
			away := idx - nextIdx
			state.StopsAway = &away
			if nextIdx < len(stops) {
				state.NextStopName = stopDisplayName(stops[nextIdx], parentStops)
			}
			if vehicle.OccupancyStatus != nil {
				occ := int(vehicle.GetOccupancyStatus())
				state.Occupancy = &occ
			}
			switch {
			case away < 0:
				state.Phase = "gone"
			case away == 0:
				state.Phase = "next"
			}
		}
	}
	state.HasVehicle = placed
	beforeStart := false
	if start, ok := tripStartTime(tu.GetTrip(), tz); ok {
		beforeStart = now.Before(start)
	}
	if !placed || beforeStart {
		// Not running yet: an early prediction is the previous trip's.
		delay = clampJRDelay(delay)
	}
	state.DelayMinutes = delayMinutes(delay, true)
	if a.Scheduled > 0 {
		state.TargetUnix = float64(a.Scheduled + int64(delay))
	}
	return state
}

// ─── cron ───

// tripActivityMaxAge: an activity this old is ended whatever the feed says
// (iOS ends them at 8 h anyway).
const tripActivityMaxAge = 4 * time.Hour

// tripActivityGoneGrace: with no vehicle to say it's been, the activity
// ends this long after the vehicle was due.
const tripActivityGoneGrace = 10 * time.Minute

// tripActivityDone says whether a trip activity has run its course.
func tripActivityDone(a TripLiveActivity, s tripActivityState, now time.Time) bool {
	if s.Phase == "gone" {
		return true
	}
	if now.Sub(time.Unix(a.Created, 0)) > tripActivityMaxAge {
		return true
	}
	if s.TargetUnix > 0 && !s.HasVehicle && now.After(time.Unix(int64(s.TargetUnix), 0).Add(tripActivityGoneGrace)) {
		return true
	}
	return s.Phase == "cancelled" && s.TargetUnix > 0 && now.After(time.Unix(int64(s.TargetUnix), 0))
}

// runTripActivitiesCron keeps trip Live Activities current while the app
// isn't - pushing when what the rider would see changes (or the heartbeat
// is due), and ending them once the vehicle has been to their stop.
func runTripActivitiesCron(db *Database, region string, lookup tripActivityLookup, now time.Time) {
	if db == nil {
		return
	}
	apns := sharedAPNsSender()
	if apns == nil {
		return
	}
	activities, err := db.TripLiveActivitiesForRegion(region)
	if err != nil || len(activities) == 0 {
		return
	}
	for _, a := range activities {
		if a.PushToken == "" {
			continue
		}
		state := lookup(a, now)
		if tripActivityDone(a, state, now) {
			if state.Phase != "cancelled" {
				state.Phase = "gone"
			}
			dismissal := now.Add(2 * time.Minute)
			if err := apns.SendLiveActivityUpdate(a.PushToken, a.ApnsEnv, state, nil, nil, &dismissal); err != nil {
				log.Printf("notifications: trip activity %d end push: %v", a.Id, err)
			}
			db.DeleteTripLiveActivity(a.ClientId, a.ActivityId)
			continue
		}
		// The app is writing it itself - two writers made counts flicker.
		if now.Sub(time.Unix(a.ClientReported, 0)) < clientActiveWindow {
			continue
		}
		hash := state.hash()
		if hash == a.LastHash && now.Sub(time.Unix(a.LastPushed, 0)) < activityHeartbeat {
			continue
		}
		stale := now.Add(activityStaleAfter)
		if err := apns.SendLiveActivityUpdate(a.PushToken, a.ApnsEnv, state, nil, &stale, nil); err != nil {
			log.Printf("notifications: trip activity %d push: %v", a.Id, err)
			if errors.Is(err, errLiveActivityBadToken) {
				db.DeleteTripLiveActivity(a.ClientId, a.ActivityId)
			}
			continue
		}
		db.recordTripActivityPush(a.Id, hash, now)
	}
}

// alertTripActivity sends a trip reminder as the device's trip Live
// Activity's own alert (the Dynamic Island expands) - false when there's no
// activity for the trip or the push failed, so the caller sends a banner.
func alertTripActivity(db *Database, clientId int, tripId string, lookup tripActivityLookup, title, body string, now time.Time) bool {
	a, ok := db.TripLiveActivityFor(clientId, tripId)
	if !ok || a.PushToken == "" {
		return false
	}
	apns := sharedAPNsSender()
	if apns == nil {
		return false
	}
	state := lookup(a, now)
	stale := now.Add(activityStaleAfter)
	if err := apns.SendLiveActivityUpdate(a.PushToken, a.ApnsEnv, state, &activityAlert{Title: title, Body: body}, &stale, nil); err != nil {
		log.Printf("notifications: trip activity %d alert: %v", a.Id, err)
		return false
	}
	db.recordTripActivityPush(a.Id, state.hash(), now)
	return true
}
