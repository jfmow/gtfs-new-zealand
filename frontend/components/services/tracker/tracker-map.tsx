"use client"

import { Suspense, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import LoadingSpinner from "../../loading-spinner"
import type { LatLng } from "../../map/map"
import { useServiceTrackerContext, useRouteLine } from "./use-service-tracker"
import { buildPreviewMapItems, buildTrackerMapItems } from "./map-markers"
import { getBoundsFromStops, getCurrentStopSequence } from "./helpers"

const MapComp = dynamic(() => import("../../map/map"), { ssr: false })

/**
 * The tracker's map, driven entirely by ServiceTrackerContext. Rendered full-bleed
 * behind the mobile drawer, split beside the desktop dialog, or inline on /trip.
 * `mapId` must stay stable for the life of the mount so the ~10s poll doesn't tear
 * the map down and reset its zoom.
 */
export default function TrackerMap({
    height,
    padding,
    follow = true,
    onUserMove,
}: {
    height: string
    padding?: { left?: number; top?: number; bottom?: number }
    /** Keep the vehicle in view as it moves (off once the rider pans; see mobile-sheet's follow button). */
    follow?: boolean
    onUserMove?: () => void
}) {
    const { vehicle, stops, stopTimes, previewData, tripId, currentStop } = useServiceTrackerContext()
    const routeLine = useRouteLine(tripId, vehicle?.route.id ?? previewData?.route_id)

    const mapIdRef = useRef<string>()
    if (!mapIdRef.current) mapIdRef.current = "tracker-map-" + Math.random().toString(36).slice(2)

    const sortedStops = useMemo(
        () => (stops ? [...stops].sort((a, b) => a.sequence - b.sequence) : null),
        [stops],
    )

    // With a follow button (onUserMove set), the map's own "zoom to vehicle" control would duplicate it.
    const hasFollowButton = !!onUserMove
    const mapItems = useMemo(() => {
        const items = vehicle
            ? buildTrackerMapItems({ stops: sortedStops, stopTimes, vehicle, currentStop })
            : sortedStops ? buildPreviewMapItems({ stops: sortedStops, stopTimes }) : []
        return hasFollowButton ? items.map((item) => ({ ...item, zoomButton: undefined })) : items
    }, [vehicle, sortedStops, stopTimes, currentStop, hasFollowButton])

    if (!vehicle && (!sortedStops || sortedStops.length === 0)) {
        return <LoadingSpinner description="Loading map…" height={height} />
    }

    const currentStopSeq = getCurrentStopSequence(sortedStops, currentStop)

    let defaultZoom: [LatLng, LatLng] | [LatLng]
    if (vehicle) {
        defaultZoom = currentStop
            ? [
                [vehicle.position.lat, vehicle.position.lon],
                [currentStop.lat, currentStop.lon],
            ]
            : [[vehicle.position.lat, vehicle.position.lon]]
    } else {
        defaultZoom = getBoundsFromStops(sortedStops!)
    }

    const followFitWith =
        vehicle &&
            currentStop &&
            (currentStopSeq === undefined || currentStopSeq >= vehicle.trip.next_stop.sequence)
            ? ([currentStop.lat, currentStop.lon] as [number, number])
            : null

    return (
        <Suspense fallback={<LoadingSpinner description="Loading map…" height={height} />}>
            <MapComp
                defaultZoom={defaultZoom}
                line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                followMarkerId={vehicle?.trip_id}
                followFitWith={followFitWith}
                mapItems={mapItems}
                map_id={mapIdRef.current}
                height={height}
                options={{ buttonPosition: "bottom" }}
                padding={padding}
                square={!!padding}
                followPaused={!follow}
                onUserMove={onUserMove}
            />
        </Suspense>
    )
}
