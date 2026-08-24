import { useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { useUserLocation } from "@/lib/userLocation"
import { haversineDistance, formatDistance } from "@/lib/utils"
import type { Stop } from "@/pages/stops"
import { StopPreviewCard } from "./stop-preview-card"

const NEARBY_LIMIT = 6

export function NearbyStops() {
    const [stops, setStops] = useState<Stop[]>([])
    const { location, locationFound, loading } = useUserLocation()

    useEffect(() => {
        ApiFetch<Stop[]>(`stops?children=false`).then((res) => {
            if (res.ok) setStops(res.data)
        })
    }, [])

    if (loading) {
        return <p className="text-xs text-muted-foreground">Finding stops near you...</p>
    }

    if (!locationFound) {
        return <p className="text-xs text-muted-foreground">Enable location to see stops near you.</p>
    }

    const nearest = stops
        .map((stop) => ({
            stop,
            distance: haversineDistance(location[0], location[1], stop.stop_lat, stop.stop_lon),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, NEARBY_LIMIT)

    if (nearest.length === 0) {
        return <p className="text-xs text-muted-foreground">No stops found nearby.</p>
    }

    // Several distinct stops (opposite sides of the road, different platforms) can share a name -
    // only show the stop code alongside the name when it's needed to tell them apart.
    const nameCounts = new Map<string, number>()
    for (const { stop } of nearest) {
        nameCounts.set(stop.stop_name, (nameCounts.get(stop.stop_name) || 0) + 1)
    }

    return (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {nearest.map(({ stop, distance }, index) => (
                <StopPreviewCard
                    key={stop.stop_id}
                    stopId={`${stop.stop_name} ${stop.stop_code}`}
                    label={stop.stop_name}
                    code={(nameCounts.get(stop.stop_name) || 0) > 1 ? stop.stop_code : undefined}
                    meta={formatDistance(distance)}
                    // Only the nearest stop shows on mobile, so the home page fits in one screen with no scroll.
                    className={index === 0 ? undefined : "hidden md:flex"}
                />
            ))}
        </div>
    )
}
