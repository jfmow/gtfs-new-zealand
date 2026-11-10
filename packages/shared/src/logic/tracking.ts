/**
 * Live journey tracking - which leg the rider is on, whether they've
 * boarded, their phase, what to follow on the map, and how much GPS that
 * needs. Ported line for line from iOS `JourneyProgressModel.swift`,
 * `JourneyTrackingSupport.swift` and `JourneyGPSPolicy.swift` (themselves
 * ports of the web's `route-detail-sheet.tsx`). Getting this wrong shows the
 * rider the wrong leg or stops tracking early, so behaviour - including the
 * documented one-tick lag - is kept exactly.
 */
import { goTime, type Coordinate, type StopTimeUpdate, type TripStopRef, type Vehicle } from "../models"
import type { JourneyType, Leg, Stop } from "../types/journey"
import { haversineMeters, roundHalfAway } from "./basics"

const t = (d: Date | string | null | undefined) => goTime(d as string | Date | null | undefined)
const stopCoord = (s: Stop): Coordinate => ({ lat: s.stop_lat, lon: s.stop_lon })
const vehicleCoord = (v: Vehicle): Coordinate => ({ lat: v.position.lat, lon: v.position.lon })

// ---------------------------------------------------------------------------
// support (JourneyTracking)

/**
 * A leg's board/alight stop within a trip's own stop list, matched by id
 * (the plan's sequence isn't populated). Prefers the exact platform, and
 * looks for the alighting stop only after the boarding one - a trip can call
 * at the same station twice (Newmarket on the Southern line, fixed 2026-09-23).
 */
export function findStopSequence(stops: TripStopRef[], legStop: Stop | null | undefined, afterSeq?: number | null): number | null {
    if (!legStop) return null
    const candidates = afterSeq !== undefined && afterSeq !== null ? stops.filter((s) => s.sequence > afterSeq) : stops
    const exact = candidates.find((s) => s.child_stop_id === legStop.stop_id)
    if (exact) return exact.sequence
    if (!legStop.parent_station) return null
    return candidates.find((s) => s.parent_stop_id === legStop.parent_station)?.sequence ?? null
}

/**
 * Has the vehicle pulled away from the stop at `stopSeq`? `current_stop`
 * keeps pointing at a stop until the next is reached, so it's also departed
 * when current is the stop, next is beyond it and the feed says it's moving.
 * Conservative at clamped ends and with state "Unknown".
 */
export function hasDepartedStop(vehicle: Vehicle | null | undefined, stopSeq: number | null | undefined): boolean {
    const trip = vehicle?.trip
    if (!trip || stopSeq === null || stopSeq === undefined) return false
    const current = trip.current_stop?.sequence
    if (current === undefined) return false
    if (current > stopSeq) return true
    const next = trip.next_stop?.sequence
    if (next === undefined) return false
    return current === stopSeq && next > stopSeq && (vehicle?.state === "Leaving" || vehicle?.state === "Travelling")
}

export interface ConnectionRisk {
    level: "missed" | "tight"
    /** Minutes actually available - negative means the connection has already gone. */
    transferMinutes: number
}

const MIN_TRANSFER_SECONDS = 60

/** For the ride at `index`: whether live times still leave time to change from the previous ride. Null for the first ride or >= 90 s slack. */
export function connectionRisk(legs: Leg[], index: number): ConnectionRisk | null {
    if (index < 0 || index >= legs.length || legs[index].Mode !== "transit") return null
    let prev = -1
    for (let i = index - 1; i >= 0; i--) {
        if (legs[i].Mode === "transit") {
            prev = i
            break
        }
        if (legs[i].Mode === "walk") continue
        break
    }
    if (prev < 0) return null
    let walkSeconds = 0
    for (let j = prev + 1; j < index; j++) if (legs[j].Mode === "walk") walkSeconds += legs[j].Duration / 1e9
    const dep = t(legs[index].DepartureTime)
    const arr = t(legs[prev].ArrivalTime)
    if (!dep || !arr) return null
    const gap = (dep.getTime() - arr.getTime()) / 1000
    const slack = gap - walkSeconds - MIN_TRANSFER_SECONDS
    if (slack >= 90) return null
    return { level: slack < 0 ? "missed" : "tight", transferMinutes: roundHalfAway((gap - walkSeconds) / 60) }
}

// ---------------------------------------------------------------------------
// progress model

export type JourneyPhase = "walking" | "waiting" | "boarding" | "onboard"
/** `estimated`: the "vehicle" is the rider's own GPS matched to the trip (offline). */
export type TrackingLevel = "live" | "estimated" | "predicted" | "scheduled"

export interface JourneyProgressSnapshot {
    currentLegIndex: number
    transitFloor: number
    guardedLegIndex: number
    activeTransitLegIndex: number | null
    trackedTripId: string | null
    boarded: boolean
    waitingAtStop: boolean
    trackedStopsAway: number | null
    trackedStopsToGo: number | null
    phase: JourneyPhase | null
    trackingLevel: TrackingLevel
    journeyArrived: boolean
    /** -1 before start, legs.length once arrived, else guardedLegIndex. */
    progressLegIndex: number
    /** "vehicle-<tripId>" to follow, or null to follow the rider / nothing. */
    followMarkerId: string | null
    followFitWithStop: Coordinate | null
    riderWalking: boolean
}

export interface JourneyProgressInput {
    plan: JourneyType
    displayPlan: JourneyType
    now: Date
    vehiclesByTripId: Record<string, Vehicle>
    stopTimesByTripId: Record<string, StopTimeUpdate[]>
    journeyStarted: boolean
    trackedStops: TripStopRef[]
    userLocation: Coordinate | null
    estimatedTripIds?: Set<string>
    holdAtStart?: boolean
}

export class JourneyProgressModel {
    alightedThroughLeg = -1
    atBoardStop = false

    static readonly overdueSkipSeconds = 5 * 60
    static readonly atStopEnterMeters = 40
    static readonly atStopExitMeters = 120
    static readonly boardingWindowSeconds = 90
    /** Generous on purpose - understating it let a walk go "current" while still on the train (2026-09-16). */
    static readonly alightGraceSeconds = 3 * 60
    static readonly nearAlightMeters = 220
    static readonly nearBoardBusMeters = 350
    static readonly leftVehicleMeters = 10

    /** Restores the "already got off" ratchet after a relaunch. Only moves forward. */
    restore(alightedThroughLeg: number) {
        this.alightedThroughLeg = Math.max(this.alightedThroughLeg, alightedThroughLeg)
    }

    reset() {
        this.alightedThroughLeg = -1
        this.atBoardStop = false
    }

    update(input: JourneyProgressInput): JourneyProgressSnapshot {
        const { plan, displayPlan, now, vehiclesByTripId: vehicles, stopTimesByTripId, journeyStarted, trackedStops, userLocation } = input
        const estimated = input.estimatedTripIds ?? new Set<string>()
        const legs = plan.Legs
        const displayLegs = displayPlan.Legs
        const nowMs = now.getTime()

        const currentLegIndex = JourneyProgressModel.computeCurrentLegIndex(displayLegs, nowMs)
        const transitFloor = JourneyProgressModel.computeTransitFloor(legs, displayLegs, this.alightedThroughLeg, vehicles, nowMs)
        let guardedLegIndex = Math.min(Math.max(currentLegIndex, this.alightedThroughLeg + 1), transitFloor)
        if (input.holdAtStart && this.alightedThroughLeg < 0 && displayLegs[0]?.Mode === "walk") {
            const ride = displayLegs.findIndex((l) => l.Mode === "transit")
            const departure = ride >= 0 ? t(displayLegs[ride].DepartureTime) : null
            if (ride >= 0 && guardedLegIndex <= ride && departure && nowMs < departure.getTime()) guardedLegIndex = 0
        }

        const activeTransitLegIndex = JourneyProgressModel.computeActiveTransitLegIndex(legs, currentLegIndex, transitFloor, vehicles, nowMs)
        const trackedTripId = journeyStarted && activeTransitLegIndex !== null && vehicles[legs[activeTransitLegIndex].TripID] ? legs[activeTransitLegIndex].TripID : null
        const trackedVehicle = trackedTripId ? vehicles[trackedTripId] : null
        let trackedLegIndex: number | null = null
        if (trackedTripId) {
            const idx = legs.findIndex((l) => l.TripID === trackedTripId)
            trackedLegIndex = idx >= 0 ? idx : null
        } else if (journeyStarted) {
            trackedLegIndex = activeTransitLegIndex
        }
        const trackedLeg = trackedLegIndex !== null ? legs[trackedLegIndex] : null
        const trackedBoardStop = trackedLeg?.FromStop ?? null
        const trackedAlightStop = trackedLeg?.ToStop ?? null
        const trackedBoardSeq = findStopSequence(trackedStops, trackedBoardStop)
        const trackedAlightSeq = findStopSequence(trackedStops, trackedAlightStop, trackedBoardSeq)
        const boarded = hasDepartedStop(trackedVehicle, trackedBoardSeq)
        // Read before the hysteresis update below - the one-tick lag is intentional.
        const waitingAtStop = this.atBoardStop && !boarded

        if (journeyStarted && trackedLegIndex !== null && trackedAlightSeq !== null &&
            (hasDepartedStop(trackedVehicle, trackedAlightSeq) || JourneyProgressModel.riderLeftVehicleAtStop(trackedVehicle, trackedAlightSeq, userLocation))) {
            this.alightedThroughLeg = Math.max(this.alightedThroughLeg, trackedLegIndex)
        }
        this.updateAtBoardStop(journeyStarted, trackedBoardStop, userLocation)

        const targetSeq = boarded ? trackedAlightSeq : trackedBoardSeq
        const nextSeq = trackedVehicle?.trip?.next_stop?.sequence
        let trackedStopsAway: number | null = null
        if (trackedVehicle && trackedVehicle.state !== "Unknown" && targetSeq !== null && nextSeq !== undefined) {
            trackedStopsAway = Math.max(0, targetSeq - nextSeq)
        }
        let trackedStopsToGo: number | null = null
        if (trackedVehicle && trackedVehicle.state !== "Unknown" && targetSeq !== null) {
            const current = trackedVehicle.trip?.current_stop?.sequence
            if (trackedVehicle.state === "AtStop" && current !== undefined) trackedStopsToGo = Math.max(0, targetSeq - current)
            else if (nextSeq !== undefined) trackedStopsToGo = Math.max(0, targetSeq - nextSeq + 1)
        }

        let journeyArrived = false
        const lastLeg = displayLegs[displayLegs.length - 1]
        if (journeyStarted && lastLeg && currentLegIndex === displayLegs.length - 1 && transitFloor >= displayLegs.length) {
            const arrival = t(lastLeg.ArrivalTime)
            journeyArrived = !!arrival && nowMs >= arrival.getTime()
        }
        const progressLegIndex = !journeyStarted ? -1 : journeyArrived ? displayLegs.length : guardedLegIndex
        const activeLeg = progressLegIndex >= 0 && progressLegIndex < displayLegs.length ? displayLegs[progressLegIndex] : null
        const phase = JourneyProgressModel.computePhase(journeyStarted, activeLeg, boarded, waitingAtStop, trackedVehicle, trackedBoardStop, trackedBoardSeq, nowMs)

        let trackingLevel: TrackingLevel = "scheduled"
        if (trackedTripId && estimated.has(trackedTripId)) trackingLevel = "estimated"
        else if (trackedVehicle) trackingLevel = "live"
        else if (activeTransitLegIndex !== null && (stopTimesByTripId[legs[activeTransitLegIndex].TripID] ?? []).length > 0) trackingLevel = "predicted"

        const guardedLeg = guardedLegIndex >= 0 && guardedLegIndex < displayLegs.length ? displayLegs[guardedLegIndex] : null
        const riderWalking = journeyStarted && guardedLeg?.Mode === "walk" && !waitingAtStop && !boarded
        const followMarkerId = trackedVehicle && !riderWalking ? `vehicle-${trackedVehicle.trip_id}` : null
        const followFitWithStop = followMarkerId && waitingAtStop && trackedBoardStop ? stopCoord(trackedBoardStop) : null

        return {
            currentLegIndex, transitFloor, guardedLegIndex, activeTransitLegIndex, trackedTripId, boarded, waitingAtStop,
            trackedStopsAway, trackedStopsToGo, phase, trackingLevel, journeyArrived, progressLegIndex, followMarkerId,
            followFitWithStop, riderWalking,
        }
    }

    static computeCurrentLegIndex(displayLegs: Leg[], nowMs: number): number {
        for (let i = 0; i < displayLegs.length; i++) {
            const arrival = t(displayLegs[i].ArrivalTime)
            if (arrival && nowMs < arrival.getTime()) return i
        }
        return Math.max(0, displayLegs.length - 1)
    }

    static computeTransitFloor(legs: Leg[], displayLegs: Leg[], alightedThroughLeg: number, vehicles: Record<string, Vehicle>, nowMs: number): number {
        const start = Math.max(0, alightedThroughLeg + 1)
        if (start >= legs.length) return legs.length
        for (let i = start; i < legs.length; i++) {
            const leg = legs[i]
            if (leg.Mode !== "transit") continue
            if (vehicles[leg.TripID]) return i
            const arrival = t((i < displayLegs.length ? displayLegs[i] : leg).ArrivalTime)
            if (arrival && (nowMs - arrival.getTime()) / 1000 <= JourneyProgressModel.alightGraceSeconds) return i
        }
        return legs.length
    }

    static computeActiveTransitLegIndex(legs: Leg[], currentLegIndex: number, transitFloor: number, vehicles: Record<string, Vehicle>, nowMs: number): number | null {
        if (currentLegIndex < 0) return null
        const upcoming = legs.map((_, i) => i).filter((i) => i >= transitFloor && legs[i].Mode === "transit")
        if (upcoming.length === 0) return null
        const firstIndex = upcoming[0]
        const first = legs[firstIndex]
        const dep = t(first.DepartureTime)
        if (!vehicles[first.TripID] && dep && (nowMs - dep.getTime()) / 1000 > JourneyProgressModel.overdueSkipSeconds) {
            const live = upcoming.find((i) => vehicles[legs[i].TripID])
            if (live !== undefined) return live
        }
        return firstIndex
    }

    static computePhase(journeyStarted: boolean, activeLeg: Leg | null, boarded: boolean, waitingAtStop: boolean, vehicle: Vehicle | null, boardStop: Stop | null, boardSeq: number | null, nowMs: number): JourneyPhase | null {
        if (!journeyStarted || !activeLeg) return null
        if (activeLeg.Mode === "walk") return waitingAtStop ? "waiting" : "walking"
        if (boarded) return "onboard"
        const currentSeq = vehicle?.trip?.current_stop?.sequence
        if (vehicle && vehicle.state !== "Unknown" && boardSeq !== null && currentSeq !== undefined) {
            const nextSeq = vehicle.trip?.next_stop?.sequence
            const nextIsBoard = nextSeq !== undefined && nextSeq === boardSeq
            const atOrPast = currentSeq >= boardSeq
            const metres = boardStop ? haversineMeters(vehicleCoord(vehicle), stopCoord(boardStop)) : Infinity
            const atBoard = (nextIsBoard && metres <= JourneyProgressModel.boardProximityThreshold(vehicle.type)) || atOrPast
            return atBoard ? "boarding" : "waiting"
        }
        const dep = t(activeLeg.DepartureTime)
        if (!dep) return "waiting"
        return (dep.getTime() - nowMs) / 1000 <= JourneyProgressModel.boardingWindowSeconds ? "boarding" : "waiting"
    }

    /** Buses are request-stop, so need more lead; everything else uses the tighter distance. */
    static boardProximityThreshold(vehicleType: string): number {
        return vehicleType === "bus" || vehicleType === "school bus" ? JourneyProgressModel.nearBoardBusMeters : JourneyProgressModel.nearAlightMeters
    }

    /** The vehicle is stopped at (or past) the alight stop and the rider has walked away from it. */
    static riderLeftVehicleAtStop(vehicle: Vehicle | null, alightSeq: number, userLocation: Coordinate | null): boolean {
        if (!vehicle || vehicle.state === "Unknown" || !userLocation) return false
        const current = vehicle.trip?.current_stop?.sequence
        if (current === undefined || current < alightSeq) return false
        if (!(current > alightSeq || vehicle.state !== "Arriving")) return false
        return haversineMeters(userLocation, vehicleCoord(vehicle)) >= JourneyProgressModel.leftVehicleMeters
    }

    private updateAtBoardStop(journeyStarted: boolean, boardStop: Stop | null, userLocation: Coordinate | null) {
        if (!journeyStarted || !boardStop || !userLocation) {
            this.atBoardStop = false
            return
        }
        const d = haversineMeters(userLocation, stopCoord(boardStop))
        this.atBoardStop = this.atBoardStop ? d < JourneyProgressModel.atStopExitMeters : d <= JourneyProgressModel.atStopEnterMeters
    }
}

// ---------------------------------------------------------------------------
// GPS policy

/** Cheapest to dearest. On screen it's always precise (the map follows the rider). */
export type GPSMode = "resting" | "coarse" | "pedestrian" | "precise"
const GPS_RANK: Record<GPSMode, number> = { resting: 0, coarse: 1, pedestrian: 2, precise: 3 }

/** Fixes good enough to place the rider on a walk or ride. Coarse fixes must never place them. */
export function gpsPlacesRider(mode: GPSMode): boolean {
    return GPS_RANK[mode] >= GPS_RANK.pedestrian
}

export const GPSPolicy = {
    resumeStopsAway: 3,
    resumeBeforeArrivalMs: 5 * 60_000,
    coarseUntilLeaveMs: 10 * 60_000,
    momentLeadMs: 5 * 60_000,
}

export interface GPSPolicyInput {
    appActive: boolean
    offline: boolean
    phase: JourneyPhase | null
    boarded: boolean
    trackingLevel: TrackingLevel
    liveFresh: boolean
    stopsAway: number | null
    alightAt: Date | null
    waitingToSetOff: boolean
    leaveAt: Date | null
    now: Date
}

export function canRest(i: Omit<GPSPolicyInput, "waitingToSetOff" | "leaveAt">): boolean {
    return !i.appActive && !i.offline && i.phase === "onboard" && i.boarded && i.trackingLevel === "live" && i.liveFresh &&
        i.stopsAway !== null && i.stopsAway > GPSPolicy.resumeStopsAway &&
        i.alightAt !== null && i.alightAt.getTime() - i.now.getTime() > GPSPolicy.resumeBeforeArrivalMs
}

export function gpsMode(i: GPSPolicyInput): GPSMode {
    if (i.appActive) return "precise"
    if (canRest(i)) return "resting"
    if (i.waitingToSetOff && i.leaveAt && i.leaveAt.getTime() - i.now.getTime() > GPSPolicy.coarseUntilLeaveMs) return "coarse"
    if (i.phase === "walking" || i.phase === "waiting") return "pedestrian"
    return "precise"
}

/** The next moment is close (boarding, a few stops from getting off, or within 5 min) - poll at the quick pace. Unknown counts as close. */
export function isMomentNear(phase: JourneyPhase | null, stopsAway: number | null, nextMomentAt: Date | null, now: Date): boolean {
    if (phase === "boarding") return true
    if (phase === "onboard" && stopsAway !== null && stopsAway <= GPSPolicy.resumeStopsAway) return true
    if (!nextMomentAt) return true
    return nextMomentAt.getTime() - now.getTime() <= GPSPolicy.momentLeadMs
}
