import { timeTillArrivalMsString } from "@/lib/formating"
import type { MapItem } from "@/components/map/markers/create"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."
import type { CurrentStop } from "./helpers"

export const VehicleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-bus-front-icon lucide-bus-front"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>`

const VEHICLE_ICONS = new Set(["bus", "train", "ferry"])

const stopPopup = (stop: ServicesStop, stopTime?: StopTimes): MapItem["popup"] => ({
    title: `${stop.name}${stop.platform ? ` | Platform ${stop.platform}` : ""}`,
    subtitle: stopTime ? timeTillArrivalMsString(stopTime.arrival_time) : undefined,
    linkText: "View departures",
    linkHref: `/?s=${encodeURIComponent(stop.name)}`,
})

const findStopTime = (stopTimes: StopTimes[] | null | undefined, stop: ServicesStop) =>
    stopTimes?.find(
        (st) => st.parent_stop_id === stop.parent_stop_id || st.child_stop_id === stop.child_stop_id,
    )

function vehicleMarker(vehicle: VehiclesResponse): MapItem {
    return {
        lat: vehicle.position.lat,
        lon: vehicle.position.lon,
        icon: (VEHICLE_ICONS.has(vehicle.type) ? vehicle.type : "bus") as MapItem["icon"],
        bearing: vehicle.position.bearing,
        id: vehicle.trip_id,
        routeID: vehicle.route.id,
        zIndex: 1,
        type: "vehicle",
        onClick: () => { },
        zoomButton: VehicleIcon,
    }
}

/** Per-stop marker icon for a live-tracked trip - mirrors the vehicle's progress. */
function trackedStopIcon(
    stop: ServicesStop,
    vehicle: VehiclesResponse,
    currentStop?: CurrentStop,
): MapItem["icon"] {
    const trip = vehicle.trip
    const isNext =
        trip.next_stop.parent_stop_id === stop.parent_stop_id ||
        trip.next_stop.child_stop_id === stop.child_stop_id
    if (isNext) return "next stop marker"
    if (currentStop?.name === stop.name) return "marked stop marker"
    if (
        trip.final_stop.parent_stop_id === stop.parent_stop_id ||
        trip.final_stop.child_stop_id === stop.child_stop_id
    ) return "end marker"
    if (
        stop.parent_stop_id === trip.current_stop.parent_stop_id ||
        stop.child_stop_id === trip.current_stop.child_stop_id
    ) return "current stop marker"
    if (stop.parent_stop_id === trip.first_stop.parent_stop_id) return "start marker"
    return trip.current_stop.sequence > stop.sequence ? "dot gray" : "dot"
}

/** Markers for a live-tracked trip: every stop coloured by progress, plus the vehicle. */
export function buildTrackerMapItems({
    stops,
    stopTimes,
    vehicle,
    currentStop,
}: {
    stops: ServicesStop[] | null
    stopTimes: StopTimes[] | null
    vehicle: VehiclesResponse
    currentStop?: CurrentStop
}): MapItem[] {
    if (!stops) return [vehicleMarker(vehicle)]
    return [
        ...stops.map((stop): MapItem => ({
            lat: stop.lat,
            lon: stop.lon,
            icon: trackedStopIcon(stop, vehicle, currentStop),
            id: stop.name,
            routeID: "",
            type: "stop",
            zIndex: 1,
            onClick: () => { },
            popup: stopPopup(stop, findStopTime(stopTimes, stop)),
        })),
        vehicleMarker(vehicle),
    ]
}

/** Markers for a not-yet-running trip: plain stop dots along the route, no vehicle. */
export function buildPreviewMapItems({
    stops,
    stopTimes,
}: {
    stops: ServicesStop[]
    stopTimes: StopTimes[] | null
}): MapItem[] {
    return stops.map((stop, index): MapItem => ({
        lat: stop.lat,
        lon: stop.lon,
        icon: index === stops.length - 1 ? "end marker" : "dot",
        id: stop.name,
        routeID: "",
        zIndex: 1,
        type: "stop",
        onClick: () => { },
        popup: stopPopup(stop, findStopTime(stopTimes, stop)),
    }))
}
