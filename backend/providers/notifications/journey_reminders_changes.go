package notifications

import (
	"fmt"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

// ── "Only if something changes" reminders ────────────────────────────────────
//
// A jrAlertChanges reminder rides along with the leave-by machinery (resolve,
// live leave time, rebook on a cancellation, reroute) but sends none of the
// routine pushes. What it does say, from Offsets[0] minutes before leaving:
//   - the ride running late or early enough to move the leave time
//     (jrChangeThresholdSeconds), with the new one - and again if it moves
//     that much more, or comes back to time;
//   - the ride being cancelled, then the next way to go once it's found;
//   - a service alert on a route, trip or stop the journey uses.

// jrWatchWindow is how long before leaving a "changes" reminder starts
// watching.
func jrWatchWindow(r JourneyReminder) time.Duration {
	return time.Duration(maxOffsetMinutes(r.Offsets)) * time.Minute
}

// jrWatching: the reminder's watch has started - from Offsets[0] before
// the earlier of the leave times in play (a ride now late shouldn't hide a
// change the rider would have wanted to hear at their usual time).
func jrWatching(r JourneyReminder, leaveUnix, prevLeave int64, now time.Time) bool {
	from := leaveUnix
	if prevLeave > 0 && prevLeave < from {
		from = prevLeave
	}
	return !now.Before(time.Unix(from, 0).Add(-jrWatchWindow(r)))
}

// changeCopy is the push for a "changes" reminder whose leave time has moved:
// how late or early the ride is against the timetable, and when to leave now.
func changeCopy(r JourneyReminder, departUnix, leaveUnix int64, tz *time.Location, now time.Time) (title, body string) {
	ride := "Your " + orLabel(r.RouteShortName, "service")
	if r.ScheduledDepartureUnix.Valid {
		ride = fmt.Sprintf("Your %s %s", time.Unix(r.ScheduledDepartureUnix.Int64, 0).In(tz).Format("3:04pm"), orLabel(r.RouteShortName, "service"))
	}
	delayMin := 0
	if r.ScheduledDepartureUnix.Valid {
		delayMin = int(math.Round(float64(departUnix-r.ScheduledDepartureUnix.Int64) / 60))
	}
	switch {
	case delayMin >= 1:
		title = fmt.Sprintf("%s is running %d min late", ride, delayMin)
	case delayMin <= -1:
		title = fmt.Sprintf("%s is running %d min early", ride, -delayMin)
	default:
		title = ride + " is back on time"
	}
	leave := time.Unix(leaveUnix, 0).In(tz)
	mins := int(math.Round(leave.Sub(now).Minutes()))
	if mins <= 0 {
		body = "Leave now."
	} else {
		body = fmt.Sprintf("Leave at %s (in %d min).", leave.Format("3:04pm"), mins)
	}
	return title, body
}

// jrRebooked remembers "changes" reminders whose ride was cancelled, so the
// next resolve says what replaced it ("<id>" -> service date). Lost on a
// restart - the rider then just isn't told the replacement.
var (
	jrRebookedMu sync.Mutex
	jrRebooked   = map[int]string{}
)

func jrMarkRebooked(r JourneyReminder) {
	jrRebookedMu.Lock()
	defer jrRebookedMu.Unlock()
	jrRebooked[r.Id] = r.ServiceDate
}

// jrTakeRebooked reports (once) whether r's ride was cancelled this occurrence.
func jrTakeRebooked(r JourneyReminder) bool {
	jrRebookedMu.Lock()
	defer jrRebookedMu.Unlock()
	sd, ok := jrRebooked[r.Id]
	delete(jrRebooked, r.Id)
	return ok && sd == r.ServiceDate
}

// rebookedCopy tells a "changes" reminder's rider what replaces a cancelled
// ride.
func rebookedCopy(plan gtfs.JourneyPlan, tz *time.Location, now time.Time) (title, body string, ok bool) {
	bt := firstTransitLeg(plan)
	if bt == nil {
		return "", "", false
	}
	title = fmt.Sprintf("Take the %s at %s instead", planRouteLabel(plan), clock(inTZ(bt.DepartureTime, tz)))
	leave := inTZ(plannedLeave(plan), tz)
	lead := "Leave at " + clock(leave)
	if !leave.After(now) {
		lead = "Leave now"
	}
	body = fmt.Sprintf("%s for %s, arriving %s.", lead, stopLabel(bt.FromStop), clock(inTZ(plan.ArrivalTime, tz)))
	return title, body, true
}

func planViewURL(planID, region string) string {
	return "/journey?id=" + url.QueryEscape(planID) + "&region=" + url.QueryEscape(region)
}

// commuteAlert is a service alert that touches a journey.
type commuteAlert struct {
	ID     string
	Header string
	Detail string
}

// commuteAlerts is the alerts naming a route, trip or boarding/alighting
// stop (or its station) one of plan's rides uses, in force at some point
// between from and to. Alerts with no effect on service are left out.
func commuteAlerts(alerts realtime.AlertMap, plan gtfs.JourneyPlan, from, to time.Time) []commuteAlert {
	if len(alerts) == 0 {
		return nil
	}
	routes, trips, stops := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, leg := range plan.Legs {
		if leg.Mode == "walk" {
			continue
		}
		if leg.RouteID != "" {
			routes[leg.RouteID] = true
		}
		if leg.TripID != "" {
			trips[leg.TripID] = true
		}
		for _, s := range []*gtfs.Stop{leg.FromStop, leg.ToStop} {
			if s == nil {
				continue
			}
			if s.StopId != "" {
				stops[s.StopId] = true
			}
			if s.ParentStation != "" {
				stops[s.ParentStation] = true
			}
		}
	}

	var out []commuteAlert
	for id, a := range alerts {
		if a == nil || a.GetEffect() == proto.Alert_NO_EFFECT || !alertInForce(a, from, to) {
			continue
		}
		touches := false
		for _, e := range a.GetInformedEntity() {
			if routes[e.GetRouteId()] || trips[e.GetTrip().GetTripId()] || stops[e.GetStopId()] {
				// A stop-only entity naming a route the journey doesn't use
				// is about a different service at that stop.
				if e.GetStopId() != "" && e.GetRouteId() != "" && !routes[e.GetRouteId()] {
					continue
				}
				touches = true
				break
			}
		}
		if !touches {
			continue
		}
		header := strings.TrimSpace(firstTranslation(a.GetHeaderText()))
		if header == "" {
			continue
		}
		out = append(out, commuteAlert{ID: id, Header: header, Detail: strings.TrimSpace(firstTranslation(a.GetDescriptionText()))})
	}
	return out
}

// alertInForce: one of a's active periods overlaps [from, to] - or it has
// none, which GTFS-RT reads as always.
func alertInForce(a *proto.Alert, from, to time.Time) bool {
	periods := a.GetActivePeriod()
	if len(periods) == 0 {
		return true
	}
	for _, p := range periods {
		start, end := int64(p.GetStart()), int64(p.GetEnd())
		if (start == 0 || start <= to.Unix()) && (end == 0 || end >= from.Unix()) {
			return true
		}
	}
	return false
}

// commuteAlertCopy is the push for a service alert on a reminder's journey.
func commuteAlertCopy(r JourneyReminder, a commuteAlert) (title, body string) {
	title = "Service alert on your journey"
	if r.EndLabel != "" {
		title = "Service alert on your trip to " + r.EndLabel
	}
	body = a.Header
	if a.Detail != "" && a.Detail != a.Header {
		detail := a.Detail
		if runes := []rune(detail); len(runes) > 160 {
			detail = strings.TrimSpace(string(runes[:157])) + "..."
		}
		body += " - " + detail
	}
	return title, body
}

// jrNotifyCommuteAlerts pushes each service alert on a "changes" reminder's
// journey once per occurrence.
func jrNotifyCommuteAlerts(db *Database, r JourneyReminder, plan gtfs.JourneyPlan, alerts realtime.AlertMap) {
	for _, a := range commuteAlerts(alerts, plan, plannedLeave(plan), plan.ArrivalTime) {
		if !jrRerouteOnce(fmt.Sprintf("%d:%s:alert:%s", r.Id, r.ServiceDate, a.ID)) {
			continue
		}
		title, body := commuteAlertCopy(r, a)
		notifyJourneyReminderClient(db, r, "alert-"+a.ID, title, body)
	}
}
