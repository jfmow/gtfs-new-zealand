package notifications

import (
	"log"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/at-trains-api/providers/vehiclestate"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// LiveActivity is one running journey-progress Live Activity
// (`ios/Shared/JourneyActivityAttributes.swift` is the client-side contract
// this feeds). It's pushed to with its *own* push token and environment -
// not the owning device's alert token, which may legitimately be empty
// (alerts denied) without affecting Live Activities at all.
type LiveActivity struct {
	Id            int
	ClientId      int
	Region        string
	PlanId        string
	ActivityId    string
	PushToken     string
	ApnsEnv       string
	LegHint       int
	PhaseHint     string
	LastStateHash string
	AlertedKeys   []string
	LastPushed    int64
	// ClientReported is when the app last reported its leg - it's running
	// and updating the activity itself then (see clientActiveWindow).
	ClientReported int64
}

// CreateLiveActivity registers a newly-started activity, or updates one
// already registered under the same (clientId, activityId) - a client
// re-POSTing after a token rotation before `UpdateLiveActivityToken` is
// reached shouldn't create a duplicate row.
func (d *Database) CreateLiveActivity(clientId int, region, planId, activityId, pushToken, apnsEnv string) error {
	now := time.Now().Unix()
	_, err := d.execContext(
		`INSERT INTO live_activities (clientId, region, plan_id, activity_id, push_token, apns_env, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(clientId, activity_id) DO UPDATE SET
            push_token = excluded.push_token,
            plan_id = excluded.plan_id,
            region = excluded.region,
            apns_env = CASE WHEN excluded.apns_env != '' THEN excluded.apns_env ELSE live_activities.apns_env END,
            updated = excluded.updated`,
		clientId, region, planId, activityId, pushToken, apnsEnv, now, now,
	)
	return err
}

func (d *Database) UpdateLiveActivityToken(clientId int, activityId, pushToken string) error {
	_, err := d.execContext(
		`UPDATE live_activities SET push_token = ?, updated = ? WHERE clientId = ? AND activity_id = ?`,
		pushToken, time.Now().Unix(), clientId, activityId,
	)
	return err
}

func (d *Database) UpdateLiveActivityLeg(clientId int, activityId string, legIndex int, phase string) error {
	_, err := d.execContext(
		`UPDATE live_activities SET leg_hint = ?, phase_hint = ?, updated = ?, client_reported = ? WHERE clientId = ? AND activity_id = ?`,
		legIndex, phase, time.Now().Unix(), time.Now().Unix(), clientId, activityId,
	)
	return err
}

func (d *Database) DeleteLiveActivity(clientId int, activityId string) error {
	_, err := d.execContext(`DELETE FROM live_activities WHERE clientId = ? AND activity_id = ?`, clientId, activityId)
	return err
}

// HasLiveActivityForPlan reports whether this client already has an
// activity running for the plan - push-to-start skips starting a second one.
func (d *Database) HasLiveActivityForPlan(clientId int, planId string) bool {
	row, cancel := d.queryRowContext(`SELECT 1 FROM live_activities WHERE clientId = ? AND plan_id = ?`, clientId, planId)
	defer cancel()
	var one int
	return row.Scan(&one) == nil
}

func (d *Database) recordLiveActivityPush(id int, hash string, alertedKeys []string, now time.Time) error {
	_, err := d.execContext(
		`UPDATE live_activities SET last_state_hash = ?, alerted_keys = ?, last_pushed = ?, updated = ? WHERE id = ?`,
		hash, strings.Join(alertedKeys, ","), now.Unix(), now.Unix(), id,
	)
	return err
}

// GetActiveLiveActivitiesForRegion returns every Live Activity registered
// for one region. The activity's environment falls back to its device's
// (rows created before apns_env existed on live_activities), then to
// production.
func (d *Database) GetActiveLiveActivitiesForRegion(region string) ([]LiveActivity, error) {
	if d == nil || d.db == nil {
		return nil, nil
	}
	rows, err := d.db.Query(`
        SELECT la.id, la.clientId, la.region, la.plan_id, la.activity_id, la.push_token,
               COALESCE(NULLIF(la.apns_env, ''), NULLIF(n.apns_env, ''), 'production'),
               la.leg_hint, la.phase_hint, la.last_state_hash, la.alerted_keys, la.last_pushed, la.client_reported
        FROM live_activities la
        JOIN notifications n ON n.id = la.clientId
        WHERE la.region = ?`, region)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveActivity
	for rows.Next() {
		var a LiveActivity
		var alerted string
		if err := rows.Scan(&a.Id, &a.ClientId, &a.Region, &a.PlanId, &a.ActivityId, &a.PushToken,
			&a.ApnsEnv, &a.LegHint, &a.PhaseHint, &a.LastStateHash, &alerted, &a.LastPushed, &a.ClientReported); err != nil {
			continue
		}
		if alerted != "" {
			a.AlertedKeys = strings.Split(alerted, ",")
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// endGraceAfterArrival is how long a Live Activity is left running (with a
// final "arrived" state) after its plan's arrival time before this cron
// sends the closing push and deletes the row.
const endGraceAfterArrival = 90 * time.Second

// activityHeartbeat re-sends an unchanged state this often, so the widget's
// stale-date (activityStaleAfter) never lapses while the journey is still
// being tracked.
const (
	activityHeartbeat  = 4 * time.Minute
	activityStaleAfter = 6 * time.Minute
)

// clientActiveWindow: while the app has reported in this recently, it's
// running and updating the activity itself (every ~10s, from its own poll),
// so this cron leaves the content alone - two writers working from
// different snapshots of the feed made the stop count flick back and forth
// (2026-09-24). The app reports at least every 30s while it's doing that.
// Key-moment banners still go out, since the app only shows those in-app.
const clientActiveWindow = 75 * time.Second

// runLiveActivitiesCron is one tick of the Live Activity progress pusher -
// the background path for when the app isn't running to update ActivityKit
// itself. Loads each activity's plan from the shared plan store, overlays
// realtime for its transit legs, and pushes when what the rider would see
// has changed (or the heartbeat is due) - with a sound/banner alert only for
// the one-off moments in journeyActivityState.alert.
func runLiveActivitiesCron(db *Database, region string, planLookup func(id string) (gtfs.JourneyPlan, bool), rt realtime.Realtime, stopsForTripCache caches.StopsForTripCache, parentStopsCache caches.ParentStopsByChildCache, tz *time.Location, now time.Time) {
	if db == nil {
		return
	}
	apns := sharedAPNsSender()
	if apns == nil {
		return // APNs not configured - nothing to push with.
	}

	activities, err := db.GetActiveLiveActivitiesForRegion(region)
	if err != nil || len(activities) == 0 {
		return
	}

	live := newLiveLegLookup(rt, stopsForTripCache, parentStopsCache, tz)

	for _, activity := range activities {
		if activity.PushToken == "" {
			continue
		}

		plan, found := planLookup(activity.PlanId)
		if !found {
			// The plan aged out of the store - nothing left to compute
			// progress from, so end it rather than leave it stale.
			endLiveActivity(apns, db, activity, journeyActivityState{Version: activityStateVersion, Phase: "arrived", Status: "arrived", PrimaryText: "Journey ended"}, now)
			continue
		}

		hint := activityHint{LegIndex: activity.LegHint, Phase: activity.PhaseHint}
		state := computeJourneyActivityState(plan, now, live, hint)

		if state.Phase == "arrived" && now.After(time.Unix(int64(state.ArrivalUnix), 0).Add(endGraceAfterArrival)) {
			endLiveActivity(apns, db, activity, state, now)
			continue
		}

		var alert *activityAlert
		if state.alert != nil && !containsString(activity.AlertedKeys, state.alert.Key) {
			a := *state.alert
			alert = &a
		}

		if now.Sub(time.Unix(activity.ClientReported, 0)) < clientActiveWindow {
			if alert != nil && sendJourneyMomentNotification(db, activity, *alert) {
				// Leave the state hash alone, so the content is pushed as
				// soon as the app stops updating it.
				db.recordLiveActivityPush(activity.Id, activity.LastStateHash, append(activity.AlertedKeys, alert.Key), time.Unix(activity.LastPushed, 0))
			}
			continue
		}

		hash := state.stateHash()
		heartbeatDue := now.Sub(time.Unix(activity.LastPushed, 0)) >= activityHeartbeat
		if hash == activity.LastStateHash && alert == nil && !heartbeatDue {
			continue
		}

		// Key moments (time to leave, get on, get off...) also go out as a
		// regular time-sensitive notification: a banner plus sound/vibration
		// even when the Live Activity isn't on screen. The Live Activity
		// alert then only expands the activity, silently.
		bannerSent := false
		if alert != nil {
			bannerSent = sendJourneyMomentNotification(db, activity, *alert)
			alert.Sound = !bannerSent
		}

		stale := now.Add(activityStaleAfter)
		alerted := activity.AlertedKeys
		if alert != nil {
			alerted = append(alerted, alert.Key)
		}
		if err := apns.SendLiveActivityUpdate(activity.PushToken, activity.ApnsEnv, state, alert, &stale, nil); err != nil {
			log.Printf("notifications: live activity %d push: %v", activity.Id, err)
			if bannerSent {
				// Don't send the same banner again next tick; the state
				// itself (old hash) is retried.
				db.recordLiveActivityPush(activity.Id, activity.LastStateHash, alerted, time.Unix(activity.LastPushed, 0))
			}
			continue
		}
		db.recordLiveActivityPush(activity.Id, hash, alerted, now)
	}
}

// sendJourneyMomentNotification sends a journey's key-moment alert as a
// regular push to the device that owns the activity. False if the device
// has no alert token (notifications denied) or the send failed.
func sendJourneyMomentNotification(db *Database, activity LiveActivity, alert activityAlert) bool {
	client, err := db.getClientByID(activity.ClientId)
	if err != nil || client.ApnsToken == "" {
		return false
	}
	err = sharedNotifier().Send(*client, Payload{
		Title:   alert.Title,
		Body:    alert.Body,
		URL:     "/journey?id=" + url.QueryEscape(activity.PlanId) + "&region=" + url.QueryEscape(activity.Region) + "&track=1",
		Urgency: "high",
		Kind:    "journey",
	})
	if err != nil {
		log.Printf("notifications: journey moment push for activity %d: %v", activity.Id, err)
		return false
	}
	return true
}

func endLiveActivity(apns *apnsSender, db *Database, activity LiveActivity, finalState journeyActivityState, now time.Time) {
	finalState.UpdatedUnix = float64(now.Unix())
	dismissal := now.Add(60 * time.Second)
	if err := apns.SendLiveActivityUpdate(activity.PushToken, activity.ApnsEnv, finalState, nil, nil, &dismissal); err != nil {
		log.Printf("notifications: live activity %d end push: %v", activity.Id, err)
	}
	db.DeleteLiveActivity(activity.ClientId, activity.ActivityId)
}

// newLiveLegLookup fetches trip updates and vehicle positions once for this
// tick and answers per-leg realtime questions from them.
func newLiveLegLookup(rt realtime.Realtime, stopsForTripCache caches.StopsForTripCache, parentStopsCache caches.ParentStopsByChildCache, tz *time.Location) liveLegLookup {
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

	return func(_ int, leg gtfs.JourneyLeg) (legLive, bool) {
		if leg.TripID == "" || updates == nil {
			return legLive{}, false
		}
		tu, err := updates.ByTripID(leg.TripID)
		if err != nil || tu == nil {
			return legLive{}, false
		}

		var l legLive
		l.HasTripUpdate = true
		if tu.GetTrip().GetScheduleRelationship() == proto.TripDescriptor_CANCELED {
			l.Cancelled = true
			return l, true
		}

		stopsData, haveStops := tripStops[leg.TripID]
		stops := append([]gtfs.Stop(nil), stopsData.Stops...)
		sort.Slice(stops, func(i, j int) bool { return stops[i].Sequence < stops[j].Sequence })
		boardIdx := findLegStop(stops, leg.FromStop, -1)
		alightIdx := -1
		if boardIdx >= 0 {
			alightIdx = findLegStop(stops, leg.ToStop, boardIdx)
		}

		boardSeq, alightSeq := -1, -1
		if boardIdx >= 0 {
			boardSeq = stops[boardIdx].Sequence
		}
		if alightIdx >= 0 {
			alightSeq = stops[alightIdx].Sequence
		}
		fromID, toID := "", ""
		if leg.FromStop != nil {
			fromID = leg.FromStop.StopId
		}
		if leg.ToStop != nil {
			toID = leg.ToStop.StopId
		}
		l.DepartureDelay, l.BoardSkipped = boardStopDelay(tu, boardSeq, fromID)
		l.ArrivalDelay, l.AlightSkipped = alightStopDelay(tu, alightSeq, toID)
		l.DepartureDelay = clampJRDelay(l.DepartureDelay)
		l.ArrivalDelay = clampJRDelay(l.ArrivalDelay)

		if boardIdx >= 0 && alightIdx > boardIdx {
			l.RideStops = alightIdx - boardIdx
		}

		// Stop counting needs a running vehicle placed on the trip - AT's
		// trip updates alone don't mean the trip has started.
		if vehicles != nil && haveStops && stopsData.LowestSequence >= 0 && boardIdx >= 0 && alightIdx >= 0 {
			if v, vErr := vehicles.ByTripID(leg.TripID); vErr == nil && v != nil {
				lat, lon := float64(v.GetPosition().GetLatitude()), float64(v.GetPosition().GetLongitude())
				nextIdx, _, vState := vehiclestate.GetNextStopSequence(tu.GetStopTimeUpdate(), stopsData.LowestSequence, tz, stops, lat, lon, v)
				if vState != "Unknown" && nextIdx >= 0 {
					l.HasVehicle = true
					l.StopsToBoard = boardIdx - nextIdx
					l.StopsToAlight = alightIdx - nextIdx
					if nextIdx < len(stops) {
						l.NextStopName = stopDisplayName(stops[nextIdx], parentStops)
					}
				}
			}
		}
		return l, true
	}
}

// findLegStop is the index in `stops` (sorted by sequence) of a plan leg's
// stop, after index `after` - the exact child stop first, then any platform
// of the same parent station. Matching the child ID alone missed whenever the
// plan's platform wasn't the one the trip uses, and the leg then lost its
// vehicle and fell back to the trip-level delay (often absent) - the Live
// Activity showed a bare timetable "Due" time. Same rule as the app's
// `JourneyTracking.findStopSequence`.
func findLegStop(stops []gtfs.Stop, legStop *gtfs.Stop, after int) int {
	if legStop == nil {
		return -1
	}
	for i := after + 1; i < len(stops); i++ {
		if stops[i].StopId == legStop.StopId {
			return i
		}
	}
	if legStop.ParentStation == "" {
		return -1
	}
	for i := after + 1; i < len(stops); i++ {
		if stops[i].ParentStation == legStop.ParentStation {
			return i
		}
	}
	return -1
}

// stopDisplayName is the stop's parent station name when it has one (a
// platform's own name can carry the platform), as the app's live vehicle
// data shows it - so the next stop reads the same whichever side is
// updating the Live Activity.
func stopDisplayName(stop gtfs.Stop, parentStops map[string]gtfs.Stop) string {
	if stop.ParentStation != "" {
		if parent, ok := parentStops[stop.StopId]; ok && parent.StopName != "" {
			return parent.StopName
		}
	}
	return stop.StopName
}

// alightStopDelay is boardStopDelay's counterpart for the stop the rider
// gets off at - prefers the arrival prediction over the departure one.
func alightStopDelay(tu *proto.TripUpdate, seq int, stopID string) (delay int, skipped bool) {
	carried, haveCarried := 0, false
	for _, stu := range tu.GetStopTimeUpdate() {
		s := int(stu.GetStopSequence())
		isTarget := (s != 0 && s == seq) || (stu.GetStopId() != "" && stu.GetStopId() == stopID)
		if isTarget {
			if stu.GetScheduleRelationship() == proto.TripUpdate_StopTimeUpdate_SKIPPED {
				return 0, true
			}
			if a := stu.GetArrival(); a != nil && a.Delay != nil {
				return int(a.GetDelay()), false
			}
			if d := stu.GetDeparture(); d != nil && d.Delay != nil {
				return int(d.GetDelay()), false
			}
			return int(tu.GetDelay()), false
		}
		if s != 0 && seq > 0 && s < seq {
			if d := stu.GetDeparture(); d != nil && d.Delay != nil {
				carried, haveCarried = int(d.GetDelay()), true
			} else if a := stu.GetArrival(); a != nil && a.Delay != nil {
				carried, haveCarried = int(a.GetDelay()), true
			}
		}
	}
	if haveCarried {
		return carried, false
	}
	return int(tu.GetDelay()), false
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
