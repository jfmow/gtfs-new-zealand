import { useEffect, useState } from "react"
import { Loader2, Share2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { cn } from "@/lib/utils"
import { OccupancyIcons, getOccupancyShort } from "../occupancy"
import { useServiceTrackerContext } from "./use-service-tracker"
import { findRiderStop, shareTrip } from "./helpers"

/** White or near-black text, whichever reads on the route colour. */
function textOn(hex: string) {
    const n = parseInt(hex.padEnd(6, "0").slice(0, 6), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    return (r * 299 + g * 587 + b * 114) / 1000 > 170 ? "#171717" : "#ffffff"
}

/**
 * The top of a live-tracked service - the iOS tracker's header: route tile,
 * where it's heading, the next stop and a countdown to it, then live chips
 * (live, how far to your stop, occupancy, platform, off course).
 */
export function TrackerHero() {
    const { vehicle, stops, stopTimes, previewData, currentStop, tripId, refreshing } = useServiceTrackerContext()
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 15_000)
        return () => clearInterval(id)
    }, [])

    const routeName = vehicle?.route.name ?? previewData?.route_name ?? ""
    const hex = (vehicle?.route.color || previewData?.route_color || "525252").replace("#", "")
    const headsign = formatTextToNiceLookingWords(vehicle?.trip.headsign || previewData?.tripHeadsign || routeName)

    const isAtStop = vehicle?.state === "AtStop"
    const liveUsable = !!vehicle && vehicle.state !== "Unknown" && !vehicle.off_course
    const nextStopLine = vehicle
        ? isAtStop ? `At ${vehicle.trip.current_stop.name}` : `Next: ${vehicle.trip.next_stop.name}`
        : undefined

    // Countdown to the stop it's at / heading to.
    const target = vehicle ? (isAtStop ? vehicle.trip.current_stop : vehicle.trip.next_stop) : undefined
    const targetTime = target
        ? stopTimes?.find((st) => st.child_stop_id === target.child_stop_id) ?? stopTimes?.find((st) => st.parent_stop_id === target.parent_stop_id)
        : undefined
    const etaMinutes = liveUsable && targetTime?.arrival_time ? Math.max(0, Math.ceil((targetTime.arrival_time - now) / 60_000)) : null

    // Stops still to reach, up to and including the rider's: 0 only while it's
    // stopped there, 1 when it's next.
    const riderStop = findRiderStop(stops, currentStop)
    let stopsToYours: number | null = null
    if (vehicle && riderStop && stops) {
        if (isAtStop) {
            const cur = vehicle.trip.current_stop.sequence
            if (riderStop.sequence >= cur) stopsToYours = stops.filter((s) => s.sequence > cur && s.sequence <= riderStop.sequence).length
        } else {
            const next = vehicle.trip.next_stop.sequence
            if (riderStop.sequence >= next) stopsToYours = stops.filter((s) => s.sequence >= next && s.sequence <= riderStop.sequence).length
        }
    }

    const platform = vehicle?.trip.next_stop.platform

    return (
        <div className="space-y-2.5">
            <div className="flex items-center gap-3.5">
                <span
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] px-1 text-center font-display text-lg font-bold leading-none"
                    style={{ background: `#${hex}`, color: textOn(hex) }}
                    aria-hidden
                >
                    <span className={cn(routeName.length > 4 && "text-sm")}>{routeName}</span>
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="line-clamp-2 text-lg font-semibold leading-snug">
                        <span className="sr-only">{routeName} to </span>{headsign}
                    </h1>
                    {nextStopLine && <p className="line-clamp-2 text-xs text-muted-foreground">{nextStopLine}</p>}
                </div>
                {etaMinutes !== null && (
                    <div className="shrink-0 text-right leading-tight">
                        <p className="whitespace-nowrap font-mono text-xl font-semibold tabular-nums">{etaMinutes === 0 ? "Now" : `${etaMinutes} min`}</p>
                        <p className="text-xs text-muted-foreground">{isAtStop ? "at stop" : "to next stop"}</p>
                    </div>
                )}
                <div className="flex shrink-0 flex-col items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Share this trip" onClick={() => shareTrip(tripId, vehicle)}>
                        <Share2 className="h-4 w-4" />
                    </Button>
                    {refreshing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Updating" />}
                </div>
            </div>

            {vehicle && (
                <div className="flex flex-wrap gap-1.5">
                    {liveUsable && (
                        <Chip>
                            <span className="live-dot h-1.5 w-1.5 rounded-full bg-green-600 dark:bg-green-400" aria-hidden /> Live
                        </Chip>
                    )}
                    {stopsToYours !== null && (
                        <Chip className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                            {stopsToYours === 0 ? "At your stop" : stopsToYours === 1 ? "Your stop is next" : `${stopsToYours} stops to your stop`}
                        </Chip>
                    )}
                    {vehicle.occupancy >= 0 && (
                        <Chip>
                            <OccupancyIcons occupancy={vehicle.occupancy} />
                            {getOccupancyShort(vehicle.occupancy)}
                        </Chip>
                    )}
                    {platform && <Chip>Platform {platform}</Chip>}
                    {vehicle.off_course && (
                        <Chip className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            <TriangleAlert className="h-3 w-3" /> Off course
                        </Chip>
                    )}
                </div>
            )}
        </div>
    )
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 text-xs font-medium", className)}>
            {children}
        </span>
    )
}
