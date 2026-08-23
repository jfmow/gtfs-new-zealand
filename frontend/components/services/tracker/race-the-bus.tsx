import { memo, useEffect, useState } from "react"
import { Footprints, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { ApiFetch } from "@/lib/url-context"

interface WalkingDirectionsResponse {
    duration: number // seconds
    distance: number // meters
}

interface RaceTheBusProps {
    currentStop: { id: string; lat: number; lon: number; name: string }
    /** Predicted arrival time at currentStop, in ms since epoch. */
    vehicleArrivalMs?: number
}

/**
 * Compares a live walking ETA to the selected stop against the tracked vehicle's
 * predicted arrival there, so a user can tell at a glance whether walking now
 * beats waiting/riding. Silently hides itself if geolocation or the walking
 * directions call fails - this is a nice-to-have, not something worth erroring over.
 */
const RaceTheBus = memo(function RaceTheBus({ currentStop, vehicleArrivalMs }: RaceTheBusProps) {
    const [walkMinutes, setWalkMinutes] = useState<number | null>(null)
    const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading")

    useEffect(() => {
        if (!navigator.geolocation) {
            setStatus("unavailable")
            return
        }

        let cancelled = false
        setStatus("loading")

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                if (cancelled) return
                const { latitude, longitude } = position.coords
                const res = await ApiFetch<WalkingDirectionsResponse>(
                    `map/nav?method=walking&startLat=${latitude}&startLon=${longitude}&endLat=${currentStop.lat}&endLon=${currentStop.lon}`,
                    { method: "GET" }
                )
                if (cancelled) return
                if (res.ok && res.data.duration) {
                    setWalkMinutes(Math.round(res.data.duration / 60))
                    setStatus("ready")
                } else {
                    setStatus("unavailable")
                }
            },
            () => {
                if (!cancelled) setStatus("unavailable")
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        )

        return () => {
            cancelled = true
        }
    }, [currentStop.id, currentStop.lat, currentStop.lon])

    if (status === "unavailable") return null

    if (status === "loading") {
        return (
            <Card className="mb-4">
                <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking if you can walk to {currentStop.name}...
                </CardContent>
            </Card>
        )
    }

    if (walkMinutes === null) return null

    const busMinutes = vehicleArrivalMs ? Math.max(0, Math.round((vehicleArrivalMs - Date.now()) / 60000)) : null
    const willMakeIt = busMinutes !== null ? walkMinutes <= busMinutes : null

    return (
        <Card
            className={
                willMakeIt === true
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 mb-4"
                    : willMakeIt === false
                        ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 mb-4"
                        : "mb-4"
            }
        >
            <CardContent className="flex items-center gap-2 p-3 text-sm">
                <Footprints className="h-4 w-4 flex-shrink-0" />
                <span>
                    Walk to {currentStop.name}: <strong>{walkMinutes} min</strong>
                    {busMinutes !== null && (
                        <>
                            {" · "}Vehicle arrives in <strong>{busMinutes} min</strong>
                            {" — "}
                            {willMakeIt ? "you'll make it!" : "you'll probably miss it"}
                        </>
                    )}
                </span>
            </CardContent>
        </Card>
    )
})

export default RaceTheBus
