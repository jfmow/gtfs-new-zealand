import { useEffect, useRef, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import type { StopTimes } from "@/components/services/tracker"

const REFRESH_INTERVAL = 20 // seconds - predicted stop times move slowly

function signature(byTripId: Record<string, StopTimes[]>): string {
    return Object.keys(byTripId)
        .sort()
        .map((id) => `${id}:${byTripId[id].map((s) => `${s.child_stop_id}@${s.arrival_time}/${s.departure_time}`).join(",")}`)
        .join("|")
}

/**
 * Polls realtime predicted stop times (`realtime/stop-times`) for every transit
 * leg of a journey while tracking is active - one request per trip, in parallel.
 * Used to keep the itinerary's times moving as the trip runs late/early.
 */
export function useJourneyStopTimes(tripIds: string[], active: boolean) {
    const [stopTimesByTripId, setStopTimesByTripId] = useState<Record<string, StopTimes[]>>({})
    const tripIdsKey = tripIds.join(",")

    const lastSignatureRef = useRef("")
    const tripIdsRef = useRef(tripIds)
    tripIdsRef.current = tripIds

    useEffect(() => {
        const apply = (byTripId: Record<string, StopTimes[]>) => {
            const sig = signature(byTripId)
            if (sig === lastSignatureRef.current) return
            lastSignatureRef.current = sig
            setStopTimesByTripId(byTripId)
        }

        if (!active || !tripIdsKey) {
            apply({})
            return
        }

        let cancelled = false

        async function getData() {
            try {
                const results = await Promise.all(
                    tripIdsRef.current.map(async (tripId) => {
                        const res = await ApiFetch<StopTimes[]>(
                            `realtime/stop-times?tripId=${fullyEncodeURIComponent(tripId)}`,
                            { method: "GET" }
                        )
                        return [tripId, res.ok ? res.data : null] as const
                    })
                )
                if (cancelled) return
                const byTripId: Record<string, StopTimes[]> = {}
                for (const [tripId, data] of results) {
                    if (data && data.length > 0) byTripId[tripId] = data
                }
                apply(byTripId)
            } catch (error) {
                console.error("Error fetching journey stop times:", error)
            }
        }

        let intervalId: NodeJS.Timeout | null = null
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                getData()
                intervalId = setInterval(getData, REFRESH_INTERVAL * 1000)
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

    return stopTimesByTripId
}
