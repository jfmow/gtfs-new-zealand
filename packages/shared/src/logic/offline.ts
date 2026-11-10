/**
 * Journeys with no connection - a port of iOS `OfflineRideEstimator.swift`,
 * `OfflineJourneyMoments.swift` and the `OfflineJourneyPack` model. Once the
 * rider is detected riding, their GPS becomes a synthetic `Vehicle` on the
 * trip's own stop list, so the progress model needs no special cases.
 */
import { goTime, type Coordinate, type RouteShape, type StopTimeUpdate, type TripStopRef, type Vehicle, type WalkingDirections } from "../models"
import type { JourneyType, Leg } from "../types/journey"
import { haversineMeters } from "./basics"
import { laClock } from "./journey-live"
import { leaveBy } from "./live-content"
import { findStopSequence } from "./tracking"

const t = (d: Date | string | null | undefined) => goTime(d as string | Date | null | undefined)
const coord = (s: TripStopRef): Coordinate => ({ lat: s.lat, lon: s.lon })

export interface GPSFix {
    coordinate: Coordinate
    /** m/s, null when not reported. */
    speed: number | null
    timestamp: Date
}

export interface RideProgress {
    boarded: boolean
    alighted: boolean
    reachedAlight: boolean
    segment: number
}

interface RideState extends RideProgress {
    boardingEvidence: number
    lastFix: GPSFix | null
    lastSpeed: number | null
    passedAt: Map<number, Date>
}

interface Projection {
    segment: number
    distanceFromRoute: number
    alongMeters: number
    metresFromSegmentStart: number
    metresToSegmentEnd: number
}

export class OfflineRideEstimator {
    static readonly ridingSpeed = 4.5
    static readonly walkingSpeed = 3
    static readonly boardedPastMeters = 150
    static readonly onRouteMeters = 150
    static readonly atStopMeters = 40
    static readonly walkedAwayMeters = 10
    static readonly earlyBoardingMs = 180_000
    /**
     * While the vehicle is at your stop (the boarding phase), pulling away
     * with it is evidence enough sooner: a city bus is often under
     * `ridingSpeed` for its first 150 m, which kept "Get on now" up long
     * after the rider was aboard. Still two fixes in a row, close to the route.
     */
    static readonly boardingNowPastMeters = 50
    static readonly boardingNowSpeed = 2.5
    static readonly boardingNowOffRouteMeters = 50

    private rides = new Map<string, RideState>()

    /** What's been worked out so far (boarded rides only) - saved with the journey. */
    get progress(): Record<string, RideProgress> {
        const out: Record<string, RideProgress> = {}
        for (const [id, s] of this.rides) if (s.boarded) out[id] = { boarded: s.boarded, alighted: s.alighted, reachedAlight: s.reachedAlight, segment: s.segment }
        return out
    }

    restore(progress: Record<string, RideProgress>) {
        for (const [id, saved] of Object.entries(progress)) {
            const s = this.rides.get(id) ?? OfflineRideEstimator.fresh()
            s.boarded = s.boarded || saved.boarded
            s.alighted = s.alighted || saved.alighted
            s.reachedAlight = s.reachedAlight || saved.reachedAlight
            s.segment = Math.max(s.segment, saved.segment)
            this.rides.set(id, s)
        }
    }

    hasBoarded(tripId: string) {
        return this.rides.get(tripId)?.boarded ?? false
    }
    hasAlighted(tripId: string) {
        return this.rides.get(tripId)?.alighted ?? false
    }
    reset() {
        this.rides.clear()
    }

    private static fresh(): RideState {
        return { boarded: false, alighted: false, reachedAlight: false, segment: 0, boardingEvidence: 0, lastFix: null, lastSpeed: null, passedAt: new Map() }
    }

    /**
     * Advances one ride with a new fix; returns its synthetic vehicle, or null until on board.
     * `vehicleAtStop`: the ride's vehicle is at your stop now (boarding) - see `boardingNowPastMeters`.
     */
    estimate(leg: Leg, stops: TripStopRef[], fix: GPSFix | null, departure: Date | null, now: Date, vehicleAtStop = false): Vehicle | null {
        const tripId = leg.TripID
        if (!tripId) return null
        const boardSeq = findStopSequence(stops, leg.FromStop)
        if (boardSeq === null) return null
        const alightSeq = findStopSequence(stops, leg.ToStop, boardSeq)
        if (alightSeq === null) return null
        const ride = stops.filter((s) => s.sequence >= boardSeq && s.sequence <= alightSeq).sort((a, b) => a.sequence - b.sequence)
        if (ride.length < 2) return null
        const alightStop = ride[ride.length - 1]

        const state = this.rides.get(tripId) ?? OfflineRideEstimator.fresh()
        this.rides.set(tripId, state)

        if (!fix || (state.lastFix && fix.timestamp.getTime() <= state.lastFix.timestamp.getTime())) {
            if (!state.boarded || !state.lastFix) return null
            const p = OfflineRideEstimator.project(state.lastFix.coordinate, ride, state.segment)
            return this.vehicle(leg, stops, ride, state, state.lastFix.coordinate, p, state.lastSpeed)
        }
        const speed = OfflineRideEstimator.speedOf(fix, state.lastFix)
        state.lastFix = fix
        state.lastSpeed = speed

        const p = OfflineRideEstimator.project(fix.coordinate, ride, state.boarded ? state.segment : 0)
        const fromAlight = haversineMeters(fix.coordinate, coord(alightStop))

        if (!state.boarded) {
            const timeOK = departure ? now.getTime() >= departure.getTime() - OfflineRideEstimator.earlyBoardingMs : true
            const riding = p.distanceFromRoute <= OfflineRideEstimator.onRouteMeters && p.alongMeters >= OfflineRideEstimator.boardedPastMeters && (speed ?? 0) >= OfflineRideEstimator.ridingSpeed
            const pullingAway = vehicleAtStop && p.distanceFromRoute <= OfflineRideEstimator.boardingNowOffRouteMeters &&
                p.alongMeters >= OfflineRideEstimator.boardingNowPastMeters && (speed ?? 0) >= OfflineRideEstimator.boardingNowSpeed
            const qualifies = timeOK && (riding || pullingAway)
            state.boardingEvidence = qualifies ? state.boardingEvidence + 1 : 0
            if (state.boardingEvidence >= 2) {
                state.boarded = true
                if (!state.passedAt.has(boardSeq)) state.passedAt.set(boardSeq, fix.timestamp)
            }
        }
        if (!state.boarded) return null

        if (!state.alighted) {
            if (fromAlight <= OfflineRideEstimator.atStopMeters * 2) state.reachedAlight = true
            const walkingAway = state.reachedAlight && fromAlight >= OfflineRideEstimator.walkedAwayMeters && (speed ?? 0) < OfflineRideEstimator.walkingSpeed
            const leftRoute = state.reachedAlight && p.distanceFromRoute > OfflineRideEstimator.onRouteMeters && (speed ?? 0) < OfflineRideEstimator.ridingSpeed
            if (walkingAway || leftRoute) state.alighted = true
        }
        state.segment = p.segment
        const passed = OfflineRideEstimator.passedSequence(p, ride)
        for (const s of ride) if (s.sequence <= passed && !state.passedAt.has(s.sequence)) state.passedAt.set(s.sequence, fix.timestamp)
        return this.vehicle(leg, stops, ride, state, fix.coordinate, p, speed)
    }

    /**
     * `stopTimes` re-timed by how the ride is actually going: stops ahead at
     * their timetabled time plus the delay seen at the last stop passed.
     * Measured against the timetable, not the cached prediction (which
     * already includes the delay).
     */
    adjustedStopTimes(tripId: string, stops: TripStopRef[], stopTimes: StopTimeUpdate[]): StopTimeUpdate[] | null {
        const s = this.rides.get(tripId)
        if (!s || !s.boarded || s.alighted || s.passedAt.size === 0) return null
        const lastSeq = Math.max(...s.passedAt.keys())
        const lastAt = s.passedAt.get(lastSeq)!
        const stop = stops.find((x) => x.sequence === lastSeq)
        if (!stop) return null
        const time = OfflineRideEstimator.stopTime(stopTimes, stop)
        if (!time) return null
        if (time.scheduled_time !== 0) return OfflineRideEstimator.retimed(stopTimes, lastAt.getTime() - time.scheduled_time, time.scheduled_time)
        const predicted = OfflineRideEstimator.predictedTime(stopTimes, stop)
        if (!predicted) return null
        return OfflineRideEstimator.shifted(stopTimes, lastAt.getTime() - predicted.getTime(), predicted)
    }

    static retimed(stopTimes: StopTimeUpdate[], delayMs: number, fromScheduledMs: number): StopTimeUpdate[] {
        return stopTimes.map((x) => {
            if (x.scheduled_time === 0 || x.scheduled_time < fromScheduledMs || x.skipped) return x
            const arrival = x.scheduled_time + delayMs
            const dwell = x.arrival_time !== 0 && x.departure_time !== 0 ? Math.max(0, x.departure_time - x.arrival_time) : 0
            return { ...x, arrival_time: arrival, departure_time: arrival + dwell }
        })
    }

    static shifted(stopTimes: StopTimeUpdate[], shiftMs: number, reference: Date): StopTimeUpdate[] {
        const refMs = reference.getTime()
        return stopTimes.map((x) => {
            const own = x.arrival_time !== 0 ? x.arrival_time : x.departure_time
            if (own === 0 || own < refMs) return x
            return { ...x, arrival_time: x.arrival_time === 0 ? 0 : x.arrival_time + shiftMs, departure_time: x.departure_time === 0 ? 0 : x.departure_time + shiftMs }
        })
    }

    static predictedTime(stopTimes: StopTimeUpdate[], stop: TripStopRef): Date | null {
        const x = OfflineRideEstimator.stopTime(stopTimes, stop)
        if (!x) return null
        for (const ms of [x.arrival_time, x.departure_time, x.scheduled_time]) if (ms !== 0) return new Date(ms)
        return null
    }

    static stopTime(stopTimes: StopTimeUpdate[], stop: TripStopRef): StopTimeUpdate | null {
        return stopTimes.find((x) => x.child_stop_id === stop.child_stop_id) ?? stopTimes.find((x) => stop.parent_stop_id !== "" && x.parent_stop_id === stop.parent_stop_id) ?? null
    }

    /**
     * The live vehicle moved on to where the rider's GPS puts the ride, when that's further along. Only ever forward:
     * a later stop, or the same stop when the feed still has it there but GPS has it on its way (the feed lags pulling out).
     */
    static advancing(live: Vehicle, estimate: Vehicle): Vehicle {
        const liveSeq = live.trip?.current_stop?.sequence ?? -Infinity
        const gps = estimate.trip
        const gpsSeq = gps?.current_stop?.sequence
        if (!gps || gpsSeq === undefined || gpsSeq < liveSeq) return live
        const leftStop = gpsSeq === liveSeq && estimate.state === "Travelling" && live.state !== "Travelling" && live.state !== "Leaving"
        if (gpsSeq === liveSeq && !leftStop) return live
        return {
            ...live,
            trip: {
                first_stop: live.trip?.first_stop ?? gps.first_stop, next_stop: gps.next_stop,
                final_stop: live.trip?.final_stop ?? gps.final_stop, current_stop: gps.current_stop,
                headsign: live.trip?.headsign ?? gps.headsign,
            },
            position: { lat: estimate.position.lat, lon: estimate.position.lon, bearing: live.position.bearing },
            state: estimate.state,
            cars: undefined,
        }
    }

    /** The stop as the feed names it - without the code `/stops/{tripId}` appends. */
    static shown(stop: TripStopRef): TripStopRef {
        return { lat: stop.lat, lon: stop.lon, parent_stop_id: stop.parent_stop_id, name: stop.display_name || stop.name, platform: stop.platform, sequence: stop.sequence, child_stop_id: stop.child_stop_id }
    }

    private vehicle(leg: Leg, stops: TripStopRef[], ride: TripStopRef[], state: RideState, position: Coordinate, p: Projection, speed: number | null): Vehicle | null {
        const alight = ride[ride.length - 1]
        let current: TripStopRef
        let next: TripStopRef | null
        let vehicleState: string
        if (state.alighted) {
            current = stops.find((s) => s.sequence > alight.sequence) ?? { ...alight, sequence: alight.sequence + 1, display_name: undefined }
            next = null
            vehicleState = "Travelling"
        } else {
            const from = ride[p.segment], to = ride[p.segment + 1]
            const slow = (speed ?? 0) < 2
            if (p.metresToSegmentEnd <= OfflineRideEstimator.atStopMeters) {
                current = to
                next = ride[p.segment + 2] ?? stops.find((s) => s.sequence > to.sequence) ?? null
                vehicleState = slow ? "AtStop" : "Arriving"
            } else if (p.metresFromSegmentStart <= OfflineRideEstimator.atStopMeters && slow) {
                current = from
                next = to
                vehicleState = "AtStop"
            } else {
                current = from
                next = to
                vehicleState = "Travelling"
            }
        }
        const route = leg.Route
        return {
            trip_id: leg.TripID,
            route: { id: leg.RouteID, name: route?.route_short_name ?? leg.RouteID, color: route?.route_color ?? "", type: route?.vehicle_type },
            trip: {
                first_stop: stops[0] ? OfflineRideEstimator.shown(stops[0]) : null,
                next_stop: next ? OfflineRideEstimator.shown(next) : null,
                final_stop: stops.length ? OfflineRideEstimator.shown(stops[stops.length - 1]) : null,
                current_stop: OfflineRideEstimator.shown(current),
                headsign: "",
            },
            occupancy: -1,
            license_plate: "",
            position: { lat: position.lat, lon: position.lon, bearing: 0 },
            type: (route?.vehicle_type ?? leg.FromStop?.stop_type ?? "bus").toLowerCase(),
            state: vehicleState,
            off_course: false,
        }
    }

    static passedSequence(p: Projection, ride: TripStopRef[]): number {
        return p.metresToSegmentEnd <= OfflineRideEstimator.atStopMeters ? ride[p.segment + 1].sequence : ride[p.segment].sequence
    }

    /** Nearest point on the line through the ride's stops (local flat projection). */
    static project(point: Coordinate, ride: TripStopRef[], fromSegment = 0): Projection {
        const mLat = 111_132
        const mLon = 111_320 * Math.cos((point.lat * Math.PI) / 180)
        const xy = (c: Coordinate) => [(c.lon - point.lon) * mLon, (c.lat - point.lat) * mLat]
        const first = Math.max(0, Math.min(fromSegment, ride.length - 2))
        let best: Projection = { segment: first, distanceFromRoute: Infinity, alongMeters: 0, metresFromSegmentStart: 0, metresToSegmentEnd: 0 }
        let along = 0
        for (let i = 0; i < ride.length - 1; i++) {
            const [ax, ay] = xy(coord(ride[i]))
            const [bx, by] = xy(coord(ride[i + 1]))
            const dx = bx - ax, dy = by - ay
            const length = Math.sqrt(dx * dx + dy * dy)
            const tt = length > 0 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / (length * length))) : 0
            const px = ax + tt * dx, py = ay + tt * dy
            const distance = Math.sqrt(px * px + py * py)
            // `<=` (+0.5) so a rider exactly at a shared stop resolves to the later segment.
            if (i >= first && distance <= best.distanceFromRoute + 0.5) {
                best = { segment: i, distanceFromRoute: distance, alongMeters: along + tt * length, metresFromSegmentStart: tt * length, metresToSegmentEnd: (1 - tt) * length }
            }
            along += length
        }
        return best
    }

    static speedOf(fix: GPSFix, previous: GPSFix | null): number | null {
        if (fix.speed !== null && fix.speed >= 0) return fix.speed
        if (!previous) return null
        const seconds = (fix.timestamp.getTime() - previous.timestamp.getTime()) / 1000
        if (seconds < 2) return null
        return haversineMeters(previous.coordinate, fix.coordinate) / seconds
    }
}

// ---------------------------------------------------------------------------
// moments (local notifications that replace server pushes offline)

export interface JourneyMoment {
    key: string
    date: Date
    title: string
    body: string
}

const BOARD_LEAD = 3 * 60_000
const ALIGHT_LEAD = 2 * 60_000
const GET_READY_LEAD = 5 * 60_000

const momentRouteName = (leg: Leg) => leg.Route?.route_short_name || leg.RouteID || "service"

function settingOff(legs: Leg[], progressLegIndex: number, tz: string): JourneyMoment[] {
    if (progressLegIndex !== 0 || legs.length < 2 || legs[0].Mode !== "walk" || legs[1].Mode !== "transit") return []
    const lb = leaveBy(legs[0])
    if (!lb) return []
    const ride = legs[1]
    const name = momentRouteName(ride)
    const boardAt = ride.FromStop?.stop_name ?? "your stop"
    const dep = t(ride.DepartureTime)
    const departs = dep ? ` at ${laClock(dep, tz)}` : ""
    return [
        { key: "leave:ready", date: new Date(lb.getTime() - GET_READY_LEAD), title: "Get ready to leave", body: `Leave in 5 min to walk to ${boardAt} for the ${name}${departs}.` },
        { key: "leave:now", date: new Date(lb.getTime() - 30_000), title: "Time to leave", body: `Walk to ${boardAt} for the ${name}${departs}.` },
    ]
}

/** The journey's key moments still ahead, as local notifications. */
export function upcomingMoments(legs: Leg[], progressLegIndex: number, onboard: boolean, now: Date, tz: string, setOff = false): JourneyMoment[] {
    const moments = setOff ? [] : settingOff(legs, progressLegIndex, tz)
    legs.forEach((leg, index) => {
        if (index < Math.max(0, progressLegIndex) || leg.Mode !== "transit") return
        const name = momentRouteName(leg)
        const skipBoard = onboard && index === progressLegIndex
        const dep = t(leg.DepartureTime)
        if (!skipBoard && dep) {
            const stop = leg.FromStop ? ` at ${leg.FromStop.stop_name}${leg.FromStop.platform_number ? `, platform ${leg.FromStop.platform_number}` : ""}` : ""
            moments.push({ key: `${leg.TripID}:board-soon`, date: new Date(dep.getTime() - BOARD_LEAD), title: `The ${name} is due in 3 min`, body: `Get ready to board${stop}.` })
        }
        const arr = t(leg.ArrivalTime)
        if (arr) {
            const stop = leg.ToStop ? ` at ${leg.ToStop.stop_name}` : ""
            moments.push({ key: `${leg.TripID}:alight-soon`, date: new Date(arr.getTime() - ALIGHT_LEAD), title: "Your stop is coming up", body: `Get ready to get off the ${name}${stop}.` })
        }
    })
    return moments.filter((m) => m.date > now)
}

export function dueBoardingMoment(legs: Leg[], progressLegIndex: number, onboard: boolean, now: Date, tz: string): JourneyMoment | null {
    return upcomingMoments(legs, progressLegIndex, onboard, new Date(now.getTime() - 60_000), tz).find((m) => m.key.endsWith(":board-soon") && m.date <= now) ?? null
}

// ---------------------------------------------------------------------------
// offline pack

/** Everything a tracked journey needs with no connection, refreshed on every successful poll. */
export interface OfflineJourneyPack {
    plan: JourneyType
    regionSlug: string
    tripStops: Record<string, TripStopRef[]>
    stopTimes: Record<string, StopTimeUpdate[]>
    rideShapes: Record<string, RouteShape>
    /** By walk leg index. */
    walkDirections: Record<number, WalkingDirections>
    rides?: Record<string, RideProgress>
    /** Epoch ms. */
    savedAt: number
}

export function isPackComplete(pack: OfflineJourneyPack): boolean {
    return pack.plan.Legs.filter((l) => l.Mode === "transit").every((l) => (pack.tripStops[l.TripID] ?? []).length > 0)
}

/** Each walk's endpoints (plan start/end standing in for missing stops). */
export function walkEndpoints(plan: JourneyType): { index: number; from: Coordinate; to: Coordinate }[] {
    const out: { index: number; from: Coordinate; to: Coordinate }[] = []
    plan.Legs.forEach((leg, index) => {
        if (leg.Mode !== "walk") return
        const from = leg.FromStop ? { lat: leg.FromStop.stop_lat, lon: leg.FromStop.stop_lon } : index === 0 ? { lat: plan.StartLat, lon: plan.StartLon } : null
        const to = leg.ToStop ? { lat: leg.ToStop.stop_lat, lon: leg.ToStop.stop_lon } : index === plan.Legs.length - 1 ? { lat: plan.EndLat, lon: plan.EndLon } : null
        if (from && to) out.push({ index, from, to })
    })
    return out
}
