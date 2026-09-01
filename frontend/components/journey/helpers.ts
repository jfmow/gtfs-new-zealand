import type { ServicesStop, StopTimes } from "@/components/services/tracker"
import { RealtimeStatus, type Leg, type JourneyType, type Stop } from "./types"

/**
 * Finds a journey leg's board/alight stop within a tracked trip's own stop list,
 * matching by ID rather than sequence (Leg.FromStop/ToStop.stop_sequence is never
 * populated by /services/plan). Returns the trustworthy `sequence` from the
 * trip's stop list.
 */
export function findStopSequence(
    stops: ServicesStop[] | null | undefined,
    legStop: Stop | null | undefined
): number | undefined {
    if (!legStop || !stops) return undefined
    const match = stops.find(
        (s) => s.parent_stop_id === legStop.parent_station || s.child_stop_id === legStop.stop_id
    )
    return match?.sequence
}

export function getFirstTransitLeg(route: JourneyType): Leg | null {
    return route.Legs.find(l => l.Mode === 'transit') ?? null
}

export function getLastTransitLeg(route: JourneyType): Leg | null {
    const legs = route.Legs.filter(l => l.Mode === 'transit')
    return legs[legs.length - 1] ?? null
}

export function formatTime(dateString: string | Date) {
    return new Date(dateString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

export function formatDuration(nanoseconds: number) {
    // Guard against inconsistent realtime data producing a negative span
    // (e.g. a leg whose adjusted arrival lands before its departure).
    const minutes = Math.max(0, Math.round(nanoseconds / 60000000000))
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
}

export function formatTimeWithRealtime(actual: Date, scheduled?: Date, status?: RealtimeStatus): React.ReactNode {
    const actualStr = formatTime(actual)
    const isDelayed = status === RealtimeStatus.Delayed
    const isEarly = status === RealtimeStatus.Early
    if ((isDelayed || isEarly) && scheduled) {
        const scheduledStr = formatTime(scheduled)
        if (scheduledStr !== actualStr) {
            return scheduledStr
        }
    }
    return actualStr
}

function stopTimeFor(stopTimes: StopTimes[], legStop: Stop | null, targetMs: number): StopTimes | undefined {
    if (!legStop) return undefined
    const matches = stopTimes.filter(
        (s) =>
            s.child_stop_id === legStop.stop_id ||
            (!!legStop.parent_station && s.parent_stop_id === legStop.parent_station) ||
            s.parent_stop_id === legStop.stop_id
    )
    if (matches.length <= 1) return matches[0]
    // A trip can visit the same stop/station twice (line reversals) - pick the
    // occurrence whose time is closest to the plan leg's own time for this stop.
    const t = (s: StopTimes) => s.scheduled_time || s.arrival_time || s.departure_time
    return matches.reduce((best, s) => (Math.abs(t(s) - targetMs) < Math.abs(t(best) - targetMs) ? s : best))
}

/**
 * Returns a copy of `route` with each leg's Departure/Arrival/Duration - and the
 * journey-level totals - shifted to realtime predictions where available.
 * Transit legs take their board departure / alight arrival from
 * `realtime/stop-times`; walk legs are re-anchored to the adjacent transit leg
 * (their duration is fixed); waits fall out of the shifted times. Returns the
 * original `route` unchanged if nothing usable is available.
 */
export function buildLiveJourney(
    route: JourneyType,
    stopTimesByTripId: Record<string, StopTimes[]>
): JourneyType {
    if (Object.keys(stopTimesByTripId).length === 0) return route

    const legs = route.Legs.map((l) => ({ ...l }))
    let changed = false

    legs.forEach((leg, i) => {
        if (leg.Mode !== "transit" || !leg.TripID) return
        const st = stopTimesByTripId[leg.TripID]
        if (!st) return
        const board = stopTimeFor(st, leg.FromStop, new Date(leg.DepartureTime).getTime())
        const alight = stopTimeFor(st, leg.ToStop, new Date(leg.ArrivalTime).getTime())
        if (!board?.departure_time || !alight?.arrival_time) return

        const depart = new Date(board.departure_time)
        const arrive = new Date(Math.max(alight.arrival_time, board.departure_time))
        legs[i].DepartureTime = depart
        legs[i].ArrivalTime = arrive
        legs[i].Duration = (arrive.getTime() - depart.getTime()) * 1_000_000

        if (alight.scheduled_time) {
            const delay = Math.round((alight.arrival_time - alight.scheduled_time) / 1000)
            legs[i].delay_seconds = delay
            legs[i].realtime_status =
                delay > 60 ? RealtimeStatus.Delayed : delay < -60 ? RealtimeStatus.Early : RealtimeStatus.OnTime
        }
        changed = true
    })

    if (!changed) return route

    // Re-anchor walk legs (fixed duration) to their transit neighbour.
    legs.forEach((leg, i) => {
        if (leg.Mode !== "walk") return
        const durMs = route.Legs[i].Duration / 1_000_000
        const next = legs[i + 1]
        const prev = legs[i - 1]
        if (next?.Mode === "transit") {
            // Leading walk: match the backend's deferOriginWalk (arrive ~2 min
            // before the train, not the instant it leaves). A transfer walk
            // stays tight so the buffer can't overlap the previous leg.
            const buffer = i === 0 ? 120_000 : 0
            const arrive = new Date(new Date(next.DepartureTime).getTime() - buffer)
            legs[i].ArrivalTime = arrive
            legs[i].DepartureTime = new Date(arrive.getTime() - durMs)
        } else if (prev?.Mode === "transit") {
            const depart = new Date(prev.ArrivalTime)
            legs[i].DepartureTime = depart
            legs[i].ArrivalTime = new Date(depart.getTime() + durMs)
        }
    })

    const departure = new Date(legs[0].DepartureTime)
    const arrival = new Date(legs[legs.length - 1].ArrivalTime)
    return {
        ...route,
        Legs: legs,
        DepartureTime: departure,
        ArrivalTime: arrival,
        TotalDuration: (arrival.getTime() - departure.getTime()) * 1_000_000,
    }
}

export type ConnectionRisk = { level: "missed" | "tight"; transferMin: number }

// Minimum realistic time to change services (matches the planner's own gate).
const MIN_TRANSFER_MS = 60_000

/**
 * For the transit leg at `index`, checks whether the current (live) times still
 * leave enough time to transfer from the previous transit leg — walking legs in
 * between count against the gap. Returns null for the first ride (the rider
 * chooses when to leave) or when there's comfortable slack. `transferMin` is the
 * minutes actually available on the platform (negative = you arrive after it
 * has left).
 */
export function connectionRisk(legs: Leg[], index: number): ConnectionRisk | null {
    const leg = legs[index]
    if (!leg || leg.Mode !== "transit") return null

    let prevTransit = -1
    for (let i = index - 1; i >= 0; i--) {
        if (legs[i].Mode === "transit") { prevTransit = i; break }
        if (legs[i].Mode === "walk") continue
        break
    }
    if (prevTransit < 0) return null

    let walkMs = 0
    for (let i = prevTransit + 1; i < index; i++) {
        if (legs[i].Mode === "walk") walkMs += legs[i].Duration / 1_000_000
    }

    const gapMs = new Date(leg.DepartureTime).getTime() - new Date(legs[prevTransit].ArrivalTime).getTime()
    const slackMs = gapMs - walkMs - MIN_TRANSFER_MS
    if (slackMs >= 90_000) return null

    return { level: slackMs < 0 ? "missed" : "tight", transferMin: Math.round((gapMs - walkMs) / 60_000) }
}

export function getWaitingTimeNs(prev: Leg, next: Leg) {
    const arrival = new Date(prev.ArrivalTime).getTime()
    const departure = new Date(next.DepartureTime).getTime()

    const diffMs = departure - arrival
    if (diffMs <= 0) return null

    return diffMs * 1_000_000
}

/** Trip IDs of every transit leg in a journey, in order, de-duplicated. */
export function getTransitTripIds(route: JourneyType): string[] {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const leg of route.Legs) {
        if (leg.Mode === 'transit' && leg.TripID && !seen.has(leg.TripID)) {
            seen.add(leg.TripID)
            ids.push(leg.TripID)
        }
    }
    return ids
}

/** Unique route IDs of every transit leg in a journey, for alert lookups. */
export function getTransitRouteIds(route: JourneyType): string[] {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const leg of route.Legs) {
        if (leg.Mode === 'transit' && leg.RouteID && !seen.has(leg.RouteID)) {
            seen.add(leg.RouteID)
            ids.push(leg.RouteID)
        }
    }
    return ids
}
