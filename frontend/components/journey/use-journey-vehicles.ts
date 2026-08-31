import { useEffect, useRef, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import type { VehiclesResponse } from "@/components/services/tracker"

const REFRESH_INTERVAL = 10 // seconds

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
    const tripIdsKey = tripIds.join(",")

    // Each 10s poll builds a brand-new object even when nothing moved; applying
    // it unconditionally would re-render every consumer (and, downstream,
    // rebuild map layers). Skip the setState when the fingerprint is unchanged.
    const lastSignatureRef = useRef<string>("")

    // Kept in a ref so the interval/visibility handler always sees the latest
    // ids without needing to be torn down and rebuilt on every render.
    const tripIdsRef = useRef(tripIds)
    tripIdsRef.current = tripIds

    useEffect(() => {
        const apply = (byTripId: Record<string, VehiclesResponse>) => {
            const signature = vehiclesSignature(byTripId)
            if (signature === lastSignatureRef.current) return
            lastSignatureRef.current = signature
            setVehiclesByTripId(byTripId)
        }

        if (!active || !tripIdsKey) {
            apply({})
            return
        }

        let cancelled = false

        async function getData(isRefresh = false) {
            if (isRefresh) setRefreshing(true)
            try {
                const res = await ApiFetch<VehiclesResponse[]>(
                    `realtime/live?tripId=${tripIdsRef.current.map(fullyEncodeURIComponent).join(",")}`,
                    { method: "GET" }
                )
                if (cancelled) return
                if (!res.ok) {
                    // "no vehicles found" is a legitimate state (legs not yet in
                    // service), not an error - clear rather than surface it.
                    apply({})
                    return
                }
                const byTripId: Record<string, VehiclesResponse> = {}
                for (const v of res.data) {
                    byTripId[v.trip_id] = v
                }
                apply(byTripId)
            } catch (error) {
                console.error("Error fetching journey vehicles:", error)
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

    return { vehiclesByTripId, refreshing }
}
