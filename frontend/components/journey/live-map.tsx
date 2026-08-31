"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Bell, ListTree } from "lucide-react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent, haversineDistance } from "@/lib/utils"
import type { AlertResponseData } from "@/lib/alert-causes"
import RouteNotifications from "@/components/notifications/route-notifications"
import type { GeoJSON } from "@/components/map/geojson-types"
import type { MapItem } from "@/components/map/markers/create"
import type { LatLng } from "@/components/map/map"
import type { ServicesStop, VehiclesResponse } from "@/components/services/tracker"
import type { JourneyType, Location, Stop } from "./types"
import { getTransitRouteIds } from "./helpers"
import { buildTrackedLine, splitTrackedRouteLine, toFeatureArray, walkToStopFeature } from "./tracked-line"

const LeafletMap = dynamic(() => import("@/components/map/map"), { ssr: false })

interface LiveMapProps {
    mapId: string
    height: string
    defaultZoom: [LatLng, LatLng] | [LatLng] | ["user", LatLng]
    startLocation: Location | null
    endLocation: Location | null
    selectedRoute?: JourneyType
    vehiclesByTripId?: Record<string, VehiclesResponse>
    followMarkerId?: string
    /** Show the floating alternates/alerts buttons - only relevant once a route is selected. */
    showOverlayButtons?: boolean
    onToggleAlternates?: () => void
    /**
     * While GO/tracking is active and a vehicle is live, switches the map into
     * tracking mode: shows only this vehicle (not the rest of vehiclesByTripId),
     * its actual route shape, and its full stop list colored by progress
     * (passed stops gray, current/upcoming stops normal) instead of the plain
     * per-leg board/alight pins.
     */
    trackedVehicle?: VehiclesResponse
    trackedStops?: ServicesStop[] | null
    trackedRouteLine?: { color: string; line: GeoJSON } | null
    /** The rider's own board/alight stops for the tracked leg - stops and route line outside this range belong to the vehicle's onward trip, not this ride, and render grayed out. */
    trackedBoardStop?: Stop
    trackedAlightStop?: Stop
    /** Where the walk-to-the-boarding-stop leg starts from, if the rider may still be walking there - hidden once their live location is close enough to the stop (see PROXIMITY_HIDE_METERS). */
    walkingToStopFrom?: { lat: number; lon: number }
    /** Keep the map centered on the rider's live location - used while they're on a walk leg with no vehicle to follow. */
    followUser?: boolean
}

// How close counts as "arrived" for hiding the walking-to-stop indicator.
// Larger stations (the boarding stop is a child of a parent station - bigger
// physical footprint, e.g. a multi-platform interchange) get a more generous
// radius than a simple roadside stop.
const WALK_ARRIVED_METERS_SIMPLE_STOP = 15
const WALK_ARRIVED_METERS_STATION = 40

const VEHICLE_ICONS = new Set(["bus", "train", "ferry", "school bus"])

function stopMatches(a: ServicesStop, b: ServicesStop): boolean {
    return a.parent_stop_id === b.parent_stop_id || a.child_stop_id === b.child_stop_id
}

/** Finds a journey leg's board/alight stop within the tracked trip's own stop list, by ID rather than sequence (Leg.FromStop/ToStop.stop_sequence is never populated by /services/plan). */
function findStopSequence(stops: ServicesStop[] | null | undefined, legStop: Stop | undefined): number | undefined {
    if (!legStop || !stops) return undefined
    const match = stops.find((s) => s.parent_stop_id === legStop.parent_station || s.child_stop_id === legStop.stop_id)
    return match?.sequence
}

/**
 * Passed stops (behind the vehicle) render gray, as do stops outside the
 * rider's own board/alight range (the vehicle's onward trip isn't part of
 * this ride even though it keeps going); the current/upcoming/first/last
 * stop within that range get their own marker.
 */
function trackedStopIcon(stop: ServicesStop, vehicle: VehiclesResponse, boardSeq?: number, alightSeq?: number): MapItem["icon"] {
    if (boardSeq !== undefined && stop.sequence < boardSeq) return "dot gray"
    if (alightSeq !== undefined && stop.sequence > alightSeq) return "dot gray"

    const trip = vehicle.trip
    if (!trip) return "dot"
    if (stopMatches(stop, trip.final_stop)) return "end marker"
    if (stopMatches(stop, trip.current_stop)) return "current stop marker"
    if (stopMatches(stop, trip.next_stop)) return "next stop marker"
    if (stopMatches(stop, trip.first_stop)) return "start marker"
    return trip.current_stop.sequence > stop.sequence ? "dot gray" : "dot"
}

export function LiveMap({
    mapId,
    height,
    defaultZoom,
    startLocation,
    endLocation,
    selectedRoute,
    vehiclesByTripId,
    followMarkerId,
    showOverlayButtons,
    onToggleAlternates,
    trackedVehicle,
    trackedStops,
    trackedRouteLine,
    trackedBoardStop,
    trackedAlightStop,
    walkingToStopFrom,
    followUser,
}: LiveMapProps) {
    const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null)

    // Rebuilt only when a real input changes - not on every render. The 3s GPS
    // tick (userLocation) and the 30s useNow tick upstream would otherwise hand
    // map.tsx a fresh array each time, re-running its whole marker-diff +
    // (previously) geolocation effect. userLocation is deliberately NOT a
    // dependency: it only feeds showWalkToStop / line below, never the markers.
    const mapMarkers = useMemo<MapItem[]>(() => {
        const markers: MapItem[] = []

        if (startLocation) {
            markers.push({
                lat: startLocation.lat,
                lon: startLocation.lon,
                icon: "start marker",
                id: "start",
                routeID: "",
                zIndex: 200,
                onClick: () => { },
                visibleLabel: "Start",
                type: "stop",
            })
        }

        if (endLocation) {
            markers.push({
                lat: endLocation.lat,
                lon: endLocation.lon,
                icon: "end marker",
                id: "end",
                routeID: "",
                zIndex: 200,
                onClick: () => { },
                visibleLabel: "End",
                type: "stop",
            })
        }

        // Every leg other than the currently-tracked one keeps its plain
        // board/alight pins - tracking one leg shouldn't erase the walk to it,
        // any transfer walks, or the rest of the journey from the map.
        if (selectedRoute) {
            selectedRoute.Legs.forEach((leg, index) => {
                const isTrackedLeg = !!(trackedVehicle && leg.TripID === trackedVehicle.trip_id)
                if (isTrackedLeg) return

                if (leg.FromStop) {
                    markers.push({
                        lat: leg.FromStop.stop_lat,
                        lon: leg.FromStop.stop_lon,
                        icon: "next stop marker",
                        id: leg.FromStop.stop_id + "-" + index,
                        routeID: '',
                        zIndex: 100,
                        onClick: () => { },
                        popup: {
                            title: `${leg.FromStop?.stop_name} - ${leg.Mode === 'transit' ? `Catch ${leg.Route?.route_short_name}` : 'Start Walking'}`,
                        },
                        type: "stop",
                    })
                }
                if (leg.ToStop) {
                    markers.push({
                        lat: leg.ToStop.stop_lat,
                        lon: leg.ToStop.stop_lon,
                        icon: "next stop marker",
                        id: leg.ToStop.stop_id + "-" + index,
                        routeID: '',
                        zIndex: 100,
                        onClick: () => { },
                        popup: {
                            title: `${leg.ToStop?.stop_name} - ${leg.Mode === 'transit' ? `Get off ${leg.Route?.route_short_name}` : 'Stop Walking'}`,
                        },
                        type: "stop",
                    })
                }
            })
        }

        if (trackedVehicle) {
            // The tracked leg's own full stop list (colored by progress) replaces
            // just its plain board/alight pins, and only this one vehicle is
            // shown - not the rest of vehiclesByTripId. Journey-plan legs don't
            // carry a reliable stop_sequence (always 0), so the board/alight
            // boundary is found by matching stop IDs against trackedStops
            // instead, whose own `sequence` field is trustworthy.
            const boardSeq = findStopSequence(trackedStops, trackedBoardStop)
            const alightSeq = findStopSequence(trackedStops, trackedAlightStop);
            (trackedStops ?? []).forEach((stop) => {
                markers.push({
                    lat: stop.lat,
                    lon: stop.lon,
                    icon: trackedStopIcon(stop, trackedVehicle, boardSeq, alightSeq),
                    id: `tracked-stop-${stop.parent_stop_id || stop.child_stop_id}`,
                    routeID: '',
                    zIndex: 100,
                    onClick: () => { },
                    popup: {
                        title: stop.name + (stop.platform ? ` | Platform ${stop.platform}` : ""),
                    },
                    type: "stop",
                })
            })

            markers.push({
                lat: trackedVehicle.position.lat,
                lon: trackedVehicle.position.lon,
                icon: VEHICLE_ICONS.has(trackedVehicle.type) ? (trackedVehicle.type as MapItem["icon"]) : "bus",
                id: `vehicle-${trackedVehicle.trip_id}`,
                routeID: trackedVehicle.route.id,
                zIndex: 300,
                bearing: trackedVehicle.position.bearing,
                onClick: () => { },
                popup: {
                    title: `${trackedVehicle.route.name}${trackedVehicle.trip?.headsign ? ` → ${trackedVehicle.trip.headsign}` : ""}`,
                    subtitle: trackedVehicle.state === "AtStop" ? "At stop" : trackedVehicle.state === "Approaching" ? "Approaching" : undefined,
                },
                type: "vehicle",
            })
        } else if (vehiclesByTripId) {
            Object.entries(vehiclesByTripId).forEach(([tripId, v]) => {
                markers.push({
                    lat: v.position.lat,
                    lon: v.position.lon,
                    icon: VEHICLE_ICONS.has(v.type) ? (v.type as MapItem["icon"]) : "bus",
                    id: `vehicle-${tripId}`,
                    routeID: v.route.id,
                    zIndex: 300,
                    bearing: v.position.bearing,
                    onClick: () => { },
                    popup: {
                        title: `${v.route.name}${v.trip?.headsign ? ` → ${v.trip.headsign}` : ""}`,
                        subtitle: v.state === "AtStop" ? "At stop" : v.state === "Approaching" ? "Approaching" : undefined,
                    },
                    type: "vehicle",
                })
            })
        }

        return markers
    }, [
        startLocation,
        endLocation,
        selectedRoute,
        vehiclesByTripId,
        trackedVehicle,
        trackedStops,
        trackedBoardStop,
        trackedAlightStop,
    ])

    const arrivedThresholdM = trackedBoardStop?.parent_station ? WALK_ARRIVED_METERS_STATION : WALK_ARRIVED_METERS_SIMPLE_STOP
    const distanceToBoardStopM = userLocation && trackedBoardStop
        ? haversineDistance(userLocation.lat, userLocation.lon, trackedBoardStop.stop_lat, trackedBoardStop.stop_lon)
        : null
    // Deliberately doesn't require trackedVehicle - a live vehicle is least
    // likely to be assigned yet while the rider is still walking to their
    // first stop, which is exactly when this indicator matters most.
    const showWalkToStop = !!(
        trackedBoardStop && walkingToStopFrom &&
        (distanceToBoardStopM === null || distanceToBoardStopM >= arrivedThresholdM)
    )

    // Memoized on stable identifiers/primitives rather than the raw objects -
    // trackedVehicle is a new reference on every ~10s poll and userLocation
    // (which feeds showWalkToStop) on every ~3s GPS tick, and map.tsx tears
    // down and recreates the whole line layer whenever this reference
    // changes. Without this, the line's looping flow animation never gets
    // more than a few seconds to run before being reset back to frame zero.
    const line = useMemo(() => {
        // Built independently of trackedVehicle - shown as soon as tracking
        // starts (see showWalkToStop), well before a live vehicle is likely
        // to be assigned to the first leg.
        const walkFeature = showWalkToStop && walkingToStopFrom && trackedBoardStop
            ? walkToStopFeature(walkingToStopFrom, { lat: trackedBoardStop.stop_lat, lon: trackedBoardStop.stop_lon })
            : null
        // When showWalkToStop is set, the plan's original walk-to-board-stop
        // leg is dropped in favor of the live synthetic one above, so the
        // two don't render on top of each other (the straight synthetic line
        // cutting across the original curved OSRM path).
        const replacedWalkToStopId = showWalkToStop ? trackedBoardStop?.stop_id : undefined

        if (trackedVehicle && trackedRouteLine) {
            // Falls back to the line's own feature(s), tagged as an ordinary
            // active transit segment, on the rare chance the tracked leg's
            // board/alight stops aren't resolved yet.
            let trackedFeatures = trackedBoardStop && trackedAlightStop
                ? splitTrackedRouteLine(
                    trackedRouteLine.line,
                    { lat: trackedBoardStop.stop_lat, lon: trackedBoardStop.stop_lon },
                    { lat: trackedAlightStop.stop_lat, lon: trackedAlightStop.stop_lon }
                )
                : toFeatureArray(trackedRouteLine.line).map((f) => ({
                    ...f,
                    properties: { ...(f as { properties?: object }).properties, mode: "transit" },
                }))
            if (walkFeature) trackedFeatures = [...trackedFeatures, walkFeature]
            // Every OTHER leg's own feature (all walk legs, any other
            // transit leg) is kept from the full journey line - only the
            // tracked leg's feature is swapped out for the richer version.
            const merged = buildTrackedLine(selectedRoute?.RouteGeoJSON, trackedVehicle.trip_id, trackedFeatures, replacedWalkToStopId)
            return { GeoJson: merged, color: "" }
        }
        if (selectedRoute) {
            if (walkFeature) {
                const merged = buildTrackedLine(selectedRoute.RouteGeoJSON, undefined, [walkFeature], replacedWalkToStopId)
                return { GeoJson: merged, color: "" }
            }
            return { GeoJson: selectedRoute.RouteGeoJSON, color: "" }
        }
        return undefined
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        trackedVehicle?.trip_id,
        trackedRouteLine,
        trackedBoardStop,
        trackedAlightStop,
        showWalkToStop,
        walkingToStopFrom?.lat,
        walkingToStopFrom?.lon,
        selectedRoute,
    ])

    return (
        <div className="relative h-full w-full">
            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                <LeafletMap
                    defaultZoom={defaultZoom}
                    mapItems={mapMarkers}
                    map_id={mapId}
                    height={height}
                    line={line}
                    followMarkerId={followMarkerId}
                    followUser={followUser}
                    onLocationUpdate={(lat, lon) => setUserLocation({ lat, lon })}
                    options={{ buttonPosition: "bottom" }}
                />
            </Suspense>

            {showOverlayButtons && selectedRoute && (
                // top-16 (not top-3): clears the app's persistent nav header, which
                // is deliberately always on top (z-50) - a lower top offset here
                // would visually collide with it regardless of z-index, since these
                // buttons live inside this component's own (lower) stacking context.
                <div className="absolute right-3 top-16 z-[500] flex flex-col gap-2">
                    {onToggleAlternates && (
                        <Button
                            variant="secondary"
                            size="icon"
                            className="h-10 w-10 rounded-full shadow-md"
                            aria-label="Show alternate routes"
                            onClick={onToggleAlternates}
                        >
                            <ListTree className="h-4 w-4" />
                        </Button>
                    )}
                    <AlertsBell routeIds={getTransitRouteIds(selectedRoute)} />
                </div>
            )}
        </div>
    )
}

function AlertsBell({ routeIds }: { routeIds: string[] }) {
    const [alerts, setAlerts] = useState<AlertResponseData[]>([])
    const routeIdsKey = routeIds.join(",")

    useEffect(() => {
        if (!routeIdsKey) {
            setAlerts([])
            return
        }
        let cancelled = false
        Promise.all(
            routeIds.map((routeId) =>
                ApiFetch<AlertResponseData[]>(`realtime/alerts/route/${fullyEncodeURIComponent(routeId)}`).then(
                    (res) => (res.ok ? res.data : [])
                )
            )
        ).then((results) => {
            if (!cancelled) setAlerts(results.flat())
        })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeIdsKey])

    if (!routeIdsKey) return null

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="secondary"
                    size="icon"
                    className="relative h-10 w-10 rounded-full shadow-md"
                    aria-label="Service alerts"
                >
                    <Bell className="h-4 w-4" />
                    {alerts.length > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                            {alerts.length}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-80 overflow-y-auto overscroll-contain">
                {alerts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No alerts for this journey.</p>
                ) : (
                    <div className="space-y-3">
                        {alerts.map((alert, i) => (
                            <div key={i} className="space-y-1">
                                <p className="text-sm font-medium">{alert.title}</p>
                                <p className="text-xs text-muted-foreground">{alert.description}</p>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-3 space-y-1.5 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Notify me about:</p>
                    {routeIds.map((routeId) => (
                        <RouteNotifications key={routeId} routeId={routeId}>
                            <button
                                type="button"
                                className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
                            >
                                <span>{routeId}</span>
                                <Bell className="h-3 w-3 text-muted-foreground" />
                            </button>
                        </RouteNotifications>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}
