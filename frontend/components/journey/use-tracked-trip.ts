import { useEffect, useState } from "react"
import { getStopsForTrip } from "@/components/services/stops"
import type { ServicesStop } from "@/components/services/tracker"

/** Full stop list for a single trip (not just the journey's board/alight stops), fetched once per tripId. */
export function useTrackedTripStops(tripId: string | null): ServicesStop[] | null {
    const [stops, setStops] = useState<ServicesStop[] | null>(null)

    useEffect(() => {
        if (!tripId) {
            setStops(null)
            return
        }
        let cancelled = false
        getStopsForTrip(tripId).then((result) => {
            if (!cancelled) setStops(result)
        })
        return () => {
            cancelled = true
        }
    }, [tripId])

    return stops
}
