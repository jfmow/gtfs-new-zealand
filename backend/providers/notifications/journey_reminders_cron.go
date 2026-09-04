package notifications

import (
	"context"
	"fmt"
	"math"
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
	tz *time.Location,
	region, osrmURL string,
	now time.Time,
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

	jrCronResolve(db, gtfsData, &rt, tz, region, osrmURL, now)
	jrCronNotify(db, updates, tz, region, now)
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
		access := int(boardDeparture.Sub(plan.DepartureTime).Seconds())
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

func jrCronNotify(db *Database, updates realtime.TripUpdatesMap, tz *time.Location, region string, now time.Time) {
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
		leaveUnix := departUnix - access
		leaveTime := time.Unix(leaveUnix, 0).In(tz)
		departTime := time.Unix(departUnix, 0).In(tz)
		minsUntilLeave := int(math.Round(time.Until(leaveTime).Minutes()))
		minsUntilDeparture := int(math.Round(time.Until(departTime).Minutes()))

		sent := append([]int(nil), r.SentOffsets...)
		offsets := sortedDescInts(r.Offsets)
		ladderStarted := len(sent) > 0
		baseline := r.BaselineLeaveUnix.Int64
		changed := false

		// (a) re-notify on a meaningful shift once the ladder has started
		if ladderStarted && baseline > 0 && absInt64(leaveUnix-baseline) >= jrReNotifyThresholdSeconds && leaveTime.After(now) {
			dir := "later"
			if leaveUnix < baseline {
				dir = "earlier"
			}
			notifyJourneyReminderClient(db, r, fmt.Sprintf("shift-%d", now.Unix()/60), "Leave time updated",
				fmt.Sprintf("The %s is running %s. New leave time %s (in %d min).",
					orLabel(r.RouteShortName, "your service"), dir, leaveTime.Format("3:04pm"), maxInt(0, minsUntilLeave)))

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
		fireMins := -1
		for _, o := range offsets {
			if containsInt(sent, o) {
				continue
			}
			if now.Unix() >= leaveUnix-int64(o)*60 {
				fireMins = o // offsets are sorted desc, so the last write is the smallest rung
				sent = append(sent, o)
				changed = true
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
			notifyJourneyReminderClient(db, r, fmt.Sprintf("leave-%d", fireMins), title, body)
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

// ── shared helpers ───────────────────────────────────────────────────────────

// notifyJourneyReminderClient sends a push and records it in the in-app history.
// eventKey makes the history entry id unique per push (jr-<id>-<eventKey>) so
// each "leave in 30 / 15 / 5" etc. shows as its own row.
func notifyJourneyReminderClient(db *Database, r JourneyReminder, eventKey, title, body string) {
	client, err := db.FindNotificationClientById(r.ClientId)
	if err != nil {
		return
	}
	url := r.Deeplink
	if url == "" {
		url = "/plan"
	}
	if err := client.SendNotification(body, title, map[string]string{"url": url}, "high"); err == nil {
		_ = client.AppendToRecentNotifications(fmt.Sprintf("jr-%d-%s", r.Id, eventKey), title, body, url)
	}
}

func buildJourneyRequest(r JourneyReminder, osrmURL string, rt *realtime.Realtime, tz *time.Location) gtfs.JourneyRequest {
	req := gtfs.JourneyRequest{
		StartLat:        r.StartLat,
		StartLon:        r.StartLon,
		EndLat:          r.EndLat,
		EndLon:          r.EndLon,
		MaxWalkKm:       r.MaxWalkKm,
		WalkSpeedKmph:   r.WalkSpeed,
		MaxTransfers:    r.MaxTransfers,
		MaxNearbyStops:  50,
		MaxResults:      5,
		MinResults:      3,
		OsrmURL:         osrmURL,
		IncludeChildren: true,
		Realtime:        rt,
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
