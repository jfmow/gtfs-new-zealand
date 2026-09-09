import { toast } from "sonner"
import { getRegionSlug, urlStore } from "@/lib/url-store"
import { fullyEncodeURIComponent } from "@/lib/utils"
import type { LatLng } from "../../map/map"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."

export interface CurrentStop {
    parent_stop_id: string
    child_stop_id: string
    lat: number
    lon: number
    name: string
}

/**
 * The rider's stop id from a departure board can be a parent or a child stop id,
 * and the trip's own stop record may key the same stop the other way - so also
 * fall back to matching on the (unique enough) stop name when it's available.
 */
const matchesRiderStop = (
    candidate: { parent_stop_id: string; child_stop_id: string; name?: string },
    stop: CurrentStop,
) =>
    candidate.parent_stop_id === stop.parent_stop_id ||
    candidate.child_stop_id === stop.child_stop_id ||
    (!!candidate.name && candidate.name === stop.name)

export function findRiderStopTime(
    stopTimes: StopTimes[] | null | undefined,
    currentStop?: CurrentStop,
): StopTimes | undefined {
    if (!currentStop) return undefined
    if (!stopTimes || stopTimes.length === 0) return undefined
    return stopTimes.find((st) => matchesRiderStop(st, currentStop))
}

/**
 * The rider is on this stop's platform waiting for the vehicle. Only meaningful
 * when the tracker was opened from that stop's departure board.
 */
export function findRiderStop(
    stops: ServicesStop[] | null | undefined,
    currentStop?: CurrentStop,
): ServicesStop | undefined {
    if (!currentStop || !stops || stops.length === 0) return undefined
    return stops.find((s) => matchesRiderStop(s, currentStop))
}

/**
 * Sequence lives on the trip's stop list, not on the realtime stop-times payload
 * (that's keyed by stop id only) - so resolve the rider's stop against `stops`.
 */
export function getCurrentStopSequence(
    stops: ServicesStop[] | null | undefined,
    currentStop?: CurrentStop,
): number | undefined {
    return findRiderStop(stops, currentStop)?.sequence
}

/**
 * Live count of stops between the vehicle's next stop and the rider's own stop,
 * shown only while the vehicle is confirmed en route (not sitting at a stop or
 * with an unknown position).
 */
export function getStopsAway(
    vehicle: VehiclesResponse | undefined,
    stops: ServicesStop[] | null | undefined,
    currentStop?: CurrentStop,
): number | undefined {
    if (!vehicle) return undefined
    const currentStopSeq = getCurrentStopSequence(stops, currentStop)
    if (currentStopSeq === undefined) return undefined
    return Math.max(0, currentStopSeq - vehicle.trip.next_stop.sequence)
}

export interface TrackerEta {
    /** Epoch-ms arrival prediction. */
    ms: number
    /** True when this is the ETA to the rider's own stop; false when it's to the vehicle's next stop. */
    atRiderStop: boolean
}

/**
 * Best "time away" prediction: the vehicle's arrival at the rider's own stop when
 * the tracker knows it, otherwise its arrival at its next stop. `undefined` when
 * there's no usable prediction or the position is unreliable.
 */
export function getTrackerEta(
    vehicle: VehiclesResponse | undefined,
    stopTimes: StopTimes[] | null | undefined,
    currentStop?: CurrentStop,
): TrackerEta | undefined {
    if (!vehicle || vehicle.off_course || vehicle.state === "Unknown") return undefined
    if (!stopTimes?.length) return undefined
    const riderStop = findRiderStopTime(stopTimes, currentStop)
    if (riderStop && !riderStop.skipped && !riderStop.passed && riderStop.arrival_time > 0) {
        return { ms: riderStop.arrival_time, atRiderStop: true }
    }

    const next = vehicle.trip.next_stop
    const st = stopTimes.find(
        (s) => s.parent_stop_id === next.parent_stop_id || s.child_stop_id === next.child_stop_id,
    )
    if (st && !st.skipped && st.arrival_time > 0) return { ms: st.arrival_time, atRiderStop: false }
    return undefined
}

/** Bounding box [SW, NE] around a set of stops, for the map's initial fit. */
export function getBoundsFromStops(
    stops: { lat: number; lon: number }[],
): [LatLng, LatLng] {
    if (!Array.isArray(stops) || stops.length === 0) {
        throw new Error("Stops array is empty or invalid.")
    }
    let minLat = stops[0].lat
    let maxLat = stops[0].lat
    let minLng = stops[0].lon
    let maxLng = stops[0].lon
    for (const stop of stops) {
        if (stop.lat < minLat) minLat = stop.lat
        if (stop.lat > maxLat) maxLat = stop.lat
        if (stop.lon < minLng) minLng = stop.lon
        if (stop.lon > maxLng) maxLng = stop.lon
    }
    return [
        [minLat, minLng],
        [maxLat, maxLng],
    ]
}

/** Share this trip via the native share sheet, falling back to copying the link. */
export async function shareTrip(tripId: string, vehicle?: VehiclesResponse) {
    const region = getRegionSlug(urlStore.currentUrl)
    const url = `${window.location.origin}/trip?tripId=${fullyEncodeURIComponent(tripId)}&region=${region}`
    if (navigator.share) {
        try {
            await navigator.share({
                title: vehicle ? `${vehicle.route.name} - ${vehicle.trip.headsign}` : "Track this trip",
                url,
            })
        } catch {
            // user dismissed the share sheet - not an error
        }
        return
    }
    try {
        await navigator.clipboard.writeText(url)
        toast.success("Link copied to clipboard")
    } catch {
        toast.error("Couldn't copy link - clipboard access was denied")
    }
}

export type { ServicesStop }
