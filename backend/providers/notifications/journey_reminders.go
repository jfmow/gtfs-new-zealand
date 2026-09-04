package notifications

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jfmow/gtfs/realtime/proto"
)

/*
"Leave-by" planned journey reminders.

A row is created from a chosen journey (or a journey *request* + target time)
and the journey-reminders cron (see routes.go) re-evaluates it against realtime
trip updates, pushing "leave in 30 / 15 / 5 min" then "leave now", and a
"leave time updated" push when the boarding service's delay moves things.

Two kinds:
  - "fixed_trip"       one-off, a concrete boarding trip the client already
                       resolved from the journey it picked. Starts "armed".
  - "journey_request"  recurring, or a future date with no concrete trip yet.
                       The cron resolves the boarding trip per occurrence
                       (PlanJourneyRaptor) ~resolveLead before it's due.

Status lifecycle:
  scheduled -> pending_resolve -> armed -> notifying -> done -> (delete)
  recurring rows roll back to scheduled for the next occurrence instead of done.
*/

const (
	// Bounds on a GTFS-realtime delay we're willing to trust for the leave-time
	// maths - mirrors the (unexported) clamp in the gtfs journey planner.
	jrMinTrustedDelaySeconds = -10 * 60
	jrMaxTrustedDelaySeconds = 2 * 60 * 60

	// A leave-time shift this many seconds past what the user was last told
	// triggers a "leave time updated" push (once the offset ladder has started).
	jrReNotifyThresholdSeconds = 120

	// Default per-device cap on active journey reminders, enforced in the handler.
	jrMaxActivePerClient = 20

	// Open-ended recurring reminders are capped this far past creation.
	jrRecurrenceMaxDays = 90
)

// Terminal / non-actionable statuses - excluded from the "active" queries.
var jrInactiveStatuses = []string{"done", "expired"}

type JourneyReminder struct {
	Id       int
	ClientId int
	Region   string
	DedupKey string

	Kind   string
	Status string

	StartLat, StartLon float64
	StartLabel         string
	EndLat, EndLon     float64
	EndLabel           string
	TimeType           string
	TargetHHMM         string
	MaxWalkKm          float64
	WalkSpeed          float64
	MaxTransfers       int
	PrepBufferSeconds  int
	Offsets            []int
	Recurrence         string
	RecurrenceUntil    string
	Deeplink           string

	ServiceDate            string
	TargetUnix             int64
	BoardTripID            sql.NullString
	BoardStopID            sql.NullString
	BoardStopSequence      sql.NullInt64
	ScheduledDepartureUnix sql.NullInt64
	AccessSeconds          sql.NullInt64
	RouteShortName         string
	BoardStopName          string
	SentOffsets            []int
	BaselineLeaveUnix      sql.NullInt64
	ResolveAttempts        int
	LastError              string

	Created int64
	Updated int64
}

// jrColumns is the shared SELECT column list, order-matched by scanJourneyReminder.
const jrColumns = `
	id, clientId, region, dedup_key, kind, status,
	start_lat, start_lon, start_label, end_lat, end_lon, end_label,
	time_type, target_hhmm, max_walk_km, walk_speed, max_transfers,
	prep_buffer_seconds, offsets, recurrence, recurrence_until, deeplink,
	service_date, target_unix, board_trip_id, board_stop_id, board_stop_sequence,
	scheduled_departure_unix, access_seconds, route_short_name, board_stop_name,
	sent_offsets, baseline_leave_unix, resolve_attempts, last_error, created, updated
`

func scanJourneyReminder(rows *sql.Rows) (JourneyReminder, error) {
	var (
		r                    JourneyReminder
		offsetsRaw, sentRaw  sql.NullString
	)
	if err := rows.Scan(
		&r.Id, &r.ClientId, &r.Region, &r.DedupKey, &r.Kind, &r.Status,
		&r.StartLat, &r.StartLon, &r.StartLabel, &r.EndLat, &r.EndLon, &r.EndLabel,
		&r.TimeType, &r.TargetHHMM, &r.MaxWalkKm, &r.WalkSpeed, &r.MaxTransfers,
		&r.PrepBufferSeconds, &offsetsRaw, &r.Recurrence, &r.RecurrenceUntil, &r.Deeplink,
		&r.ServiceDate, &r.TargetUnix, &r.BoardTripID, &r.BoardStopID, &r.BoardStopSequence,
		&r.ScheduledDepartureUnix, &r.AccessSeconds, &r.RouteShortName, &r.BoardStopName,
		&sentRaw, &r.BaselineLeaveUnix, &r.ResolveAttempts, &r.LastError, &r.Created, &r.Updated,
	); err != nil {
		return JourneyReminder{}, err
	}
	r.Offsets = decodeIntSlice(offsetsRaw)
	r.SentOffsets = decodeIntSlice(sentRaw)
	return r, nil
}

func (v *Database) queryJourneyReminders(query string, args ...any) ([]JourneyReminder, error) {
	rows, cancel, err := v.queryContext(query, args...)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to query journey reminders: %w", err)
	}
	defer cancel()
	defer rows.Close()

	var out []JourneyReminder
	for rows.Next() {
		r, err := scanJourneyReminder(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan journey reminder: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating journey reminders: %w", err)
	}
	return out, nil
}

// HasAnyActiveJourneyReminders is the cheap gate the cron checks first.
func (v *Database) HasAnyActiveJourneyReminders(region string) (bool, error) {
	row, cancel := v.queryRowContext(
		`SELECT 1 FROM journey_reminders WHERE region = ? AND status NOT IN ('done','expired') LIMIT 1`,
		region,
	)
	defer cancel()

	var exists int
	if err := row.Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("failed to check journey reminders: %w", err)
	}
	return true, nil
}

// GetJourneyRemindersToResolve returns journey_request rows that need a
// PlanJourneyRaptor run: either explicitly pending_resolve, or scheduled and now
// within resolveLead of their target. Throttled to rows not touched in 10 min.
func (v *Database) GetJourneyRemindersToResolve(region string, now time.Time, resolveLeadSeconds int64, limit int) ([]JourneyReminder, error) {
	return v.queryJourneyReminders(
		`SELECT `+jrColumns+` FROM journey_reminders
		 WHERE region = ? AND kind = 'journey_request'
		   AND ( status = 'pending_resolve'
		         OR (status = 'scheduled' AND ? >= target_unix - ?) )
		   AND ? >= updated + 600
		 ORDER BY target_unix ASC
		 LIMIT ?`,
		region, now.Unix(), resolveLeadSeconds, now.Unix(), limit,
	)
}

// GetArmedJourneyReminders returns rows the notify pass evaluates each tick.
func (v *Database) GetArmedJourneyReminders(region string) ([]JourneyReminder, error) {
	return v.queryJourneyReminders(
		`SELECT `+jrColumns+` FROM journey_reminders
		 WHERE region = ? AND status IN ('armed','notifying')
		 ORDER BY scheduled_departure_unix ASC`,
		region,
	)
}

// GetRolloverCandidates returns rows that have finished their current occurrence
// (done/expired) or are stale enough to clean up.
func (v *Database) GetRolloverCandidates(region string, now time.Time) ([]JourneyReminder, error) {
	return v.queryJourneyReminders(
		`SELECT `+jrColumns+` FROM journey_reminders
		 WHERE region = ?
		   AND ( status IN ('done','expired')
		         OR ? > target_unix + 900 )`,
		region, now.Unix(),
	)
}

func (v *Database) GetJourneyRemindersForClient(clientId int) ([]JourneyReminder, error) {
	return v.queryJourneyReminders(
		`SELECT `+jrColumns+` FROM journey_reminders
		 WHERE clientId = ? AND status NOT IN ('done','expired')
		 ORDER BY target_unix ASC`,
		clientId,
	)
}

func (v *Database) CountActiveJourneyReminders(clientId int) (int, error) {
	row, cancel := v.queryRowContext(
		`SELECT COUNT(*) FROM journey_reminders WHERE clientId = ? AND status NOT IN ('done','expired')`,
		clientId,
	)
	defer cancel()

	var n int
	if err := row.Scan(&n); err != nil {
		return 0, fmt.Errorf("failed to count journey reminders: %w", err)
	}
	return n, nil
}

// UpsertJourneyReminder inserts a new reminder or replaces the existing one with
// the same (clientId, dedup_key) - re-creating "the same" reminder just updates it.
func (v *Database) UpsertJourneyReminder(r JourneyReminder) (int64, error) {
	now := time.Now().In(v.timeZone).Unix()

	res, err := v.execContext(
		`INSERT INTO journey_reminders (
			clientId, region, dedup_key, kind, status,
			start_lat, start_lon, start_label, end_lat, end_lon, end_label,
			time_type, target_hhmm, max_walk_km, walk_speed, max_transfers,
			prep_buffer_seconds, offsets, recurrence, recurrence_until, deeplink,
			service_date, target_unix, board_trip_id, board_stop_id, board_stop_sequence,
			scheduled_departure_unix, access_seconds, route_short_name, board_stop_name,
			sent_offsets, baseline_leave_unix, resolve_attempts, last_error, created, updated
		) VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?)
		ON CONFLICT(clientId, dedup_key) DO UPDATE SET
			region=excluded.region, kind=excluded.kind, status=excluded.status,
			start_lat=excluded.start_lat, start_lon=excluded.start_lon, start_label=excluded.start_label,
			end_lat=excluded.end_lat, end_lon=excluded.end_lon, end_label=excluded.end_label,
			time_type=excluded.time_type, target_hhmm=excluded.target_hhmm,
			max_walk_km=excluded.max_walk_km, walk_speed=excluded.walk_speed, max_transfers=excluded.max_transfers,
			prep_buffer_seconds=excluded.prep_buffer_seconds, offsets=excluded.offsets,
			recurrence=excluded.recurrence, recurrence_until=excluded.recurrence_until, deeplink=excluded.deeplink,
			service_date=excluded.service_date, target_unix=excluded.target_unix,
			board_trip_id=excluded.board_trip_id, board_stop_id=excluded.board_stop_id, board_stop_sequence=excluded.board_stop_sequence,
			scheduled_departure_unix=excluded.scheduled_departure_unix, access_seconds=excluded.access_seconds,
			route_short_name=excluded.route_short_name, board_stop_name=excluded.board_stop_name,
			sent_offsets='[]', baseline_leave_unix=excluded.baseline_leave_unix,
			resolve_attempts=0, last_error='', updated=excluded.updated`,
		r.ClientId, r.Region, r.DedupKey, r.Kind, r.Status,
		r.StartLat, r.StartLon, r.StartLabel, r.EndLat, r.EndLon, r.EndLabel,
		r.TimeType, r.TargetHHMM, r.MaxWalkKm, r.WalkSpeed, r.MaxTransfers,
		r.PrepBufferSeconds, encodeIntSlice(r.Offsets), r.Recurrence, r.RecurrenceUntil, r.Deeplink,
		r.ServiceDate, r.TargetUnix, r.BoardTripID, r.BoardStopID, r.BoardStopSequence,
		r.ScheduledDepartureUnix, r.AccessSeconds, r.RouteShortName, r.BoardStopName,
		encodeIntSlice(r.SentOffsets), r.BaselineLeaveUnix, r.ResolveAttempts, r.LastError, now, now,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to upsert journey reminder: %w", err)
	}

	if id, err := res.LastInsertId(); err == nil && id > 0 {
		return id, nil
	}
	// ON CONFLICT path - look the row back up.
	row, cancel := v.queryRowContext(
		`SELECT id FROM journey_reminders WHERE clientId = ? AND dedup_key = ?`,
		r.ClientId, r.DedupKey,
	)
	defer cancel()
	var id int64
	if err := row.Scan(&id); err != nil {
		return 0, fmt.Errorf("failed to read back journey reminder id: %w", err)
	}
	return id, nil
}

// UpdateJourneyReminderResolved records a resolved boarding leg and arms the row.
func (v *Database) UpdateJourneyReminderResolved(id int, tripID, stopID string, seq int, schedUnix, accessSec, baselineUnix int64, routeName, stopName string) error {
	now := time.Now().In(v.timeZone).Unix()
	_, err := v.execContext(
		`UPDATE journey_reminders SET
			status='armed', board_trip_id=?, board_stop_id=?, board_stop_sequence=?,
			scheduled_departure_unix=?, access_seconds=?, baseline_leave_unix=?,
			route_short_name=?, board_stop_name=?, sent_offsets='[]',
			resolve_attempts=0, last_error='', updated=?
		 WHERE id=?`,
		tripID, stopID, seq, schedUnix, accessSec, baselineUnix, routeName, stopName, now, id,
	)
	if err != nil {
		return fmt.Errorf("failed to mark journey reminder resolved: %w", err)
	}
	return nil
}

// UpdateJourneyReminderState persists notify-pass progress.
func (v *Database) UpdateJourneyReminderState(id int, status string, sentOffsets []int, baselineLeaveUnix int64) error {
	now := time.Now().In(v.timeZone).Unix()
	var baseline any
	if baselineLeaveUnix > 0 {
		baseline = baselineLeaveUnix
	}
	_, err := v.execContext(
		`UPDATE journey_reminders SET status=?, sent_offsets=?, baseline_leave_unix=?, updated=? WHERE id=?`,
		status, encodeIntSlice(sentOffsets), baseline, now, id,
	)
	if err != nil {
		return fmt.Errorf("failed to update journey reminder state: %w", err)
	}
	return nil
}

// ClearJourneyReminderResolution drops the resolved board columns and moves the
// row back to pending_resolve (used when a resolved trip is cancelled but there's
// still time to find a replacement).
func (v *Database) ClearJourneyReminderResolution(id int) error {
	now := time.Now().In(v.timeZone).Unix()
	_, err := v.execContext(
		`UPDATE journey_reminders SET
			status='pending_resolve', board_trip_id=NULL, board_stop_id=NULL, board_stop_sequence=NULL,
			scheduled_departure_unix=NULL, access_seconds=NULL, sent_offsets='[]',
			resolve_attempts=0, last_error='', updated=?
		 WHERE id=?`,
		now, id,
	)
	if err != nil {
		return fmt.Errorf("failed to clear journey reminder resolution: %w", err)
	}
	return nil
}

func (v *Database) UpdateJourneyReminderResolveFailure(id, attempts int, lastErr, status string) error {
	now := time.Now().In(v.timeZone).Unix()
	if len(lastErr) > 300 {
		lastErr = lastErr[:300]
	}
	_, err := v.execContext(
		`UPDATE journey_reminders SET status=?, resolve_attempts=?, last_error=?, updated=? WHERE id=?`,
		status, attempts, lastErr, now, id,
	)
	if err != nil {
		return fmt.Errorf("failed to record journey reminder resolve failure: %w", err)
	}
	return nil
}

// RollJourneyReminderToNextOccurrence resets the per-occurrence columns of a
// recurring row and points it at the next service date.
func (v *Database) RollJourneyReminderToNextOccurrence(id int, serviceDate string, targetUnix int64) error {
	now := time.Now().In(v.timeZone).Unix()
	_, err := v.execContext(
		`UPDATE journey_reminders SET
			status='scheduled', service_date=?, target_unix=?,
			board_trip_id=NULL, board_stop_id=NULL, board_stop_sequence=NULL,
			scheduled_departure_unix=NULL, access_seconds=NULL, baseline_leave_unix=NULL,
			route_short_name='', board_stop_name='', sent_offsets='[]',
			resolve_attempts=0, last_error='', updated=?
		 WHERE id=?`,
		serviceDate, targetUnix, now, id,
	)
	if err != nil {
		return fmt.Errorf("failed to roll journey reminder: %w", err)
	}
	return nil
}

func (v *Database) DeleteJourneyReminder(id int) error {
	if _, err := v.execContext(`DELETE FROM journey_reminders WHERE id = ?`, id); err != nil {
		return fmt.Errorf("failed to delete journey reminder: %w", err)
	}
	return nil
}

func (v *Database) DeleteJourneyReminderForClient(id, clientId int) error {
	if _, err := v.execContext(`DELETE FROM journey_reminders WHERE id = ? AND clientId = ?`, id, clientId); err != nil {
		return fmt.Errorf("failed to delete journey reminder: %w", err)
	}
	return nil
}

// ───────────────────────── helpers ─────────────────────────

// journeyReminderDedupKey identifies "the same" reminder for upsert: same device,
// same rough endpoints, same target time / mode. A recurring reminder is
// date-independent; a one-off also keys on its service date so the same commute
// on Tue and Wed can both exist.
func journeyReminderDedupKey(clientId int, startLat, startLon, endLat, endLon float64, timeType, targetHHMM, recurrence, serviceDate string) string {
	dateKey := ""
	if recurrence == "" {
		dateKey = serviceDate
	}
	raw := fmt.Sprintf("%d|%.4f,%.4f|%.4f,%.4f|%s|%s|%s|%s",
		clientId, startLat, startLon, endLat, endLon, timeType, targetHHMM, recurrence, dateKey)
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// hhmmToUnix combines a YYYYMMDD service date with a "HH:MM" wall-clock target.
func hhmmToUnix(serviceDate, hhmm string, tz *time.Location) (int64, error) {
	t, err := time.ParseInLocation("200601021504", serviceDate+strings.ReplaceAll(hhmm, ":", ""), tz)
	if err != nil {
		return 0, err
	}
	return t.Unix(), nil
}

// weekdayIndexMon returns 0=Mon .. 6=Sun for a time.
func weekdayIndexMon(t time.Time) int {
	return (int(t.Weekday()) + 6) % 7
}

// recurrenceMatches reports whether a YYYYMMDD date falls on a day the 7-char
// Mon..Sun mask selects.
func recurrenceMatches(mask string, day time.Time) bool {
	if len(mask) != 7 {
		return false
	}
	return mask[weekdayIndexMon(day)] == '1'
}

// nextJourneyReminderOccurrence returns the next YYYYMMDD service date (and the
// absolute target instant) for a recurring reminder, strictly after its current
// service_date, honouring recurrence_until. Returns ("", 0) when the series has ended.
func nextJourneyReminderOccurrence(r JourneyReminder, tz *time.Location) (string, int64) {
	if len(r.Recurrence) != 7 || strings.Count(r.Recurrence, "1") == 0 {
		return "", 0
	}
	cur, err := time.ParseInLocation("20060102", r.ServiceDate, tz)
	if err != nil {
		cur = time.Now().In(tz)
	}
	var until time.Time
	if r.RecurrenceUntil != "" {
		if u, err := time.ParseInLocation("20060102", r.RecurrenceUntil, tz); err == nil {
			until = u
		}
	}
	for i := 1; i <= 8; i++ {
		cand := cur.AddDate(0, 0, i)
		if !until.IsZero() && cand.After(until) {
			return "", 0
		}
		if recurrenceMatches(r.Recurrence, cand) {
			sd := cand.Format("20060102")
			tu, err := hhmmToUnix(sd, r.TargetHHMM, tz)
			if err != nil {
				return "", 0
			}
			return sd, tu
		}
	}
	return "", 0
}

// firstJourneyReminderOccurrence picks the first service date for a new reminder:
// today if today matches (recurring) or is the requested date and the target time
// is still ahead, otherwise the next matching / next day.
func firstJourneyReminderOccurrence(recurrence, targetHHMM string, now time.Time, tz *time.Location) (string, int64, error) {
	for i := 0; i <= 8; i++ {
		cand := now.AddDate(0, 0, i)
		sd := cand.Format("20060102")
		if recurrence != "" && !recurrenceMatches(recurrence, cand) {
			continue
		}
		tu, err := hhmmToUnix(sd, targetHHMM, tz)
		if err != nil {
			return "", 0, err
		}
		if i == 0 && tu <= now.Unix() {
			continue
		}
		return sd, tu, nil
	}
	return "", 0, errors.New("no valid occurrence in the next 8 days")
}

// clampJRDelay bounds a realtime delay for the leave-time maths.
func clampJRDelay(delay int) int {
	if delay < jrMinTrustedDelaySeconds {
		return jrMinTrustedDelaySeconds
	}
	if delay > jrMaxTrustedDelaySeconds {
		return jrMaxTrustedDelaySeconds
	}
	return delay
}

// boardStopDelay reads the departure delay (seconds) for the rider's boarding
// stop out of a trip update, and whether that stop is being skipped. It matches
// on raw stop_sequence or stop_id, falls back to arrival delay, then to a delay
// carried forward from the most recent earlier stop, then the trip-level delay.
func boardStopDelay(tu *proto.TripUpdate, seq int, stopID string) (delay int, skipped bool) {
	carried, haveCarried := 0, false
	for _, stu := range tu.GetStopTimeUpdate() {
		s := int(stu.GetStopSequence())
		isTarget := (s != 0 && s == seq) || (stu.GetStopId() != "" && stu.GetStopId() == stopID)
		if isTarget {
			if stu.GetScheduleRelationship() == proto.TripUpdate_StopTimeUpdate_SKIPPED {
				return 0, true
			}
			if d := stu.GetDeparture(); d != nil && d.Delay != nil {
				return int(d.GetDelay()), false
			}
			if a := stu.GetArrival(); a != nil && a.Delay != nil {
				return int(a.GetDelay()), false
			}
			return int(tu.GetDelay()), false
		}
		if s != 0 && s < seq {
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

// leaveCopy builds the title/body for an offset-ladder push. `minsUntilLeave` is
// minutes until the (buffer-adjusted) time to head off; `minsUntilDeparture` is
// minutes until the service actually leaves the stop.
//
// Only the final rung (minsUntilLeave <= 1) is a "go" instruction - the earlier
// rungs are advance heads-ups and are phrased "In N min: ..." so a glance at the
// lock screen doesn't read them as "leave right now". When accessSeconds is
// small the reminder was set against a specific departure ("catch this bus"), so
// the copy talks about the service rather than "leaving".
func leaveCopy(minsUntilLeave, minsUntilDeparture int, routeName, stopName string, departAt time.Time, accessSeconds int64) (title, body string) {
	route := routeName
	if route == "" {
		route = "your service"
	}
	from := ""
	if stopName != "" {
		from = " from " + stopName
	}
	at := departAt.Format("3:04pm")

	// Departure countdown for the "go" rung - floored at 1 ("in 0 min" reads
	// worse) and capped so a stale feed value can't claim "in 45 min" on the
	// final call.
	dep := minsUntilDeparture
	if dep < 1 {
		dep = 1
	} else if dep > 20 {
		dep = 20
	}

	goNow := minsUntilLeave <= 1
	catchOnly := accessSeconds <= 120

	switch {
	case catchOnly && goNow:
		return fmt.Sprintf("%s departs in %d min", route, dep),
			fmt.Sprintf("The %s%s departs in about %d min (%s).", route, from, dep, at)
	case catchOnly:
		return fmt.Sprintf("In %d min: the %s", minsUntilLeave, route),
			fmt.Sprintf("The %s%s departs in about %d min (%s).", route, from, minsUntilDeparture, at)
	case goNow:
		return fmt.Sprintf("Leave now for the %s", route),
			fmt.Sprintf("Head off%s now - the %s departs in about %d min (%s).", from, route, dep, at)
	default:
		return fmt.Sprintf("In %d min: leave for the %s", minsUntilLeave, route),
			fmt.Sprintf("Leave%s for the %s in about %d min. It departs %s.", from, route, minsUntilLeave, at)
	}
}

func sortedDescInts(in []int) []int {
	out := append([]int(nil), in...)
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return out
}

func maxOffsetMinutes(offsets []int) int {
	m := 0
	for _, o := range offsets {
		if o > m {
			m = o
		}
	}
	return m
}

func containsInt(s []int, v int) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

func nullInt64(v int64) sql.NullInt64 {
	return sql.NullInt64{Int64: v, Valid: true}
}

// journeyReminderDTO is the JSON shape the frontend consumes (flat, no sql.Null*).
func journeyReminderDTO(r JourneyReminder, tz *time.Location) map[string]any {
	dto := map[string]any{
		"id":           r.Id,
		"kind":         r.Kind,
		"status":       r.Status,
		"start_label":  r.StartLabel,
		"end_label":    r.EndLabel,
		"time_type":    r.TimeType,
		"target_hhmm":  r.TargetHHMM,
		"recurrence":   r.Recurrence,
		"service_date": r.ServiceDate,
		"offsets":      r.Offsets,
		"route_short_name": r.RouteShortName,
		"board_stop_name":  r.BoardStopName,
	}
	if r.RecurrenceUntil != "" {
		dto["recurrence_until"] = r.RecurrenceUntil
	}
	if r.BaselineLeaveUnix.Valid {
		dto["next_leave_unix"] = r.BaselineLeaveUnix.Int64
		dto["next_leave_local"] = time.Unix(r.BaselineLeaveUnix.Int64, 0).In(tz).Format("15:04")
	}
	return dto
}

// prettyServiceDate turns YYYYMMDD into something for notification copy.
func prettyServiceDate(serviceDate string, tz *time.Location) string {
	if t, err := time.ParseInLocation("20060102", serviceDate, tz); err == nil {
		return t.Format("Mon 2 Jan")
	}
	return serviceDate
}
