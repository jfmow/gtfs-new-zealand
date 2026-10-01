package notifications

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/url"
	"regexp"
	"sort"
	"time"

	"github.com/jfmow/at-trains-api/providers/planlimit"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// resolveLeadSeconds is how far before an occurrence's target time the cron
// starts trying to resolve a concrete boarding trip for a journey_request row.
func resolveLeadSeconds(offsets []int) int64 {
	lead := int64(2 * 60 * 60)
	if byOffsets := int64(maxOffsetMinutes(offsets))*60 + 60*60; byOffsets > lead {
		lead = byOffsets
	}
	return lead
}

// runJourneyRemindersCron is one tick of the journey-reminders evaluator. It is
// called from a single cron entry in SetupNotificationsRoutes (guarded by a
// TryLock mutex there), and only touches rows for its own region.
func runJourneyRemindersCron(
	db *Database,
	gtfsData gtfs.Database,
	rt realtime.Realtime,
	live liveLegLookup,
	tz *time.Location,
	region, osrmURL string,
	planLookup func(id string) (gtfs.JourneyPlan, bool),
	planPut func(gtfs.JourneyPlan),
	now time.Time,
	findNext nextJourneyFinder,
) {
	if db == nil {
		return
	}

	// Rollover/cleanup first, unconditionally: a region whose rows are all
	// terminal (done/expired) has no *active* reminders, but those finished rows
	// still need deleting - gating this behind HasAnyActiveJourneyReminders left
	// them to linger until the owning client's 30-day cascade.
	jrCronRollover(db, tz, region, now)

	has, err := db.HasAnyActiveJourneyReminders(region)
	if err != nil || !has {
		return
	}

	updates, _ := rt.GetTripUpdates() // nil / partial tolerated per row

	jrCronResolve(db, gtfsData, &rt, tz, region, osrmURL, planPut, now)
	jrCronNotify(db, updates, live, tz, region, planLookup, now, findNext)
	jrCronReroute(db, gtfsData, &rt, updates, tz, region, osrmURL, planLookup, planPut, now)
}

// ── PASS 0 — rollover & expiry ────────────────────────────────────────────────

func jrCronRollover(db *Database, tz *time.Location, region string, now time.Time) {
	rows, err := db.GetRolloverCandidates(region, now)
	if err != nil {
		return
	}
	for _, r := range rows {
		if r.Recurrence != "" {
			sd, tu := nextJourneyReminderOccurrence(r, tz)
			if sd != "" {
				_ = db.RollJourneyReminderToNextOccurrence(r.Id, sd, tu)
				continue
			}
		}
		_ = db.DeleteJourneyReminder(r.Id)
	}
}

// ── PASS 1 — resolve boarding trip (bounded; RAPTOR is heavy) ─────────────────

func jrCronResolve(
	db *Database,
	gtfsData gtfs.Database,
	rt *realtime.Realtime,
	tz *time.Location,
	region, osrmURL string,
	planPut func(gtfs.JourneyPlan),
	now time.Time,
) {
	// Query with the widest lead any row could ask for (180-min offset + 1h);
	// per-row we re-check against that row's own offsets below.
	rows, err := db.GetJourneyRemindersToResolve(region, now, int64(180*60+60*60), 5)
	if err != nil {
		return
	}

	for _, r := range rows {
		if r.Status == "scheduled" && now.Unix() < r.TargetUnix-resolveLeadSeconds(r.Offsets) {
			continue
		}

		req := buildJourneyRequest(r, osrmURL, rt, tz)
		plans, planErr := func() (*[]gtfs.JourneyPlan, error) {
			planlimit.Acquire(context.Background())
			defer planlimit.Release()
			return gtfsData.PlanJourneyRaptor(req)
		}()
		if planErr != nil || plans == nil || len(*plans) == 0 {
			jrHandleResolveFailure(db, tz, r, now, planErr)
			continue
		}

		plan := (*plans)[0]
		bt := firstTransitLeg(plan)
		if bt == nil || bt.FromStop == nil {
			jrHandleResolveFailure(db, tz, r, now, fmt.Errorf("journey has no transit leg"))
			continue
		}

		// Raw GTFS stop_sequence for the boarding stop (the trip update feed
		// keys stop-time updates by raw sequence / stop id).
		stopsForTrip, _, sErr := gtfsData.GetStopsForTripID(bt.TripID)
		if sErr != nil {
			jrHandleResolveFailure(db, tz, r, now, fmt.Errorf("trip stops: %w", sErr))
			continue
		}
		rawSeq := -1
		for _, s := range stopsForTrip {
			if s.StopId == bt.FromStop.StopId {
				rawSeq = s.Sequence
				break
			}
		}
		if rawSeq < 0 {
			jrHandleResolveFailure(db, tz, r, now, fmt.Errorf("board stop not on resolved trip"))
			continue
		}

		// bt.ScheduledDepartureTime is already anchored to the requested
		// service date (buildJourneyRequest set ArriveAt/DepartAt on it).
		boardDeparture := bt.ScheduledDepartureTime
		if boardDeparture.IsZero() {
			boardDeparture = bt.DepartureTime
		}
		schedUnix := boardDeparture.Unix()

		// Leading walk/wait from the rider's start to the boarding stop. The
		// leave anchor is schedUnix - access (the real walk-out time); the
		// offset ladder is the only lead, no prep padding.
		// Measured live to live: plan.DepartureTime already carries any
		// realtime shift the planner applied, so the scheduled departure
		// would count the delay into the walk.
		access := int(bt.DepartureTime.Sub(plan.DepartureTime).Seconds())
		if access < 0 {
			access = 0
		}
		if access > 4*60*60 {
			access = 4 * 60 * 60
		}

		routeName := bt.RouteID
		if bt.Route != nil && bt.Route.RouteShortName != "" {
			routeName = bt.Route.RouteShortName
		}

		_ = db.UpdateJourneyReminderResolved(
			r.Id, bt.TripID, bt.FromStop.StopId, rawSeq,
			schedUnix, int64(access), schedUnix-int64(access),
			routeName, bt.FromStop.StopName,
		)
		// Keep the resolved plan so the day's Live Activity (and the
		// notification's deeplink) can open exactly this journey.
		if planPut != nil && plan.ID != "" {
			planPut(plan)
			_ = db.SetJourneyReminderPlanID(r.Id, plan.ID)
		}
	}
}

func jrHandleResolveFailure(db *Database, tz *time.Location, r JourneyReminder, now time.Time, cause error) {
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}

	// Still time before the target - keep retrying quietly.
	if now.Unix() < r.TargetUnix {
		_ = db.UpdateJourneyReminderResolveFailure(r.Id, r.ResolveAttempts+1, msg, "pending_resolve")
		return
	}

	// Target passed and we never found a journey - tell the rider once.
	notifyJourneyReminderClient(db, r, "no-journey",
		"No journey found",
		fmt.Sprintf("We couldn't find a journey to %s for %s.", orLabel(r.EndLabel, "your destination"), prettyServiceDate(r.ServiceDate, tz)),
	)
	status := "expired"
	if r.Recurrence != "" {
		status = "done" // PASS 0 rolls it to the next occurrence
	}
	_ = db.UpdateJourneyReminderResolveFailure(r.Id, r.ResolveAttempts+1, msg, status)
}

// ── PASS 2 — arm / notify ────────────────────────────────────────────────────

func jrCronNotify(db *Database, updates realtime.TripUpdatesMap, live liveLegLookup, tz *time.Location, region string, planLookup func(id string) (gtfs.JourneyPlan, bool), now time.Time, findNext nextJourneyFinder) {
	rows, err := db.GetArmedJourneyReminders(region)
	if err != nil {
		return
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].ScheduledDepartureUnix.Int64 < rows[j].ScheduledDepartureUnix.Int64
	})

	for _, r := range rows {
		if !r.ScheduledDepartureUnix.Valid || !r.AccessSeconds.Valid || !r.BoardTripID.Valid {
			continue // not actually resolved
		}
		sched := r.ScheduledDepartureUnix.Int64
		access := r.AccessSeconds.Int64
		boardSeq := int(r.BoardStopSequence.Int64)

		delay, canceled, skipped := 0, false, false
		if updates != nil {
			if tu, e := updates.ByTripID(r.BoardTripID.String); e == nil && tu != nil {
				if sd := tu.GetTrip().GetStartDate(); sd == "" || sd == r.ServiceDate {
					if tu.GetTrip().GetScheduleRelationship() == proto.TripDescriptor_CANCELED {
						canceled = true
					} else {
						delay, skipped = boardStopDelay(tu, boardSeq, r.BoardStopID.String)
					}
				}
			}
		}

		if canceled || skipped {
			jrHandleBoardingLost(db, tz, r, now)
			continue
		}

		delay = clampJRDelay(delay)
		departUnix := sched + int64(delay)
		// Rounded down to the minute like the Live Activity's leave-by, so
		// the push and the card give the same time.
		leaveUnix := leaveByTime(time.Unix(departUnix-access, 0)).Unix()
		// With the journey on hand, work it out exactly as the Live Activity
		// does - the same realtime lookup, which trusts an early bus once
		// it's on the road. Clamping it here while the card didn't sent
		// "leave in 5" with the card saying 3 (2026-09-30).
		var plan gtfs.JourneyPlan
		havePlan := false
		if planLookup != nil {
			plan, havePlan = planLookup(reminderPlanID(r))
		}
		if havePlan && live != nil {
			if dep, leave, ok := planLiveLeave(plan, live, r.BoardTripID.String); ok {
				departUnix, leaveUnix = dep.Unix(), leave.Unix()
			}
		}
		leaveTime := time.Unix(leaveUnix, 0).In(tz)
		departTime := time.Unix(departUnix, 0).In(tz)
		minsUntilLeave := int(math.Round(time.Until(leaveTime).Minutes()))
		minsUntilDeparture := int(math.Round(time.Until(departTime).Minutes()))

		sent := append([]int(nil), r.SentOffsets...)
		offsets := sortedDescInts(r.Offsets)
		ladderStarted := len(sent) > 0
		baseline := r.BaselineLeaveUnix.Int64
		changed := false

		// What the journey's Live Activity has seen of the rider setting
		// off. Once they're on the way, leave times are history: nothing
		// more about leaving is sent (the card says whether they'll make it).
		laExists, leftUnix, laWatching := db.LiveActivityDeparture(r.ClientId, reminderPlanID(r), now)
		left := leftUnix > 0

		prevLeave := baseline

		// Before the first rung, just track the live leave time silently -
		// the list/next_leave_local and the first "leave in" push then use
		// it rather than the timetable's.
		if !ladderStarted && leaveUnix != baseline {
			baseline = leaveUnix
			changed = true
		}

		// (a) re-notify on a meaningful shift once the ladder has started -
		// or, ladder or not, one that's moved the leave time earlier and
		// straight into the past before the time the rider was going by
		// came round: they're most likely still at the start. That used to
		// go unsaid - the shift push only covered a new time still ahead,
		// and a rung due with it said "leave in 5" (2026-10-02).
		shifted := ladderStarted && prevLeave > 0 && absInt64(leaveUnix-prevLeave) >= jrReNotifyThresholdSeconds
		jumpedPast := prevLeave > 0 && prevLeave-leaveUnix >= jrReNotifyThresholdSeconds &&
			!leaveTime.After(now) && time.Unix(prevLeave, 0).After(now)
		switch {
		case left:
			if shifted {
				baseline = leaveUnix
				changed = true
			}
		case jumpedPast:
			if !(laExists && laWatching) { // else the Live Activity says it
				jrNotifyLeaveTimePassed(db, r, plan, havePlan, laExists, departTime, access, region, tz, now, findNext)
			}
			// Every rung is due now - this push stands in for them.
			for _, o := range offsets {
				if !containsInt(sent, o) {
					sent = append(sent, o)
				}
			}
			baseline = leaveUnix
			changed = true
		case shifted && leaveTime.After(now):
			dir := "later"
			if leaveUnix < baseline {
				dir = "earlier"
			}
			shiftKey := fmt.Sprintf("shift-%d", now.Unix()/60)
			shiftBody := fmt.Sprintf("The %s is running %s. New leave time %s (in %d min).",
				orLabel(r.RouteShortName, "your service"), dir, leaveTime.Format("3:04pm"), maxInt(0, minsUntilLeave))
			// Earlier than planned: the rider may not be able to go
			// sooner - offer a way that still leaves when they planned to
			// and arrives about when they planned.
			var alt gtfs.JourneyPlan
			haveAlt := false
			if leaveUnix < baseline && havePlan && findNext != nil && plannedLeave(plan).Sub(leaveTime) >= keepTimeMinShift {
				alt, haveAlt = findKeepingLeaveTime(findNext, plan, now, r.BoardTripID.String)
			}
			if haveAlt {
				notifyJourneyReminderClientURL(db, r, shiftKey, "Leave time updated",
					shiftBody+" "+keepTimeSummary(alt, plan.ArrivalTime, tz)+" Tap to switch to it.", journeyTrackURL(alt.ID, region))
			} else {
				// Through the Live Activity when one's running, so the card
				// and the push change together (one buzz).
				notifyJourneyReminderLeave(db, r, shiftKey, "Leave time updated", shiftBody)
			}

			// Slipped >10 min later: replay any ladder rung whose new fire time
			// is still in the future, so "leave in 15" isn't skipped.
			if leaveUnix-baseline > 600 {
				kept := sent[:0]
				for _, o := range sent {
					if now.Unix() >= leaveUnix-int64(o)*60 {
						kept = append(kept, o)
					}
				}
				sent = kept
			}
			baseline = leaveUnix
			changed = true
		}

		// (b) fire pending offsets. When a poll gap makes several rungs due at
		// once, collapse them into one push phrased from the most urgent
		// (smallest) rung reached - never a larger one, or the copy under-reports.
		// A running Live Activity sends its own "Get ready to leave" (5 min
		// out) and "Time to leave" - the 5 and 0 rungs would repeat them.
		activityAlerts := r.LAStarted && havePlan && db.HasLiveActivityForPlan(r.ClientId, plan.ID)
		fireMins := -1
		for _, o := range offsets {
			if containsInt(sent, o) {
				continue
			}
			if now.Unix() >= leaveUnix-int64(o)*60 {
				sent = append(sent, o)
				changed = true
				if left || (activityAlerts && o*60 <= int(getReadyLead.Seconds())) {
					continue
				}
				fireMins = o // offsets are sorted desc, so the last write is the smallest rung
			}
		}
		if fireMins != -1 {
			if baseline == 0 {
				baseline = leaveUnix
			}
			// Phrase from the rung that fired, not the live countdown: a delayed
			// service legitimately pushes the leave time out (take whichever is
			// larger), but a stale "running early" feed must never turn an
			// advance rung ("in 5 min") into "leave now".
			copyMins := fireMins
			if minsUntilLeave > copyMins {
				copyMins = minsUntilLeave
			}
			title, body := leaveCopy(copyMins, minsUntilDeparture, r.RouteShortName, r.BoardStopName, departTime, access)
			notifyJourneyReminderLeave(db, r, fmt.Sprintf("leave-%d", fireMins), title, body)
		}

		// Put the journey on the Lock Screen as the rider gets ready to go.
		if !r.LAStarted && minsUntilLeave <= liveActivityStartLeadMinutes && departTime.After(now) {
			jrMaybeStartLiveActivity(db, r, region, planLookup, now)
		}

		// (c) persist / finish
		allSent := true
		for _, o := range offsets {
			if !containsInt(sent, o) {
				allSent = false
				break
			}
		}
		nextStatus := "armed"
		if len(sent) > 0 {
			nextStatus = "notifying"
		}
		if allSent && now.Unix() > leaveUnix+120 {
			nextStatus = "done"
		}
		if changed || nextStatus != r.Status {
			_ = db.UpdateJourneyReminderState(r.Id, nextStatus, sent, baseline)
		}
	}
}

// jrHandleBoardingLost handles a resolved boarding trip being cancelled or the
// board stop being skipped.
func jrHandleBoardingLost(db *Database, tz *time.Location, r JourneyReminder, now time.Time) {
	if now.Unix() < r.TargetUnix {
		notifyJourneyReminderClient(db, r, "rebook", "Journey change",
			fmt.Sprintf("Your %s service was cancelled - we're finding you another and will still tell you when to leave.",
				orLabel(r.RouteShortName, "planned")))
		_ = db.ClearJourneyReminderResolution(r.Id)
		return
	}
	notifyJourneyReminderClient(db, r, "rebook-failed", "Journey change - re-plan needed",
		"Your booked service has been cancelled and there's no time to rebook it automatically. Open the planner to find another way.")
	status := "done"
	if r.Recurrence == "" {
		status = "expired"
	}
	_ = db.UpdateJourneyReminderState(r.Id, status, r.SentOffsets, r.BaselineLeaveUnix.Int64)
}

// liveActivityStartLeadMinutes is how long before the leave time a
// reminder's journey Live Activity is push-started - early enough to show
// the "leave in" countdown, late enough not to sit on the Lock Screen for
// ages.
const liveActivityStartLeadMinutes = 15

var deeplinkPlanIDPattern = regexp.MustCompile(`[?&]id=([^&]+)`)

// reminderPlanID is the plan a reminder is for: the one the cron resolved
// (recurring), else the one in its /journey?id=... deeplink (fixed trip).
func reminderPlanID(r JourneyReminder) string {
	if r.PlanID != "" {
		return r.PlanID
	}
	if m := deeplinkPlanIDPattern.FindStringSubmatch(r.Deeplink); len(m) == 2 {
		if id, err := url.QueryUnescape(m[1]); err == nil {
			return id
		}
	}
	return ""
}

// jrMaybeStartLiveActivity push-starts the journey Live Activity for an iOS
// reminder whose device has a push-to-start token. Returns whether the
// occurrence now has an activity; false leaves it to be retried next tick
// (e.g. the device's push-to-start token hasn't arrived yet).
func jrMaybeStartLiveActivity(db *Database, r JourneyReminder, region string, planLookup func(id string) (gtfs.JourneyPlan, bool), now time.Time) bool {
	client, err := db.FindNotificationClientById(r.ClientId)
	if err != nil || client.Platform != "ios" || client.PushToStartToken == "" {
		return false
	}
	apns := sharedAPNsSender()
	planID := reminderPlanID(r)
	if apns == nil || planID == "" || planLookup == nil {
		return false
	}
	plan, ok := planLookup(planID)
	if !ok {
		return false
	}
	if db.HasLiveActivityForPlan(client.Id, plan.ID) {
		_ = db.MarkJourneyReminderLiveActivityStarted(r.Id)
		return true
	}

	state := computeJourneyActivityState(plan, now, nil, noHint)
	attributes := map[string]any{
		"planID":           plan.ID,
		"destinationLabel": orLabel(r.EndLabel, "your destination"),
		"regionSlug":       region,
	}
	alert := activityAlert{Title: state.PrimaryText, Body: state.SecondaryText}
	env := client.ApnsEnv
	if env == "" {
		env = "production"
	}
	if err := apns.SendLiveActivityStart(client.PushToStartToken, env, attributes, state, alert, now.Add(activityStaleAfter)); err != nil {
		log.Printf("notifications: push-to-start for reminder %d: %v", r.Id, err)
		if errors.Is(err, errLiveActivityBadToken) {
			// Dead token: drop it rather than retry it every tick. The
			// app sends its current one again on next launch.
			_ = db.ClearPushToStartToken(client.Id, client.PushToStartToken)
		}
		return false
	}
	_ = db.MarkJourneyReminderLiveActivityStarted(r.Id)
	return true
}

// ── shared helpers ───────────────────────────────────────────────────────────

// notifyJourneyReminderClient sends a push and records it in the in-app history.
// eventKey makes the history entry id unique per push (jr-<id>-<eventKey>) so
// each "leave in 30 / 15 / 5" etc. shows as its own row.
func notifyJourneyReminderClient(db *Database, r JourneyReminder, eventKey, title, body string) {
	client, err := db.FindNotificationClientById(r.ClientId)
	if err != nil {
		return
	}
	url := reminderURL(r)
	if err := client.SendNotification(body, title, map[string]string{"url": url}, "high"); err == nil {
		_ = client.AppendToRecentNotifications(fmt.Sprintf("jr-%d-%s", r.Id, eventKey), title, body, url)
	}
}

// notifyJourneyReminderLeave sends a "leave in ..." reminder. With the
// journey's Live Activity already running it's queued for the activity's
// cron, which sends it as the activity's alert (the Dynamic Island expands)
// plus a notification - see isSettingOff.
func notifyJourneyReminderLeave(db *Database, r JourneyReminder, eventKey, title, body string) {
	if !db.QueueLiveActivityAlert(r.ClientId, reminderPlanID(r), activityAlert{Key: "reminder-" + eventKey, Title: title, Body: body}) {
		notifyJourneyReminderClient(db, r, eventKey, title, body)
		return
	}
	if client, err := db.FindNotificationClientById(r.ClientId); err == nil {
		_ = client.AppendToRecentNotifications(fmt.Sprintf("jr-%d-%s", r.Id, eventKey), title, body, reminderURL(r))
	}
}

func reminderURL(r JourneyReminder) string {
	if r.Deeplink == "" {
		return "/plan"
	}
	// A one-off switched to a faster journey (PASS 3) opens that one.
	if r.PlanID != "" && deeplinkPlanIDPattern.MatchString(r.Deeplink) {
		return deeplinkPlanIDPattern.ReplaceAllStringFunc(r.Deeplink, func(m string) string {
			return m[:4] + url.QueryEscape(r.PlanID)
		})
	}
	return r.Deeplink
}

func buildJourneyRequest(r JourneyReminder, osrmURL string, rt *realtime.Realtime, tz *time.Location) gtfs.JourneyRequest {
	req := gtfs.JourneyRequest{
		StartLat:          r.StartLat,
		StartLon:          r.StartLon,
		EndLat:            r.EndLat,
		EndLon:            r.EndLon,
		MaxWalkKm:         r.MaxWalkKm,
		WalkSpeedKmph:     NormalizeWalkSpeed(r.WalkSpeed),
		MaxTransfers:      r.MaxTransfers,
		MaxNearbyStops:    50,
		MaxResults:        5,
		MinResults:        3,
		OsrmURL:           osrmURL,
		IncludeChildren:   true,
		OnlyRouteIDs:      r.OnlyRouteIDs,
		AllowedRouteTypes: r.RouteTypes,
		MinTransferSec:    r.MinTransferSec,
		Realtime:          rt,
	}
	target := time.Unix(r.TargetUnix, 0).In(tz)
	if r.TimeType == "departat" {
		req.DepartAt = target
	} else {
		req.ArriveAt = target
	}
	return req
}

func firstTransitLeg(plan gtfs.JourneyPlan) *gtfs.JourneyLeg {
	for i := range plan.Legs {
		if plan.Legs[i].Mode == "transit" {
			return &plan.Legs[i]
		}
	}
	return nil
}

func orLabel(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// planLiveLeave is the leave and boarding times for plan exactly as the Live
// Activity computes them (effectiveTimings + leaveByTime), when its first
// ride is still boardTripID.
func planLiveLeave(plan gtfs.JourneyPlan, live liveLegLookup, boardTripID string) (depart, leave time.Time, ok bool) {
	f := -1
	for i := range plan.Legs {
		if plan.Legs[i].Mode == "transit" {
			f = i
			break
		}
	}
	if f < 0 || plan.Legs[f].TripID != boardTripID {
		return time.Time{}, time.Time{}, false
	}
	timings := effectiveTimings(plan, live)
	leave = timings[f].dep
	if plan.Legs[0].Mode == "walk" {
		leave = timings[0].dep
	}
	return timings[f].dep, leaveByTime(leave), true
}

// jrCatchSlack is the slack the planner leaves before the first ride (the
// backend's deferOriginWalk buffer) - set off within it of the leave time
// and the ride can still be made.
const jrCatchSlack = 2 * time.Minute

// jrNotifyLeaveTimePassed tells a rider whose leave time has just moved
// into the past (the ride is running early) what to do, aiming to get them
// there close to the time they planned: leave now if the ride can still be
// made - or leave when they planned to on another way that arrives about
// then - else that it can't, with the way that arrives soonest. Tapping it
// opens the journey offered.
//
// With the journey's Live Activity running, its own "Time to leave" (and
// its offer) covers the leave-now case.
func jrNotifyLeaveTimePassed(db *Database, r JourneyReminder, plan gtfs.JourneyPlan, havePlan, laExists bool, departTime time.Time, access int64, region string, tz *time.Location, now time.Time, findNext nextJourneyFinder) {
	route := orLabel(r.RouteShortName, "your service")
	from := orLabel(r.BoardStopName, "your stop")
	early := ""
	if r.ScheduledDepartureUnix.Valid {
		if m := int(math.Round(float64(departTime.Unix()-r.ScheduledDepartureUnix.Int64) / 60)); m < 0 {
			early = fmt.Sprintf("The %s is running %d min early. ", route, -m)
		}
	}
	at := departTime.In(tz).Format("3:04pm")
	key := fmt.Sprintf("early-%d", now.Unix()/60)

	if !now.Add(time.Duration(access) * time.Second).After(departTime.Add(jrCatchSlack)) {
		if laExists {
			return
		}
		title := "Leave now for the " + route
		body := fmt.Sprintf("%sIt now departs %s from %s - leave now to make it.", early, at, from)
		if havePlan && findNext != nil {
			if alt, ok := findKeepingLeaveTime(findNext, plan, now, r.BoardTripID.String); ok {
				notifyJourneyReminderClientURL(db, r, key, title, body+" "+keepTimeSummary(alt, plan.ArrivalTime, tz)+" Tap to switch to it.", journeyTrackURL(alt.ID, region))
				return
			}
		}
		notifyJourneyReminderLeave(db, r, key, title, body)
		return
	}

	title := "You'll miss the " + route
	body := fmt.Sprintf("%sIt now leaves %s at %s - too soon to get there.", early, from, at)
	if havePlan && findNext != nil {
		if next, ok := findNext(plan, plan.StartLat, plan.StartLon, now.Add(time.Minute), r.BoardTripID.String); ok {
			notifyJourneyReminderClientURL(db, r, key, title, body+" "+nextJourneySummary(next, plan.ArrivalTime, tz)+" Tap to switch to it.", journeyTrackURL(next.ID, region))
			return
		}
	}
	notifyJourneyReminderClient(db, r, key, title, body+" Tap to find another way.")
}
