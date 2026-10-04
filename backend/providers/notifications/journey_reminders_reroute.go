package notifications

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/providers/planlimit"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// ── PASS 3 — reroute on a significant delay ──────────────────────────────────
//
// A resolved reminder follows its ride's live delay (PASS 2), but that alone
// can still make the rider late: an arrive-by journey whose ride is running
// late arrives after the time they asked for. Here, while there's still time
// before leaving, a late journey is re-planned with realtime and a faster one
// offered. Before the journey's Live Activity has started the reminder
// switches to it (so every later push and the card follow the new journey);
// after, the new journey is only offered as a link.

const (
	// An arrive-by journey predicted to arrive this much after the target
	// is "late".
	jrLateArrivalSeconds = 60
	// Any journey whose ride is this late is worth a look, even with no
	// arrive-by target.
	jrRerouteDelaySeconds = 10 * 60
	// Only look while the rider hasn't set off and there's time to act.
	jrRerouteWindow = 90 * time.Minute
	// An alternative must arrive at least this much earlier, and leave no
	// sooner than this from now.
	jrRerouteMinGain   = 5 * time.Minute
	jrRerouteMinNotice = 2 * time.Minute
	// Re-plan a given reminder at most this often, and this many per tick
	// (RAPTOR is heavy).
	jrRerouteEvery   = 5 * time.Minute
	jrReroutePerTick = 2
)

var (
	jrRerouteMu      sync.Mutex
	jrRerouteChecked = map[int]time.Time{} // reminder id -> last re-plan
	jrRerouteTold    = map[string]bool{}   // "<id>:<service date>:<what>" -> pushed
)

func jrRerouteDue(id int, now time.Time) bool {
	jrRerouteMu.Lock()
	defer jrRerouteMu.Unlock()
	if last, ok := jrRerouteChecked[id]; ok && now.Sub(last) < jrRerouteEvery {
		return false
	}
	jrRerouteChecked[id] = now
	return true
}

// jrRerouteOnce reports whether key hasn't been pushed yet, marking it.
func jrRerouteOnce(key string) bool {
	jrRerouteMu.Lock()
	defer jrRerouteMu.Unlock()
	if jrRerouteTold[key] {
		return false
	}
	if len(jrRerouteTold) > 10000 { // days-old keys; forgetting them is harmless
		jrRerouteTold = map[string]bool{}
	}
	jrRerouteTold[key] = true
	return true
}

func jrCronReroute(
	db *Database,
	gtfsData gtfs.Database,
	rt *realtime.Realtime,
	updates realtime.TripUpdatesMap,
	tz *time.Location,
	region, osrmURL string,
	planLookup func(id string) (gtfs.JourneyPlan, bool),
	planPut func(gtfs.JourneyPlan),
	now time.Time,
) {
	if updates == nil || planLookup == nil {
		return
	}
	rows, err := db.GetArmedJourneyReminders(region)
	if err != nil {
		return
	}

	planned := 0
	for _, r := range rows {
		if planned >= jrReroutePerTick {
			return
		}
		if !r.ScheduledDepartureUnix.Valid || !r.AccessSeconds.Valid || !r.BoardTripID.Valid {
			continue
		}
		plan, ok := planLookup(reminderPlanID(r))
		if !ok {
			continue
		}
		// On the way already: a faster journey from the start is no use,
		// and "we'll keep your leave time up to date" no longer applies.
		if _, leftUnix, _ := db.LiveActivityDeparture(r.ClientId, plan.ID, now); leftUnix > 0 {
			continue
		}

		boardDelay := 0
		if tu := tripUpdateFor(updates, r.BoardTripID.String, r.ServiceDate); tu != nil {
			boardDelay, _ = boardStopDelay(tu, int(r.BoardStopSequence.Int64), r.BoardStopID.String)
		}
		boardDelay = clampJRDelay(boardDelay)
		leave := time.Unix(r.ScheduledDepartureUnix.Int64+int64(boardDelay)-r.AccessSeconds.Int64, 0)
		if !leave.After(now) || leave.Sub(now) > jrRerouteWindow {
			continue
		}

		arrive := predictedArrival(plan, updates, r.ServiceDate, boardDelay)
		var arriveBy time.Time
		late := boardDelay >= jrRerouteDelaySeconds
		if r.TimeType == "arriveat" {
			if u, hErr := hhmmToUnix(r.ServiceDate, r.TargetHHMM, tz); hErr == nil {
				arriveBy = time.Unix(u, 0)
				if arrive.Sub(arriveBy) >= jrLateArrivalSeconds*time.Second {
					late = true
				}
			}
		}
		if !late || !jrRerouteDue(r.Id, now) {
			continue
		}
		planned++

		alt, found := jrFindFasterJourney(gtfsData, rt, r, osrmURL, tz, arriveBy, leave, arrive, now)
		route := orLabel(r.RouteShortName, "your service")
		title := fmt.Sprintf("Your %s is running %d min late", route, (boardDelay+30)/60)
		if boardDelay < 60 {
			title = fmt.Sprintf("You'll arrive after %s", arriveBy.In(tz).Format("3:04pm"))
		}
		lateBy := ""
		if !arriveBy.IsZero() && arrive.After(arriveBy) {
			lateBy = fmt.Sprintf("You'd arrive %s, %d min after %s. ",
				arrive.In(tz).Format("3:04pm"), int(arrive.Sub(arriveBy).Minutes()+0.5), arriveBy.In(tz).Format("3:04pm"))
		}

		if !found {
			if jrRerouteOnce(fmt.Sprintf("%d:%s:none", r.Id, r.ServiceDate)) && lateBy != "" {
				notifyJourneyReminderLeave(db, r, fmt.Sprintf("late-%d", now.Unix()/60), title,
					lateBy+"There's no faster way right now - we'll keep your leave time up to date.")
			}
			continue
		}
		if !jrRerouteOnce(fmt.Sprintf("%d:%s:%s", r.Id, r.ServiceDate, alt.ID)) {
			continue
		}

		if planPut != nil {
			planPut(alt)
		}
		altRoute := planRouteLabel(alt)
		summary := fmt.Sprintf("the %s: leave %s, arrive %s", altRoute,
			alt.DepartureTime.In(tz).Format("3:04pm"), alt.ArrivalTime.In(tz).Format("3:04pm"))

		// replace=1: the app ends whatever journey it's tracking (and closes
		// its tracker) before opening this one - it's the rider's same trip.
		link := "/journey?id=" + alt.ID + "&region=" + region + "&replace=1"
		if !r.LAStarted && jrSwitchReminder(db, gtfsData, r, alt, now) {
			r.PlanID = alt.ID
			notifyJourneyReminderClientURL(db, r, fmt.Sprintf("reroute-%d", now.Unix()/60), title,
				lateBy+"We've switched your reminder to "+summary+".", link)
			continue
		}
		notifyJourneyReminderClientURL(db, r, fmt.Sprintf("reroute-%d", now.Unix()/60), title,
			lateBy+"Faster: "+summary+". Tap to see it.", link)
	}
}

func tripUpdateFor(updates realtime.TripUpdatesMap, tripID, serviceDate string) *proto.TripUpdate {
	tu, err := updates.ByTripID(tripID)
	if err != nil || tu == nil {
		return nil
	}
	if sd := tu.GetTrip().GetStartDate(); sd != "" && sd != serviceDate {
		return nil
	}
	return tu
}

// predictedArrival is when the rider gets to the destination on plan given
// the feed: the last ride's arrival delay at its alighting stop (or, without
// an update for that ride, the first ride's boarding delay carried through),
// plus the walk after it.
func predictedArrival(plan gtfs.JourneyPlan, updates realtime.TripUpdatesMap, serviceDate string, boardDelay int) time.Time {
	last := -1
	for i := range plan.Legs {
		if plan.Legs[i].Mode == "transit" {
			last = i
		}
	}
	if last < 0 {
		return plan.ArrivalTime
	}
	leg := plan.Legs[last]
	delay := boardDelay
	if tu := tripUpdateFor(updates, leg.TripID, serviceDate); tu != nil && leg.ToStop != nil {
		delay, _ = boardStopDelay(tu, 0, leg.ToStop.StopId)
		delay = clampJRDelay(delay)
	}
	tail := plan.ArrivalTime.Sub(leg.ArrivalTime)
	return scheduledArrival(leg).Add(time.Duration(delay)*time.Second + tail)
}

// jrFindFasterJourney re-plans r with realtime and returns the soonest-
// arriving journey that beats `arrive` by jrRerouteMinGain on a different
// first ride, and that the rider can still leave for.
func jrFindFasterJourney(gtfsData gtfs.Database, rt *realtime.Realtime, r JourneyReminder, osrmURL string, tz *time.Location, arriveBy, leave, arrive, now time.Time) (gtfs.JourneyPlan, bool) {
	q := r
	if !arriveBy.IsZero() {
		q.TargetUnix = arriveBy.Unix()
	} else {
		// Depart-at: set off when the rider meant to (their original leave
		// time), or now if that's gone.
		q.TimeType = "departat"
		start := time.Unix(r.ScheduledDepartureUnix.Int64-r.AccessSeconds.Int64, 0)
		if earliest := now.Add(jrRerouteMinNotice); start.Before(earliest) {
			start = earliest
		}
		q.TargetUnix = start.Unix()
	}
	req := buildJourneyRequest(q, osrmURL, rt, tz)
	plans, err := func() (*[]gtfs.JourneyPlan, error) {
		planlimit.Acquire(context.Background())
		defer planlimit.Release()
		return gtfsData.PlanJourneyRaptor(req)
	}()
	if err != nil || plans == nil {
		return gtfs.JourneyPlan{}, false
	}

	var best gtfs.JourneyPlan
	found := false
	for _, p := range *plans {
		bt := firstTransitLeg(p)
		if bt == nil || bt.FromStop == nil || p.ID == "" || bt.TripID == r.BoardTripID.String {
			continue
		}
		if p.DepartureTime.Before(now.Add(jrRerouteMinNotice)) || arrive.Sub(p.ArrivalTime) < jrRerouteMinGain {
			continue
		}
		if !found || p.ArrivalTime.Before(best.ArrivalTime) {
			best, found = p, true
		}
	}
	return best, found
}

// jrSwitchReminder points r at alt: its boarding ride, leave time and plan.
// Rungs of the "leave in" ladder already sent stay sent where the new leave
// time has also passed them, so the rider isn't told "leave in 30" twice.
func jrSwitchReminder(db *Database, gtfsData gtfs.Database, r JourneyReminder, alt gtfs.JourneyPlan, now time.Time) bool {
	bt := firstTransitLeg(alt)
	if bt == nil || bt.FromStop == nil {
		return false
	}
	stops, _, err := gtfsData.GetStopsForTripID(bt.TripID)
	if err != nil {
		return false
	}
	seq := -1
	for _, s := range stops {
		if s.StopId == bt.FromStop.StopId {
			seq = s.Sequence
			break
		}
	}
	if seq < 0 {
		return false
	}
	board := bt.ScheduledDepartureTime
	if board.IsZero() {
		board = bt.DepartureTime
	}
	// Walk/wait before boarding, live to live (both sides carry the delay).
	access := int64(bt.DepartureTime.Sub(alt.DepartureTime).Seconds())
	if access < 0 {
		access = 0
	}
	// Leave by the live time (alt's own departure), not the timetable's.
	leaveUnix := alt.DepartureTime.Unix()

	if db.UpdateJourneyReminderResolved(r.Id, bt.TripID, bt.FromStop.StopId, seq,
		board.Unix(), access, leaveUnix, planRouteLabel(alt), bt.FromStop.StopName) != nil {
		return false
	}
	_ = db.SetJourneyReminderPlanID(r.Id, alt.ID)

	var kept []int
	for _, o := range r.SentOffsets {
		if now.Unix() >= leaveUnix-int64(o)*60 {
			kept = append(kept, o)
		}
	}
	if len(kept) > 0 {
		_ = db.UpdateJourneyReminderState(r.Id, "notifying", kept, leaveUnix)
	}
	return true
}

func planRouteLabel(p gtfs.JourneyPlan) string {
	bt := firstTransitLeg(p)
	if bt == nil {
		return "new journey"
	}
	if bt.Route != nil && bt.Route.RouteShortName != "" {
		return bt.Route.RouteShortName
	}
	return bt.RouteID
}

// notifyJourneyReminderClientURL is notifyJourneyReminderClient with a tap
// target other than the reminder's own link (a new journey).
func notifyJourneyReminderClientURL(db *Database, r JourneyReminder, eventKey, title, body, url string) {
	client, err := db.FindNotificationClientById(r.ClientId)
	if err != nil {
		return
	}
	if err := client.SendNotification(body, title, map[string]string{"url": url}, "high"); err == nil {
		_ = client.AppendToRecentNotifications(fmt.Sprintf("jr-%d-%s", r.Id, eventKey), title, body, url)
	}
}
