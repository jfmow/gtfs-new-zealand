/**
 * The journey Live Activity's content - the exact JSON the iOS widget's
 * `JourneyActivityAttributes.ContentState` decodes and the backend's
 * `journeyActivityState` (live_activity_state.go) pushes. A port of iOS
 * `LiveActivityContentBuilder.swift`; the Android live notification renders
 * the same content, so wording matches the server on both platforms.
 */
import { goTime } from "../models"
import { travelModeForRouteType } from "../endpoints"
import type { Leg, Stop } from "../types/journey"
import { laClock } from "./journey-live"
import { roundHalfAway } from "./basics"

const t = (d: Date | string | null | undefined) => goTime(d as string | Date | null | undefined)

export interface LiveActivityContent {
    version: number
    legIndex: number
    /** walking | waiting | boarding | onboard | arrived */
    phase: string
    routeShortName: string
    routeColorHex: string
    headsign: string
    primaryText: string
    secondaryText: string
    countdownLabel: string
    targetUnix: number
    delayMinutes: number
    /** onTime | delayed | early | cancelled | missedConnection | tightConnection | arrived */
    status: string
    stopsAway?: number
    arrivalUnix: number
    progressFraction: number
    totalLegs: number
    platform?: string
    nextLeg?: { routeShortName: string; routeColorHex: string; departureUnix: number; connectMinutes: number }
    legChain: { mode: string; shortName: string; colorHex: string }[]
    updatedUnix: number
    isRealtime: boolean
    boardStopName?: string
    alightStopName?: string
    nextStopName?: string
    rideStops?: number
    walkMinutes?: number
    walkMeters?: number
    hasVehicle?: boolean
    occupancy?: number
    offline?: boolean
    vehicleMode?: string
    segmentStartUnix?: number
    segmentEndUnix?: number
    urgent?: boolean
}

export interface LiveActivityProgress {
    legIndex: number
    phase: string | null
    arrived: boolean
    stopsAway?: number | null
    nextStopName?: string | null
    isRealtime?: boolean
    hasVehicle?: boolean
    rideStops?: number | null
    occupancy?: number | null
    offline?: boolean
    setOffAt?: Date | null
    stillAtStart?: boolean
}

const GET_READY_LEAD = 5 * 60_000
const LEAVE_NOW_SHOWN_FOR = 3 * 60_000
const MISS_TOLERANCE = 60_000

function emptyContent(): LiveActivityContent {
    return {
        version: 3, legIndex: 0, phase: "walking", routeShortName: "", routeColorHex: "", headsign: "", primaryText: "", secondaryText: "",
        countdownLabel: "", targetUnix: 0, delayMinutes: 0, status: "onTime", arrivalUnix: 0, progressFraction: 0, totalLegs: 0, legChain: [],
        updatedUnix: 0, isRealtime: false,
    }
}

const unix = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null)
const shortName = (leg: Leg) => (leg.Mode === "walk" ? "" : leg.Route?.route_short_name || leg.RouteID)
const vehicleMode = (leg: Leg) => (leg.Route?.route_type !== undefined ? travelModeForRouteType(leg.Route.route_type) : undefined)
const routeLabel = (leg: Leg) => leg.Route?.route_short_name || "service"
const stopLabel = (stop: Stop | null | undefined) => (stop && stop.stop_name ? stop.stop_name : "your destination")
const platformOf = (leg: Leg) => leg.FromStop?.platform_number || undefined
const platformSuffix = (p: string | undefined) => (p ? ` · Platform ${p}` : "")
const stopsText = (n: number) => (n === 1 ? "1 stop" : `${n} stops`)
const nextTransit = (legs: Leg[], i: number) => {
    for (let j = i + 1; j < legs.length; j++) if (legs[j].Mode !== "walk") return j
    return null
}
const previousTransit = (legs: Leg[], i: number) => {
    for (let j = i - 1; j >= 0; j--) if (legs[j].Mode !== "walk") return j
    return null
}

function setSegment(c: LiveActivityContent, start: Date | null, end: Date | null) {
    if (!start || !end || end <= start) return
    c.segmentStartUnix = start.getTime() / 1000
    c.segmentEndUnix = end.getTime() / 1000
}

/** The departure delay until on board, then the arrival delay (as the Go builder's statusFor). */
function delaySeconds(leg: Leg, phase: string): number {
    const dep = t(leg.DepartureTime)
    const sched = t(leg.scheduled_departure_time)
    if (phase !== "onboard" && dep && sched) return roundHalfAway((dep.getTime() - sched.getTime()) / 1000)
    return leg.delay_seconds ?? 0
}
const delayMinutes = (leg: Leg, phase: string) => roundHalfAway(delaySeconds(leg, phase) / 60)

function statusOf(leg: Leg, phase: string): string {
    const rt = (leg.realtime_status as string | undefined) ?? ""
    if (!leg.trip_usable || rt === "canceled" || rt === "cancelled" || (phase === "waiting" && rt === "skipped")) return "cancelled"
    const delay = delaySeconds(leg, phase)
    if (delay >= 120) return "delayed"
    if (delay <= -120) return "early"
    return "onTime"
}

/** The leave-by time rounded down to the minute (earlier is the safe side). */
export function leaveBy(walk: Leg): Date | null {
    const d = t(walk.DepartureTime)
    return d ? new Date(Math.floor(d.getTime() / 60_000) * 60_000) : null
}

export function runningNote(leg: Leg): string {
    const m = delayMinutes(leg, "waiting")
    return m === 0 ? "" : ` · running ${Math.abs(m)} min ${m > 0 ? "late" : "early"}`
}

export function spareNote(spareMs: number): string {
    const m = Math.trunc(spareMs / 60_000)
    return m >= 1 ? `${m} min spare` : "just in time"
}

function fillRide(c: LiveActivityContent, leg: Leg, p: LiveActivityProgress) {
    c.boardStopName = leg.FromStop?.stop_name
    c.alightStopName = leg.ToStop?.stop_name
    c.hasVehicle = !!p.hasVehicle
    if (p.hasVehicle && p.nextStopName) c.nextStopName = p.nextStopName
    if (p.rideStops && p.rideStops > 0) c.rideStops = p.rideStops
    if (p.occupancy !== undefined && p.occupancy !== null) c.occupancy = p.occupancy
}

function applyConnection(c: LiveActivityContent, legs: Leg[], from: number, to: number, tz: string) {
    const next = legs[to]
    const arrive = t(legs[from].ArrivalTime)
    const depart = t(next.DepartureTime)
    if (!arrive || !depart) return
    let walk = 0
    for (let j = from + 1; j < to; j++) {
        if (legs[j].Mode !== "walk") continue
        const d = t(legs[j].DepartureTime), a = t(legs[j].ArrivalTime)
        if (d && a) walk += a.getTime() - d.getTime()
    }
    const transfer = depart.getTime() - arrive.getTime() - walk
    const connect = roundHalfAway(transfer / 60_000)
    c.nextLeg = { routeShortName: shortName(next), routeColorHex: next.Route?.route_color ?? "", departureUnix: depart.getTime() / 1000, connectMinutes: connect }
    if (c.status === "cancelled") return
    const rt = (next.realtime_status as string | undefined) ?? ""
    if (rt === "canceled" || rt === "cancelled" || rt === "skipped") {
        c.status = "missedConnection"
        const what = rt === "skipped" ? `won't stop at ${next.FromStop?.stop_name ?? "your stop"}` : "has been cancelled"
        c.secondaryText = `The ${routeLabel(next)} at ${laClock(depart, tz)} ${what}`
    } else if (transfer < 0) {
        c.status = "missedConnection"
        c.secondaryText = `You'll likely miss the ${routeLabel(next)} at ${laClock(depart, tz)}`
    } else if (transfer - 60_000 < 90_000) {
        c.status = "tightConnection"
        c.secondaryText = `Then ${routeLabel(next)} at ${laClock(depart, tz)} · ${connect} min to change`
    }
}

function fillOnTheWay(c: LiveActivityContent, walk: Leg, next: Leg, boardAt: string, now: Date, tz: string) {
    const route = routeLabel(next)
    c.primaryText = `Walk to ${boardAt}`
    c.countdownLabel = "Departs in"
    const left = t(walk.DepartureTime), planned = t(walk.ArrivalTime), depart = t(next.DepartureTime)
    if (!left || !planned || !depart) {
        c.secondaryText = `${route} departs ${laClock(next.DepartureTime, tz)}${platformSuffix(c.platform)}`
        return
    }
    const reach = new Date(Math.max(planned.getTime(), now.getTime()))
    c.targetUnix = unix(depart) ?? 0
    setSegment(c, left, reach)
    const spare = depart.getTime() - reach.getTime()
    if (spare < -MISS_TOLERANCE) {
        if (c.status !== "cancelled") c.status = "missedConnection"
        c.secondaryText = `You'll likely miss the ${route} at ${laClock(depart, tz)}`
        return
    }
    c.secondaryText = `${route} departs ${laClock(depart, tz)}${platformSuffix(c.platform)} · ${spareNote(spare)}`
}

function fillWalking(c: LiveActivityContent, legs: Leg[], idx: number, p: LiveActivityProgress, now: Date, tz: string) {
    const leg = legs[idx]
    c.phase = "walking"
    c.headsign = stopLabel(leg.ToStop)
    const ld = t(leg.DepartureTime), la = t(leg.ArrivalTime)
    if (ld && la) c.walkMinutes = Math.max(1, roundHalfAway((la.getTime() - ld.getTime()) / 60_000))
    if (leg.DistanceKm > 0) c.walkMeters = roundHalfAway(leg.DistanceKm * 1000)
    const f = nextTransit(legs, idx)
    if (f === null) {
        c.primaryText = leg.ToStop ? (leg.ToStop.stop_name ? `Walk to ${leg.ToStop.stop_name}` : "Walk to your destination") : "Walk to your destination"
        c.secondaryText = `Arrive about ${laClock(la, tz)}`
        c.countdownLabel = "Arrive in"
        c.targetUnix = unix(la) ?? c.arrivalUnix
        setSegment(c, ld, la)
        c.status = "onTime"
        return
    }
    const next = legs[f]
    c.routeShortName = shortName(next)
    c.routeColorHex = next.Route?.route_color ?? ""
    c.vehicleMode = vehicleMode(next)
    c.platform = platformOf(next)
    fillRide(c, next, p)
    if (p.hasVehicle && p.stopsAway !== undefined && p.stopsAway !== null && p.stopsAway >= 0) c.stopsAway = p.stopsAway
    c.status = statusOf(next, "waiting")
    c.delayMinutes = delayMinutes(next, "waiting")
    const boardAt = stopLabel(next.FromStop)
    const isFirstWalk = previousTransit(legs, idx) === null

    if (isFirstWalk && p.setOffAt) {
        fillOnTheWay(c, leg, next, boardAt, now, tz)
        return
    }
    const lb = leaveBy(leg)
    if (isFirstWalk && lb && now.getTime() < lb.getTime() - 30_000) {
        c.primaryText = `Leave by ${laClock(lb, tz)}`
        c.secondaryText = `Walk to ${boardAt} for the ${routeLabel(next)}${runningNote(next)}`
        c.countdownLabel = "Leave in"
        c.targetUnix = unix(lb) ?? 0
        if (now.getTime() >= lb.getTime() - GET_READY_LEAD) {
            c.primaryText = "Get ready to leave"
            c.secondaryText = `Leave by ${laClock(lb, tz)} · walk to ${boardAt} for the ${routeLabel(next)}${runningNote(next)}`
            c.urgent = true
        }
        return
    }
    const nd = t(next.DepartureTime)
    c.primaryText = `Walk to ${boardAt}`
    c.secondaryText = `${routeLabel(next)} departs ${laClock(nd, tz)}${platformSuffix(c.platform)}`
    c.countdownLabel = "Departs in"
    c.targetUnix = unix(nd) ?? 0
    setSegment(c, ld, la)
    if (isFirstWalk && lb && ld && la && nd) {
        const walkMs = la.getTime() - ld.getTime()
        if (p.stillAtStart && now.getTime() + walkMs > nd.getTime() + MISS_TOLERANCE) {
            if (c.status !== "cancelled") c.status = "missedConnection"
            c.primaryText = `Too late for the ${routeLabel(next)}`
            c.secondaryText = `It departs ${laClock(nd, tz)}${runningNote(next)} · ${Math.max(1, roundHalfAway(walkMs / 60_000))} min walk away`
        } else if (now.getTime() < lb.getTime() + LEAVE_NOW_SHOWN_FOR || (p.stillAtStart && now.getTime() + walkMs <= nd.getTime())) {
            c.primaryText = "Leave now"
            c.secondaryText = `Walk to ${boardAt} · ${routeLabel(next)} departs ${laClock(nd, tz)}${platformSuffix(c.platform)}`
            c.urgent = true
        }
    }
    const prev = previousTransit(legs, idx)
    if (prev !== null) applyConnection(c, legs, prev, f, tz)
}

function fillTransit(c: LiveActivityContent, legs: Leg[], idx: number, p: LiveActivityProgress, tz: string) {
    const leg = legs[idx]
    const route = routeLabel(leg)
    c.routeShortName = shortName(leg)
    c.routeColorHex = leg.Route?.route_color ?? ""
    c.vehicleMode = vehicleMode(leg)
    c.headsign = stopLabel(leg.ToStop)
    fillRide(c, leg, p)
    const away = p.stopsAway
    if (p.phase !== "onboard") {
        c.phase = p.phase === "boarding" || away === 0 ? "boarding" : "waiting"
        c.platform = platformOf(leg)
        c.countdownLabel = "Departs in"
        c.targetUnix = unix(t(leg.DepartureTime)) ?? 0
        if (idx > 0) setSegment(c, t(legs[idx - 1].ArrivalTime), t(leg.DepartureTime))
        c.delayMinutes = delayMinutes(leg, "waiting")
        c.status = statusOf(leg, "waiting")
        c.primaryText = c.phase === "boarding" ? `Your ${route} is arriving` : `Board the ${route}`
        let secondary = `at ${stopLabel(leg.FromStop)}${platformSuffix(c.platform)}`
        if (away !== undefined && away !== null && away >= 0) {
            c.stopsAway = away
            if (away > 0) secondary += ` · ${stopsText(away)} away`
        }
        c.secondaryText = secondary
        return
    }
    c.phase = "onboard"
    c.countdownLabel = "Arrives in"
    c.targetUnix = unix(t(leg.ArrivalTime)) ?? 0
    setSegment(c, t(leg.DepartureTime), t(leg.ArrivalTime))
    c.delayMinutes = delayMinutes(leg, "onboard")
    c.status = statusOf(leg, "onboard")
    const alight = stopLabel(leg.ToStop)
    if (away !== undefined && away !== null && away >= 0) {
        c.stopsAway = away
        if (away === 0) {
            c.primaryText = "Get off at the next stop"
            c.secondaryText = alight
        } else {
            c.primaryText = `Get off at ${alight}`
            c.secondaryText = `${stopsText(away + 1)} to go`
            if (p.nextStopName) c.secondaryText += ` · next ${p.nextStopName}`
        }
    } else {
        c.primaryText = `Get off at ${alight}`
        c.secondaryText = `Arrive ${laClock(leg.ArrivalTime, tz)}`
    }
    const f = nextTransit(legs, idx)
    if (f !== null) applyConnection(c, legs, idx, f, tz)
}

function progressFraction(idx: number, count: number, leg: Leg, now: Date): number {
    let frac = 0
    const d = t(leg.DepartureTime), a = t(leg.ArrivalTime)
    if (d && a && a > d && now > d) frac = Math.min(1, (now.getTime() - d.getTime()) / (a.getTime() - d.getTime()))
    return Math.max(0, Math.min(1, (idx + frac) / count))
}

/** `legs` should be live-adjusted (buildLiveJourney). Times are worded on the clock in `tz`. */
export function buildLiveActivityContent(legs: Leg[], progress: LiveActivityProgress, tz: string, now: Date = new Date()): LiveActivityContent {
    const c = emptyContent()
    c.totalLegs = legs.length
    c.legChain = legs.slice(0, 6).map((leg) =>
        leg.Mode === "walk" ? { mode: "walk", shortName: "", colorHex: "" } : { mode: vehicleMode(leg) ?? "transit", shortName: shortName(leg), colorHex: leg.Route?.route_color ?? "" })
    c.updatedUnix = Math.floor(now.getTime() / 1000)
    c.isRealtime = !!progress.isRealtime
    if (progress.offline) c.offline = true
    c.arrivalUnix = unix(t(legs[legs.length - 1]?.ArrivalTime)) ?? c.updatedUnix
    const idx = progress.legIndex
    if (legs.length === 0 || progress.arrived || idx < 0 || idx >= legs.length) {
        c.legIndex = Math.max(0, legs.length - 1)
        c.phase = "arrived"
        c.status = "arrived"
        c.primaryText = "You've arrived"
        c.targetUnix = c.arrivalUnix
        c.progressFraction = 1
        return c
    }
    c.legIndex = idx
    const leg = legs[idx]
    if (leg.Mode === "walk") fillWalking(c, legs, idx, progress, now, tz)
    else fillTransit(c, legs, idx, progress, tz)
    c.progressFraction = progressFraction(idx, legs.length, leg, now)
    return c
}
