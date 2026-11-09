import { cleanStopName } from "@transit/shared/formatting"
import { laClock } from "@transit/shared/logic/journey-live"
import { connectionRisk, type JourneyProgressSnapshot } from "@transit/shared/logic/tracking"
import type { Vehicle } from "@transit/shared/models"
import type { JourneyType, Leg } from "@transit/shared/types/journey"
import { occupancyShort } from "@/components/departures"
import { legDate, legRouteName } from "@/components/journey"

/**
 * What the journey tracker's drawer says - iOS `JourneyTrackingView`'s hero,
 * countdown and status row, as data. Pure: the screen only picks colours
 * and icons. See docs/journey-planning-and-tracking.md.
 */

export interface Countdown {
    target: Date
    /** "Get off at", "75 leaves", "Arrive at", "Leave from". */
    caption: string
    place: string
    /** Under 2 min to a departure: shown in the warning colour. */
    urgent: boolean
}

export type StatusTone = "danger" | "warning" | "success"
export type StatusIcon = "alert" | "offline" | "gps" | "saved"

export interface StatusItem {
    text: string
    tone?: StatusTone
    icon?: StatusIcon
    /** "Live" - a green dot before the text. */
    liveDot?: boolean
    /** "Updating" - a spinner before the text. */
    spinner?: boolean
}

export interface TrackerSummary {
    /** "Walking to Britomart", "Waiting for the 75", "On the 75 → Newmarket", "You've arrived". */
    headline: string
    /** The line under the headline. */
    subline: string | null
    countdown: Countdown | null
    /** Problems first; the row drops items off the end rather than wrap. */
    status: StatusItem[]
    /** "Find a better route" turns red. */
    replanUrgent: boolean
}

/** Live data older than this shows "Updating" instead of "Live". */
export const LIVE_STALE_MS = 45_000

const name = (l?: Leg) => (l ? legRouteName(l) || "Bus" : "service")
const stopName = (s?: Leg["FromStop"]) => (s?.stop_name ? cleanStopName(s.stop_name) : null)

/** The ride you're on, or the next one you'll catch, from the leg you're on. */
export function activeRide(plan: JourneyType, snap: JourneyProgressSnapshot | null): Leg | undefined {
    return plan.Legs.slice(Math.max(0, snap?.progressLegIndex ?? 0)).find((l) => l.Mode === "transit")
}

export function trackerSummary(args: {
    plan: JourneyType
    snap: JourneyProgressSnapshot | null
    vehicle: Vehicle | undefined
    destination: string
    online: boolean
    lastLiveAt: number | null
    savedOffline: boolean
    now: number
    tz: string
}): TrackerSummary {
    const { plan, snap, vehicle, destination, now, tz } = args
    const legs = plan.Legs
    const idx = Math.max(0, snap?.progressLegIndex ?? 0)
    const currentLeg = snap && snap.progressLegIndex >= 0 ? legs[snap.progressLegIndex] : undefined
    const nextRide = activeRide(plan, snap)

    const headline = (() => {
        if (!snap) return "Your journey"
        if (snap.journeyArrived) return "You've arrived"
        const leg = legs[Math.min(idx, legs.length - 1)]
        if (!leg) return "Tracking"
        switch (snap.phase) {
            case "walking": return leg.ToStop ? `Walking to ${cleanStopName(leg.ToStop.stop_name)}` : idx === legs.length - 1 ? "Almost there" : "Walking"
            case "waiting": return `Waiting for the ${name(leg.Mode === "transit" ? leg : nextRide)}`
            case "boarding": return `Boarding the ${name(leg.Mode === "transit" ? leg : nextRide)}`
            case "onboard": return leg.ToStop ? `On the ${name(leg)} → ${cleanStopName(leg.ToStop.stop_name)}` : `On the ${name(leg)}`
            default: return "Tracking"
        }
    })()

    const countdown: Countdown | null = (() => {
        if (!snap || snap.journeyArrived) return null
        if (snap.phase === "onboard") {
            const a = legDate(currentLeg?.ArrivalTime)
            return a ? { target: a, caption: "Get off at", place: stopName(currentLeg?.ToStop) ?? "your stop", urgent: false } : null
        }
        if (snap.phase) {
            const dep = legDate(nextRide?.DepartureTime)
            if (nextRide && dep && (currentLeg?.Mode === "walk" || currentLeg?.TripID === nextRide.TripID)) {
                return { target: dep, caption: `${name(nextRide)} leaves`, place: stopName(nextRide.FromStop) ?? "the stop", urgent: dep.getTime() - now < 120_000 }
            }
            const arr = legDate(plan.ArrivalTime)
            return arr ? { target: arr, caption: "Arrive at", place: destination, urgent: false } : null
        }
        const d = legDate(plan.DepartureTime)
        return d ? { target: d, caption: "Leave from", place: stopName(legs[0]?.FromStop) ?? "your start", urgent: false } : null
    })()

    const extra = !snap || snap.journeyArrived ? null : snap.phase === "onboard"
        ? (vehicle?.trip?.next_stop?.name ? `Next stop: ${vehicle.trip.next_stop.name}` : null)
        : nextRide?.FromStop?.platform_number ? `Platform ${nextRide.FromStop.platform_number}` : null
    const subline = !snap ? null : snap.journeyArrived ? `at ${destination}` : countdown
        ? `${countdown.caption} ${countdown.place} at ${laClock(countdown.target, tz)}${extra ? `, ${extra.charAt(0).toLowerCase()}${extra.slice(1)}` : ""}`
        : extra

    const risk = snap ? legs.map((_, i) => (i > idx ? connectionRisk(legs, i) : null)).find(Boolean) ?? null : null
    const status: StatusItem[] = []
    if (snap && !snap.journeyArrived && snap.phase) {
        if (nextRide && !nextRide.trip_usable) status.push({ text: "Not running", tone: "danger", icon: "alert" })
        if (risk) status.push({ text: risk.level === "missed" ? "Connection missed" : "Tight connection", tone: risk.level === "missed" ? "danger" : "warning", icon: "alert" })
        if (!args.online) status.push({ text: "Offline", tone: "warning", icon: "offline" })
        const delay = nextRide?.trip_usable ? nextRide.delay_seconds : 0
        if (delay && Math.abs(delay) >= 60) status.push({ text: delay > 0 ? `${Math.floor(delay / 60)} min late` : `${Math.floor(-delay / 60)} min early`, tone: delay > 0 ? "warning" : "success" })
        if (nextRide) {
            const stale = args.lastLiveAt ? now - args.lastLiveAt > LIVE_STALE_MS : false
            if (snap.trackingLevel === "live") status.push(stale ? { text: "Updating", spinner: true } : { text: "Live", liveDot: true })
            else if (snap.trackingLevel === "estimated") status.push({ text: "From GPS", icon: "gps" })
            else if (snap.trackingLevel === "predicted") status.push({ text: "Predicted" })
            else status.push({ text: "Timetable only" })
        }
        if (snap.trackedStopsAway != null && snap.trackedStopsToGo != null) {
            const away = snap.trackedStopsAway
            const atStop = snap.trackedStopsToGo === 0
            status.push({
                text: snap.phase === "onboard"
                    ? (atStop ? "At your stop - get off" : away === 0 ? "Get off at the next stop" : `${away + 1} stops to go`)
                    : (atStop ? `${name(nextRide)} at your stop` : away === 0 ? `${name(nextRide)} arriving` : `${name(nextRide)} is ${away} stop${away === 1 ? "" : "s"} away`),
            })
        }
        const crowd = vehicle && vehicle.occupancy >= 0 ? occupancyShort(vehicle.occupancy) : null
        if (crowd) status.push({ text: crowd })
        if (vehicle?.cars) status.push({ text: `${vehicle.cars} cars` })
        // iOS: until you're on the first ride, say the journey will carry on without signal.
        if (args.online && args.savedOffline && !boardedFirstRide(plan, snap)) status.push({ text: "Saved offline", icon: "saved" })
    }

    return { headline, subline, countdown, status, replanUrgent: !!risk || (!!nextRide && !nextRide.trip_usable) }
}

function boardedFirstRide(plan: JourneyType, snap: JourneyProgressSnapshot): boolean {
    const first = plan.Legs.findIndex((l) => l.Mode === "transit")
    if (first < 0) return true
    return snap.progressLegIndex > first || (snap.progressLegIndex === first && snap.phase === "onboard")
}
