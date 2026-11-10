import { useEffect, useState } from "react"
import { Bus, Loader2, MapPin, Share2, Ship, TrainFront, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cleanStopName, headsignDisplay } from "@/lib/formating"
import { RouteBadge } from "@/components/home/home-stop-row"
import { OccupancyIcons, getOccupancyShort } from "../occupancy"
import { useServiceTrackerContext } from "./use-service-tracker"
import { findRiderStop, findRiderStopTime, shareTrip } from "./helpers"

/** White or near-black text, whichever reads on the route colour. */
function textOn(hex: string) {
    const n = parseInt(hex.padEnd(6, "0").slice(0, 6), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    return (r * 299 + g * 587 + b * 114) / 1000 > 170 ? "#171717" : "#ffffff"
}

/**
 * The top of a live-tracked service - the iOS trip tracker (2026-11-03):
 * route and destination on one line; then a big countdown to YOUR stop
 * (opened from its board) - or the next stop when there isn't one; a strip
 * of the vehicle, a dot per stop still to go and a pin at your stop; then
 * one quiet status line.
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
    const headsign = headsignDisplay(vehicle?.trip.headsign || previewData?.tripHeadsign || routeName)

    const isAtStop = vehicle?.state === "AtStop"
    const liveUsable = !!vehicle && vehicle.state !== "Unknown" && !vehicle.off_course

    // The stop the countdown counts to: yours while it's still ahead, else
    // the one it's at or heading to.
    const riderStop = findRiderStop(stops, currentStop)
    const startSeq = vehicle ? (isAtStop ? vehicle.trip.current_stop.sequence : vehicle.trip.next_stop.sequence) : undefined
    const yoursAhead = !!riderStop && (startSeq === undefined || riderStop.sequence >= startSeq)
    const target = yoursAhead && riderStop
        ? { name: riderStop.name, parent_stop_id: riderStop.parent_stop_id, child_stop_id: riderStop.child_stop_id }
        : vehicle ? (isAtStop ? vehicle.trip.current_stop : vehicle.trip.next_stop) : undefined
    const targetTime = yoursAhead && currentStop
        ? findRiderStopTime(stopTimes, currentStop)
        : target ? stopTimes?.find((st) => st.child_stop_id === target.child_stop_id) ?? stopTimes?.find((st) => st.parent_stop_id === target.parent_stop_id) : undefined
    const minutes = targetTime?.arrival_time ? Math.max(0, Math.ceil((targetTime.arrival_time - now) / 60_000)) : null
    const caption = yoursAhead ? "To your stop" : isAtStop ? "At" : "Next stop"

    // Stops still to go, counting the target itself.
    const toGo = vehicle && stops && target && startSeq !== undefined
        ? Math.max(1, stops.filter((s) => s.sequence >= startSeq && s.sequence <= (yoursAhead && riderStop ? riderStop.sequence : startSeq)).length)
        : null
    const toGoLabel = (n: number) => (isAtStop && n <= 1 && !yoursAhead ? "At the stop" : isAtStop && n <= 1 ? "At your stop" : n <= 1 ? (yoursAhead ? "Your stop is next" : "Next stop") : `${n} stops to go`)

    const VehicleIcon = vehicle?.type?.toLowerCase() === "train" ? TrainFront : vehicle?.type?.toLowerCase() === "ferry" ? Ship : Bus
    const platform = vehicle?.trip.next_stop.platform

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2.5">
                <RouteBadge name={routeName} color={hex} className="text-[13px]" />
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
                    <span className="sr-only">{routeName} to </span>{headsign}
                </h1>
                {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Updating" />}
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Share this trip" onClick={() => shareTrip(tripId, vehicle)}>
                    <Share2 className="h-4 w-4" />
                </Button>
            </div>

            {target && (
                <div className="flex items-baseline gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-muted-foreground">{caption}</p>
                        <p className="truncate text-xl font-semibold">{cleanStopName(target.name)}</p>
                    </div>
                    {minutes !== null && targetTime && (
                        <div className="shrink-0 text-right">
                            <p className="font-mono text-[26px] font-medium leading-none tabular-nums text-blue-600 dark:text-blue-400">
                                {minutes === 0 ? "Now" : `${minutes} min`}
                            </p>
                            <p className="mt-1 text-[13px] text-muted-foreground">
                                {new Date(targetTime.arrival_time).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {vehicle && toGo !== null && (
                <div className="space-y-1.5" aria-label={toGoLabel(toGo)}>
                    <div className="flex items-center" aria-hidden>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `#${hex}`, color: textOn(hex) }}>
                            <VehicleIcon className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                        {Array.from({ length: Math.min(toGo - 1, 14) }).map((_, i) => (
                            <span key={i} className="flex flex-1 items-center">
                                <span className="h-[3px] flex-1" style={{ background: `#${hex}` }} />
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full border-[2.5px] bg-background" style={{ borderColor: `#${hex}` }} />
                            </span>
                        ))}
                        <span className="h-[3px] flex-1" style={{ background: `#${hex}` }} />
                        {yoursAhead ? (
                            <MapPin className="h-[22px] w-[22px] shrink-0 fill-red-500 text-white" strokeWidth={1.5} />
                        ) : (
                            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[2.5px]" style={{ borderColor: `#${hex}` }}>
                                <span className="h-2 w-2 rounded-full" style={{ background: `#${hex}` }} />
                            </span>
                        )}
                    </div>
                    <p className="text-[13px] font-medium text-muted-foreground">
                        {toGoLabel(toGo)}
                    </p>
                </div>
            )}

            {vehicle && (
                <div className="flex h-5 flex-wrap items-center gap-x-3.5 overflow-hidden text-[13px] leading-5 text-muted-foreground">
                    {liveUsable && (
                        <span className="inline-flex items-center gap-1.5">
                            <span className="live-dot h-1.5 w-1.5 rounded-full bg-green-600 dark:bg-green-400" aria-hidden /> Live
                        </span>
                    )}
                    {vehicle.off_course && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><TriangleAlert className="h-3 w-3" /> Off course</span>
                    )}
                    {vehicle.occupancy >= 0 && (
                        <span className="inline-flex items-center gap-1"><OccupancyIcons occupancy={vehicle.occupancy} />{getOccupancyShort(vehicle.occupancy)}</span>
                    )}
                    {!!vehicle.cars && <span>{vehicle.cars} cars</span>}
                    {platform && <span>Platform {platform}</span>}
                </div>
            )}
        </div>
    )
}
