import { useEffect, useRef, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import type { VehiclesResponse } from "@/components/services/tracker"

const REFRESH_INTERVAL = 10 // seconds

// Consecutive failed polls (not counting a legitimate "no vehicles" 404)
// before surfacing a connection-lost state - one blip shouldn't flash a
// banner, but ~2 misses in a row is a real drop, not noise.
const FAILURE_THRESHOLD = 2

/** Compact fingerprint of a poll result - only the fields that actually drive the UI. */
function vehiclesSignature(byTripId: Record<string, VehiclesResponse>): string {
    return Object.keys(byTripId)
        .sort()
        .map((id) => {
            const v = byTripId[id]
            return `${id}:${v.position.lat},${v.position.lon},${v.position.bearing},${v.state}`
        })
        .join("|")
}

/**
 * Polls live positions for every transit leg of a journey at once.
 * Mirrors useServiceTracker's visibility-aware polling, without the
 * single-trip stop-times fallback (the journey response already carries
 * FromStop/ToStop for every leg).
 */
export function useJourneyVehicles(tripIds: string[], active: boolean) {
    const [vehiclesByTripId, setVehiclesByTripId] = useState<Record<string, VehiclesResponse>>({})
    const [refreshing, setRefreshing] = useState(false)
    // True once polls have been failing for a while - distinct from a
    // legitimate "no vehicles running yet" result, which resolves fine and
    // isn't an error at all.
    const [connectionLost, setConnectionLost] = useState(false)
    const consecutiveFailuresRef = useRef(0)
    const tripIdsKey = tripIds.join(",")

    // Each 10s poll builds a brand-new object even when nothing moved; applying
    // it unconditionally would re-render every consumer (and, downstream,
    // rebuild map layers). Skip the setState when the fingerprint is unchanged.
    const lastSignatureRef = useRef<string>("")

    // Kept in a ref so the interval/visibility handler always sees the latest
    // ids without needing to be torn down and rebuilt on every render.
    const tripIdsRef = useRef(tripIds)
    tripIdsRef.current = tripIds

    // Guards against out-of-order poll resolution: a slow request can resolve
    // after a later, faster one and would otherwise silently overwrite fresher
    // position data with stale data. Only ever apply the result of the most
    // recently *issued* request that has resolved so far.
    const requestIdRef = useRef(0)
    const appliedIdRef = useRef(0)

    useEffect(() => {
        const apply = (byTripId: Record<string, VehiclesResponse>) => {
            const signature = vehiclesSignature(byTripId)
            if (signature === lastSignatureRef.current) return
            lastSignatureRef.current = signature
            setVehiclesByTripId(byTripId)
        }

        if (!active || !tripIdsKey) {
            apply({})
            consecutiveFailuresRef.current = 0
            setConnectionLost(false)
            return
        }

        let cancelled = false

        async function getData(isRefresh = false) {
            const requestId = ++requestIdRef.current
            if (isRefresh) setRefreshing(true)
            try {
                const res = await ApiFetch<VehiclesResponse[]>(
                    `realtime/live?tripId=${tripIdsRef.current.map(fullyEncodeURIComponent).join(",")}`,
                    { method: "GET" }
                )
                if (cancelled || requestId < appliedIdRef.current) return
                if (!res.ok) {
                    if (res.status_code === 404) {
                        // "no vehicles found" is a legitimate state (legs not yet in
                        // service), not an error - clear rather than surface it.
                        consecutiveFailuresRef.current = 0
                        setConnectionLost(false)
                        appliedIdRef.current = requestId
                        apply({})
                        return
                    }
                    // A real failure (network drop, server error) - keep the last
                    // known positions on screen rather than blanking the map, and
                    // only surface a connection-lost state once it's persisted
                    // past a single blip.
                    consecutiveFailuresRef.current += 1
                    if (consecutiveFailuresRef.current >= FAILURE_THRESHOLD) setConnectionLost(true)
                    appliedIdRef.current = requestId
                    return
                }
                consecutiveFailuresRef.current = 0
                setConnectionLost(false)
                const byTripId: Record<string, VehiclesResponse> = {}
                for (const v of res.data) {
                    byTripId[v.trip_id] = v
                }
                appliedIdRef.current = requestId
                apply(byTripId)
            } catch (error) {
                console.error("Error fetching journey vehicles:", error)
                consecutiveFailuresRef.current += 1
                if (consecutiveFailuresRef.current >= FAILURE_THRESHOLD) setConnectionLost(true)
            } finally {
                if (isRefresh && !cancelled) setRefreshing(false)
            }
        }

        let intervalId: NodeJS.Timeout | null = null

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                getData(true)
                intervalId = setInterval(() => getData(true), REFRESH_INTERVAL * 1000)
            } else if (intervalId) {
                clearInterval(intervalId)
            }
        }

        getData()
        handleVisibilityChange()
        document.addEventListener("visibilitychange", handleVisibilityChange)

        return () => {
            cancelled = true
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalId) clearInterval(intervalId)
        }
    }, [tripIdsKey, active])

    return { vehiclesByTripId, refreshing, connectionLost }
}
