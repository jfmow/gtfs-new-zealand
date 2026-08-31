"use client"

import { Suspense, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Bell, ListTree } from "lucide-react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import type { GeoJSON } from "@/components/map/geojson-types"
import type { MapItem } from "@/components/map/markers/create"
import type { LatLng } from "@/components/map/map"
import type { ServicesStop, VehiclesResponse } from "@/components/services/tracker"
import type { JourneyType, Location } from "./types"
import { getTransitRouteIds } from "./helpers"

const LeafletMap = dynamic(() => import("@/components/map/map"), { ssr: false })

interface AlertResponseData {
    route_id: string
    start_date: number
    end_date: number
    cause: string
    effect: string
    title: string
    description: string
    severity: string
}

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
}

const VEHICLE_ICONS = new Set(["bus", "train", "ferry", "school bus"])

function stopMatches(a: ServicesStop, b: ServicesStop): boolean {
    return a.parent_stop_id === b.parent_stop_id || a.child_stop_id === b.child_stop_id
}

/** Passed stops (behind the vehicle) render gray; the current/upcoming/first/last stop get their own marker. */
function trackedStopIcon(stop: ServicesStop, vehicle: VehiclesResponse): MapItem["icon"] {
    const trip = vehicle.trip
    if (!trip) return stop.sequence < 0 ? "dot gray" : "dot"
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
}: LiveMapProps) {
    const mapMarkers: MapItem[] = []

    if (startLocation) {
        mapMarkers.push({
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
        mapMarkers.push({
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

    if (trackedVehicle) {
        // Tracking mode: the tracked trip's own full stop list (colored by
        // progress) replaces the plain per-leg board/alight pins, and only
        // the tracked vehicle is shown - not the rest of vehiclesByTripId.
        (trackedStops ?? []).forEach((stop) => {
            mapMarkers.push({
                lat: stop.lat,
                lon: stop.lon,
                icon: trackedStopIcon(stop, trackedVehicle),
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

        mapMarkers.push({
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
    } else {
        if (selectedRoute) {
            selectedRoute.Legs.forEach((leg, index) => {
                if (leg.FromStop) {
                    mapMarkers.push({
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
                    mapMarkers.push({
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

        if (vehiclesByTripId) {
            Object.entries(vehiclesByTripId).forEach(([tripId, v]) => {
                mapMarkers.push({
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
    }

    const line = trackedVehicle && trackedRouteLine
        ? { GeoJson: trackedRouteLine.line, color: trackedRouteLine.color }
        : selectedRoute
            ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" }
            : undefined

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
            <PopoverContent align="end" className="max-h-80 overflow-y-auto">
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
            </PopoverContent>
        </Popover>
    )
}
