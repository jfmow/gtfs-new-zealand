import { memo } from "react"
import { ChevronsRight, Clock } from "lucide-react"
import { timeTillArrivalMsString } from "@/lib/formating"
import { OccupancyIcons, getOccupancyShort } from "../occupancy"
import { useServiceTrackerContext } from "./use-service-tracker"
import { findRiderStop, getStopsAway, getTrackerEta } from "./helpers"

/**
 * The at-a-glance line for a live-tracked service: how full it is, when it reaches
 * the rider, and how many stops out. Renders nothing without a trustworthy live
 * vehicle - preview / limited-tracking states are covered by TrackingNotice.
 */
export const TrackerSummaryCard = memo(function TrackerSummaryCard() {
    const { vehicle, stops, stopTimes, currentStop } = useServiceTrackerContext()
    if (!vehicle || vehicle.off_course || vehicle.state === "Unknown") return null

    const occupancy = vehicle.occupancy >= 0 ? vehicle.occupancy : undefined
    const eta = getTrackerEta(vehicle, stopTimes, currentStop)
    const stopsAway = getStopsAway(vehicle, stops, currentStop)

    const platform = eta?.atRiderStop
        ? findRiderStop(stops, currentStop)?.platform
        : vehicle.trip.next_stop.platform

    let etaLabel: string | undefined
    if (eta) {
        const t = timeTillArrivalMsString(eta.ms)
        if (eta.atRiderStop) {
            etaLabel = t === "Now" ? "Arriving now" : t === "Departed" ? "Just left your stop" : `Arrives in ${t}`
        } else if (t !== "Now" && t !== "Departed") {
            etaLabel = `${t} to next stop`
        }
    }

    if (occupancy === undefined && !etaLabel && stopsAway === undefined) return null

    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 text-muted-foreground">
                {occupancy !== undefined && (
                    <span className="flex items-center gap-1.5">
                        <OccupancyIcons occupancy={occupancy} />
                        <span className="text-xs">{getOccupancyShort(occupancy)}</span>
                    </span>
                )}
                {occupancy !== undefined && platform && <span className="text-border">·</span>}
                {platform && <span className="text-xs">Platform {platform}</span>}
            </div>

            {(etaLabel || stopsAway !== undefined) && (
                <div className="flex flex-col items-end leading-tight">
                    {stopsAway !== undefined && stopsAway > 0 && (
                        <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                            <ChevronsRight className="h-3.5 w-3.5 text-muted-foreground" />
                            {stopsAway} {stopsAway === 1 ? "stop" : "stops"} away
                        </span>
                    )}
                    {etaLabel && (
                        <span
                            className={
                                stopsAway !== undefined && stopsAway > 0
                                    ? "text-xs text-muted-foreground"
                                    : "flex items-center gap-1 text-sm font-semibold text-foreground"
                            }
                        >
                            {!(stopsAway !== undefined && stopsAway > 0) && (
                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {etaLabel}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
})

export default TrackerSummaryCard
