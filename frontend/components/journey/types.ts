import type { GeoJSON } from "@/components/map/geojson-types"

export interface Location {
    lat: number
    lon: number
    label: string
}

export interface Stop {
    location_type: number
    parent_station: string
    stop_code: string
    stop_id: string
    stop_lat: number
    stop_lon: number
    stop_name: string
    stop_headsign: string
    wheelchair_boarding: number
    platform_number: string
    stop_type: string
    stop_sequence: number
    is_child_stop: boolean
}

export enum RealtimeStatus {
    Delayed = "delayed",
    Early = "early",
    Scheduled = "scheduled",
    OnTime = "on_time",
}

export interface Route {
    route_id: string
    route_short_name: string
    route_long_name: string
    route_color: string
    route_text_color: string
    vehicle_type: string
}

export interface Leg {
    Mode: string
    FromStop: Stop | null
    ToStop: Stop | null
    TripID: string
    RouteID: string
    Route: Route | null
    DepartureTime: Date
    ArrivalTime: Date
    Duration: number
    DistanceKm: number
    StopSequenceID: number
    scheduled_departure_time: Date
    scheduled_arrival_time: Date
    trip_usable: boolean
    realtime_status?: RealtimeStatus
    delay_seconds?: number
}

export interface JourneyType {
    StartLat: number
    StartLon: number
    EndLat: number
    EndLon: number
    DepartureTime: Date
    ArrivalTime: Date
    TotalDuration: number
    Transfers: number
    TransferStops: Stop[] | null
    Legs: Leg[]
    RouteGeoJSON: GeoJSON
    ID: string
}
