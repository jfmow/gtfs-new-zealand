import type { GeoJSON } from "./geojson"
import type { Route, Stop } from "../models"

export type { Route, Stop } from "../models"

export interface Location {
    lat: number
    lon: number
    label: string
}

export enum RealtimeStatus {
    Delayed = "delayed",
    Early = "early",
    Scheduled = "scheduled",
    OnTime = "on_time",
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
    /** A vehicle was reporting on this trip when the plan was made - realtime_status can read "on_time" long before one is. Absent on older plans. */
    vehicle_tracked?: boolean
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
