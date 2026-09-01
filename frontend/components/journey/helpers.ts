import type { ServicesStop } from "@/components/services/tracker"
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
