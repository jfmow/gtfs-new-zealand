import type { JourneyType, Leg, Stop } from "../src/types/journey"
import type { TripStopRef, Vehicle } from "../src/models"

/** Test builders matching the iOS TransitCoreTests helpers. */

export const BASE = new Date(1_700_000_000 * 1000)
export const at = (seconds: number, from: Date = BASE) => new Date(from.getTime() + seconds * 1000)

export function makeStop(id: string, lat = 0, lon = 0, extra: Partial<Stop> = {}): Stop {
    return {
        stop_id: id, parent_station: `P-${id}`, stop_name: id, stop_code: "1", stop_headsign: "", stop_lat: lat, stop_lon: lon,
        platform_number: "1", stop_sequence: 0, is_child_stop: true, location_type: 0, stop_type: "train", wheelchair_boarding: 0, ...extra,
    }
}

const ZERO = "0001-01-01T00:00:00Z"

export function makeLeg(o: {
    mode: string
    tripId?: string
    from?: Stop | null
    to?: Stop | null
    departure: Date | null
    arrival: Date | null
    durationSeconds?: number
    extra?: Partial<Leg>
}): Leg {
    return {
        Mode: o.mode, FromStop: o.from ?? null, ToStop: o.to ?? null, TripID: o.tripId ?? "", RouteID: o.tripId ? "R" : "", Route: null,
        DepartureTime: (o.departure ?? ZERO) as Date, ArrivalTime: (o.arrival ?? ZERO) as Date,
        Duration: (o.durationSeconds ?? 0) * 1e9, DistanceKm: 0, StopSequenceID: 0,
        scheduled_departure_time: ZERO as unknown as Date, scheduled_arrival_time: ZERO as unknown as Date, trip_usable: true,
        ...o.extra,
    }
}

export function makePlan(legs: Leg[], extra: Partial<JourneyType> = {}): JourneyType {
    return {
        ID: "p1", StartLat: 0, StartLon: 0, EndLat: 0, EndLon: 0,
        DepartureTime: legs[0]?.DepartureTime, ArrivalTime: legs[legs.length - 1]?.ArrivalTime,
        TotalDuration: 0, Transfers: 0, TransferStops: null, Legs: legs, RouteGeoJSON: { type: "FeatureCollection", features: [] }, ...extra,
    }
}

export function ref(sequence: number, extra: Partial<TripStopRef> = {}): TripStopRef {
    return { lat: 0, lon: 0, parent_stop_id: "p", name: "n", platform: "1", sequence, child_stop_id: "c", ...extra }
}

export function makeVehicle(o: { tripId: string; current?: number | null; next?: number | null; state: string; lat?: number; lon?: number; type?: string }): Vehicle {
    const type = o.type ?? "train"
    return {
        trip_id: o.tripId, route: { id: "R", name: "R", color: "000", type: type[0].toUpperCase() + type.slice(1) },
        trip: { first_stop: null, next_stop: o.next != null ? ref(o.next) : null, final_stop: null, current_stop: o.current != null ? ref(o.current) : null, headsign: "" },
        occupancy: 0, license_plate: "", position: { lat: o.lat ?? 0, lon: o.lon ?? 0, bearing: 90 }, type, state: o.state, off_course: false,
    }
}

export function threeLegJourney(board: Stop, alight: Stop, dep: Date, arr: Date): JourneyType {
    return makePlan([
        makeLeg({ mode: "walk", to: board, departure: BASE, arrival: dep, durationSeconds: 300 }),
        makeLeg({ mode: "transit", tripId: "T1", from: board, to: alight, departure: dep, arrival: arr, durationSeconds: (arr.getTime() - dep.getTime()) / 1000 }),
        makeLeg({ mode: "walk", from: alight, departure: arr, arrival: at(300, arr), durationSeconds: 300 }),
    ])
}
