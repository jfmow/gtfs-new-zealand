/**
 * Backend response types, with their wire field names (no decode layer).
 * Ported from iOS `TransitCore/Models/*` - see those files for how each
 * shape was confirmed against live responses.
 *
 * Go types on the wire:
 * - `time.Time` -> RFC3339 string, sometimes Go's zero value "0001-01-01T00:00:00Z" (use `goTime`)
 * - `time.Duration` -> integer nanoseconds (use `goDurationMs`)
 * - realtime/stop-times times -> epoch milliseconds
 */

export interface Coordinate {
    lat: number
    lon: number
}

/** A Go `time.Time` string as a Date, or null for Go's zero value (a walk leg's schedule) or junk. */
export function goTime(raw: string | Date | null | undefined): Date | null {
    if (!raw) return null
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw
    if (raw.startsWith("0001-01-01T00:00:00")) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
}

/** A Go `time.Duration` (nanoseconds) in milliseconds. */
export function goDurationMs(nanoseconds: number): number {
    return nanoseconds / 1_000_000
}

/** A GTFS stop - `gtfs.Stop`. */
export interface Stop {
    stop_id: string
    parent_station: string
    stop_name: string
    stop_code: string
    stop_headsign: string
    stop_lat: number
    stop_lon: number
    platform_number: string
    stop_sequence: number
    is_child_stop: boolean
    location_type: number
    /** "bus" | "train" | "ferry" | "other" */
    stop_type: string
    wheelchair_boarding: number
}

/** The "name + code" string the departures board expects, e.g. "Papatoetoe Train Station 100". */
export function boardQuery(stop: Pick<Stop, "stop_name" | "stop_code">): string {
    return `${stop.stop_name} ${stop.stop_code}`.trim()
}

/** A GTFS route - `gtfs.Route`. */
export interface Route {
    route_id: string
    agency_id?: string
    route_short_name: string
    route_long_name: string
    /** Raw GTFS route_type (2 = rail, 3 = bus, 4 = ferry, ...). */
    route_type?: number
    /** Hex with no '#', often empty. */
    route_color: string
    route_text_color?: string
    /** "Bus" | "Train" | "Ferry" | "School bus". */
    vehicle_type: string
}

/** The compact route summary inlined in a departure or vehicle. */
export interface RouteSummary {
    id: string
    name: string
    color: string
    /** Only on realtime/live rows. */
    type?: string
}

/** The compact stop inlined in a departure's `stop` and a vehicle's trip stops. */
export interface TripStopRef {
    lat: number
    lon: number
    parent_stop_id: string
    name: string
    platform: string
    sequence: number
    child_stop_id: string
    /** `name` without the stop code - only from `GET /stops/{tripId}`. */
    display_name?: string
}

export function tripStopLabel(stop: TripStopRef): string {
    return stop.display_name || stop.name
}

/** One row of a stop's departures board - `GET services/{stop}`. */
export interface Departure {
    trip_id: string
    headsign: string
    /** Scheduled "HH:MM:SS", can be >= 24:00:00 past midnight. */
    arrival_time: string
    platform: string
    stops_away: number
    /** 0-4, or -1 if unknown. */
    occupancy: number
    canceled: boolean
    skipped: boolean
    bikes_allowed: number
    wheelchairs_allowed: number
    route: RouteSummary
    stop: TripStopRef
    location_tracking: boolean
    trip_update_tracking: boolean
    departed: boolean
    /** Minutes until arrival - the authoritative, day-aware sort key. Negative once departed. */
    time_till_arrival: number
    stop_state: string
    trip_started: boolean
    platform_changed: boolean
    /** Train length once live (3 or 6 in Auckland). */
    cars?: number | null
}

/** Whether a board row can be opened in the live tracker (the web board's tap rule). */
export function isTrackable(d: Departure): boolean {
    return (d.location_tracking || d.trip_update_tracking) && !d.canceled && !d.skipped && !d.departed
}

export interface VehiclePosition {
    lat: number
    lon: number
    /** Degrees; 0 means no bearing. */
    bearing: number
}

export interface VehicleTrip {
    first_stop?: TripStopRef | null
    next_stop?: TripStopRef | null
    final_stop?: TripStopRef | null
    current_stop?: TripStopRef | null
    headsign: string
}

/** A live vehicle - `GET realtime/live`. `trip` and `state` only when asked for by tripId. */
export interface Vehicle {
    trip_id: string
    route: RouteSummary
    trip?: VehicleTrip | null
    occupancy: number
    license_plate: string
    position: VehiclePosition
    /** "bus" | "train" | "ferry" | "school bus" (lowercase). */
    type: string
    /** "AtStop" | "Arriving" | "Approaching" | "Leaving" | "Travelling" | "Unknown". */
    state?: string | null
    off_course: boolean
    cars?: number | null
}

/** A vehicle's state as copy, or null when unknown. */
export function vehicleStateLabel(state: string | null | undefined): string | null {
    switch (state) {
        case "AtStop": return "At stop"
        case "Arriving": return "Arriving"
        case "Approaching": return "Approaching"
        case "Leaving": return "Leaving stop"
        case "Travelling": return "Travelling"
        case "Unknown": case null: case undefined: case "": return null
        default: return state
    }
}

/** One stop's realtime prediction for a trip - `GET realtime/stop-times`. Times are epoch ms. */
export interface StopTimeUpdate {
    parent_stop_id: string
    child_stop_id: string
    arrival_time: number
    departure_time: number
    scheduled_time: number
    skipped: boolean
    passed: boolean
    /** Metres along the shape from the vehicle to this stop; 0 once passed. */
    dist: number
}

/** `GET realtime/journey` - everything a tracked journey polls for. */
export interface JourneyLive {
    /** null when the feed couldn't be read; empty when no vehicle is out. */
    vehicles: Vehicle[] | null
    /** By trip id. */
    stop_times: Record<string, StopTimeUpdate[]>
}

/** A service alert - `AlertResponseData`. */
export interface TransitAlert {
    route_id?: string
    /** Epoch seconds. */
    start_date: number
    /** Epoch seconds; <= 0 is open-ended. */
    end_date: number
    cause: string
    effect: string
    title: string
    description: string
    severity: string
}

/** `GET realtime/alerts/{stop}`. */
export interface AlertsForStop {
    alerts: Record<string, TransitAlert[]>
    routes_to_display: string[]
}

/** One match from `GET map/search`. Note `boundingBox` is numeric strings. */
export interface LocationSearchResult {
    id: number
    label: string
    lat: number
    lon: number
    type: string
    importance: number
    boundingBox?: string[] | null
}

export interface ReverseGeocodeResult {
    name: string
}

export interface RouteSearchResult {
    name: string
    route_id: string
}

export interface NearbyVehicle {
    distance_from_vehicle: number
    routeId: string
    tripHeadsign: string
    tripId: string
}

export interface GeoJSONGeometry {
    type: string
    coordinates: unknown
}

export interface GeoJSONFeatureLike {
    type: "Feature"
    geometry: GeoJSONGeometry
    properties?: Record<string, unknown> | null
}

export interface GeoJSONCollectionLike {
    type: "FeatureCollection"
    features: GeoJSONFeatureLike[]
}

/** `GET map/geojson/shapes` - `geojson` is a single Feature (confirmed live 2026-11-04), typed loosely in case it's a collection. */
export interface RouteShape {
    color: string
    geojson: GeoJSONFeatureLike | GeoJSONCollectionLike | null
}

export interface DirectionStep {
    instruction: string
    modifier: string
    type: string
    name: string
    distance: number
    lat: number
    lon: number
}

/** `GET map/nav` - walking directions from the backend's OSRM. */
export interface WalkingDirections {
    type: string
    features: GeoJSONFeatureLike[]
    instructions: string
    steps: DirectionStep[]
    /** Seconds. */
    duration: number
    /** Metres. */
    distance: number
}

/** Every [lon, lat] on the lines of a Feature, a FeatureCollection or a list of features. Tolerates null / missing parts. */
export function lineCoordinates(geo: GeoJSONFeatureLike | GeoJSONCollectionLike | GeoJSONFeatureLike[] | null | undefined): Coordinate[] {
    const features: GeoJSONFeatureLike[] = !geo ? [] : Array.isArray(geo) ? geo : geo.type === "FeatureCollection" ? geo.features ?? [] : [geo]
    const out: Coordinate[] = []
    const push = (p: unknown) => {
        if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") out.push({ lat: p[1], lon: p[0] })
    }
    for (const f of features) {
        const c = f?.geometry?.coordinates
        if (!Array.isArray(c)) continue
        if (f.geometry.type === "LineString") c.forEach(push)
        else if (f.geometry.type === "MultiLineString") (c as unknown[]).forEach((line) => Array.isArray(line) && line.forEach(push))
    }
    return out
}

// ---------------------------------------------------------------------------
// notifications

export interface StopSubscription {
    parent_stop_id: string
    routes?: string[] | null
    causes?: string[] | null
    min_severity: string
    notify_cancellations: boolean
}

export interface RouteSubscription {
    route_id: string
    causes?: string[] | null
    min_severity: string
    notify_cancellations: boolean
}

export interface RecentNotificationEntry {
    id: string
    seen_at?: number | null
    title?: string | null
    body?: string | null
    url?: string | null
    dismissed?: boolean | null
}

/** `POST notifications/mine`. */
export interface MySubscriptions {
    stops?: StopSubscription[] | null
    routes?: RouteSubscription[] | null
    recent_notifications?: RecentNotificationEntry[] | null
}

/** `POST notifications/find-client` - one stop's subscription (Go field names). */
export interface StopSubscriptionState {
    Routes?: string[] | null
    Causes?: string[] | null
    MinSeverity: string
    NotifyCancellations: boolean
}

/** A leave-by reminder - `POST notifications/journey-reminders`. */
export interface JourneyReminderDTO {
    id: number
    kind: string
    /** "pending_resolve" | "scheduled" | ... */
    status: string
    start_label: string
    end_label: string
    /** "arriveat" | "departat" */
    time_type: string
    target_hhmm: string
    /** Seven 0/1 characters, Monday first; empty = one-off. */
    recurrence: string
    service_date: string
    offsets?: number[] | null
    route_short_name?: string | null
    board_stop_name?: string | null
    recurrence_until?: string | null
    next_leave_unix?: number | null
    next_leave_local?: string | null
    target_unix?: number | null
    plan_id?: string | null
    deeplink?: string | null
    /** "leave" | "changes" */
    alert_mode?: string | null
}

export interface JourneyReminderCreated {
    id: number
    status: string
    kind: string
    service_date: string
    next_leave_unix?: number | null
    next_leave_local?: string | null
}

export interface PushTestResult {
    platform: string
    hasToken: boolean
    env: string
    sent: boolean
    error: string
}
