/**
 * Realtime-shifted plans and mid-journey replanning - ported from iOS
 * `JourneyLiveAdjuster.swift` and `JourneyReplan.swift`.
 */
import { goTime, type Coordinate, type StopTimeUpdate } from "../models"
import type { JourneyType, Leg, Stop } from "../types/journey"
import { RealtimeStatus } from "../types/journey"
import { roundHalfAway } from "./basics"

const t = (d: Date | string | null | undefined) => goTime(d as string | Date | null | undefined)

/** "9:05am" on the clock in `tz` - same as the Go builder's `clock`. */
export function laClock(date: Date | string | null | undefined, tz: string): string {
    const d = t(date)
    if (!d) return ""
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d).map((p) => [p.type, p.value]),
    ) as Record<string, string>
    return `${parts.hour}:${parts.minute}${(parts.dayPeriod ?? "").toLowerCase()}`
}

/**
 * A trip can visit the same stop twice - picks the occurrence closest in
 * time to the leg's own, matching by child stop, parent station, then a
 * parent-to-parent match.
 */
function stopTimeFor(stopTimes: StopTimeUpdate[], legStop: Stop | null, targetMs: number): StopTimeUpdate | null {
    if (!legStop) return null
    const matches = stopTimes.filter((s) =>
        s.child_stop_id === legStop.stop_id || (legStop.parent_station !== "" && s.parent_stop_id === legStop.parent_station) || s.parent_stop_id === legStop.stop_id)
    if (matches.length <= 1) return matches[0] ?? null
    const time = (s: StopTimeUpdate) => s.scheduled_time || s.arrival_time || s.departure_time
    return matches.reduce((best, s) => (Math.abs(time(s) - targetMs) < Math.abs(time(best) - targetMs) ? s : best))
}

function shiftedToRealtime(plan: JourneyType, stopTimesByTripId: Record<string, StopTimeUpdate[]>): JourneyType {
    if (Object.keys(stopTimesByTripId).length === 0) return plan
    const legs: Leg[] = plan.Legs.map((l) => ({ ...l }))
    let changed = false
    legs.forEach((leg, i) => {
        if (leg.Mode !== "transit" || !leg.TripID) return
        const stopTimes = stopTimesByTripId[leg.TripID]
        if (!stopTimes) return
        const board = stopTimeFor(stopTimes, leg.FromStop, t(leg.DepartureTime)?.getTime() ?? 0)
        const alight = stopTimeFor(stopTimes, leg.ToStop, t(leg.ArrivalTime)?.getTime() ?? 0)
        if (!board || !alight || board.departure_time === 0 || alight.arrival_time === 0) return
        const depart = new Date(board.departure_time)
        const arrive = new Date(Math.max(alight.arrival_time, board.departure_time))
        legs[i] = { ...leg, DepartureTime: depart, ArrivalTime: arrive, Duration: (arrive.getTime() - depart.getTime()) * 1e6 }
        if (alight.scheduled_time !== 0) {
            const delay = roundHalfAway((alight.arrival_time - alight.scheduled_time) / 1000)
            legs[i].delay_seconds = delay
            legs[i].realtime_status = delay > 60 ? RealtimeStatus.Delayed : delay < -60 ? RealtimeStatus.Early : RealtimeStatus.OnTime
        }
        changed = true
    })
    if (!changed) return plan

    const original = plan.Legs
    legs.forEach((leg, i) => {
        if (leg.Mode !== "walk") return
        const durMs = original[i].Duration / 1e6
        const prevArrival = i > 0 && legs[i - 1].Mode === "transit" ? t(legs[i - 1].ArrivalTime) : null
        const nextDeparture = i + 1 < legs.length && legs[i + 1].Mode === "transit" ? t(legs[i + 1].DepartureTime) : null
        if (prevArrival) {
            // Transfer / final walk: start when the ride arrives; slack is a wait after the walk.
            legs[i] = { ...leg, DepartureTime: prevArrival, ArrivalTime: new Date(prevArrival.getTime() + durMs) }
        } else if (nextDeparture) {
            // Leading walk: keep the plan's own buffer before the ride, as the server does.
            let buffer = 0
            const plannedBoard = i === 0 ? t(original[i + 1].DepartureTime) : null
            const plannedArrive = i === 0 ? t(original[i].ArrivalTime) : null
            if (plannedBoard && plannedArrive) buffer = Math.max(0, plannedBoard.getTime() - plannedArrive.getTime())
            const arrive = new Date(nextDeparture.getTime() - buffer)
            legs[i] = { ...leg, ArrivalTime: arrive, DepartureTime: new Date(arrive.getTime() - durMs) }
        }
    })
    const first = t(legs[0]?.DepartureTime)
    const last = t(legs[legs.length - 1]?.ArrivalTime)
    if (!first || !last) return plan
    return { ...plan, Legs: legs, DepartureTime: first, ArrivalTime: last, TotalDuration: (last.getTime() - first.getTime()) * 1e6 }
}

function anchoringFirstWalk(plan: JourneyType, original: JourneyType, setOffAt: Date): JourneyType {
    if (plan.Legs[0]?.Mode !== "walk" || original.Legs[0]?.Mode !== "walk") return plan
    const durMs = original.Legs[0].Duration / 1e6
    const legs = plan.Legs.map((l) => ({ ...l }))
    legs[0].DepartureTime = setOffAt
    legs[0].ArrivalTime = new Date(setOffAt.getTime() + durMs)
    const last = t(legs[legs.length - 1].ArrivalTime)
    return { ...plan, Legs: legs, DepartureTime: setOffAt, TotalDuration: last ? (last.getTime() - setOffAt.getTime()) * 1e6 : plan.TotalDuration }
}

/**
 * `plan` with transit legs shifted to realtime/stop-times predictions, walks
 * re-anchored to their neighbouring ride. With `setOffAt` the first walk
 * runs from when the rider actually left.
 */
export function buildLiveJourney(plan: JourneyType, stopTimesByTripId: Record<string, StopTimeUpdate[]>, setOffAt?: Date | null): JourneyType {
    const live = shiftedToRealtime(plan, stopTimesByTripId)
    return setOffAt ? anchoringFirstWalk(live, plan, setOffAt) : live
}

// ---------------------------------------------------------------------------
// replan

export interface ReplanChoice {
    key: string
    label: string
    detail: string
    originLabel: string
    origin: Coordinate
    departAt: Date
}

/** The ways it makes sense to re-plan from where the rider is - usually two; none on the final leg. */
export function replanChoices(args: {
    legs: Leg[]
    progressLegIndex: number
    phase: string | null
    vehicleNextStop: { name: string; coordinate: Coordinate } | null
    vehicleNextStopETA: Date | null
    userLocation: Coordinate | null
    now?: Date
    tz: string
}): ReplanChoice[] {
    const { legs, progressLegIndex: idx, phase, vehicleNextStop, vehicleNextStopETA, userLocation, tz } = args
    const now = args.now ?? new Date()
    if (idx < 0 || idx >= legs.length - 1) return []
    const leg = legs[idx]
    const out: ReplanChoice[] = []
    const fromStop = (stop: Stop, key: string, label: string, detail: string, departAt: Date): ReplanChoice => ({
        key, label, detail, originLabel: stop.stop_name || label, origin: { lat: stop.stop_lat, lon: stop.stop_lon }, departAt,
    })
    const ride = leg.Mode === "transit" ? leg : legs.slice(idx + 1).find((l) => l.Mode === "transit")
    const rideName = ride?.Route?.route_short_name || ride?.RouteID || "the next service"

    if (phase === "onboard" && leg.Mode === "transit") {
        if (vehicleNextStop) {
            out.push({
                key: "next-stop", label: `Get off at ${vehicleNextStop.name}`,
                detail: vehicleNextStopETA ? `re-route from ~${laClock(vehicleNextStopETA, tz)}` : "re-route from there",
                originLabel: vehicleNextStop.name, origin: vehicleNextStop.coordinate,
                departAt: vehicleNextStopETA ?? new Date(now.getTime() + 120_000),
            })
        }
        const arrival = t(leg.ArrivalTime)
        if (leg.ToStop && arrival) out.push(fromStop(leg.ToStop, "alight", `Stay on to ${leg.ToStop.stop_name}`, `re-route from there (arr ${laClock(arrival, tz)})`, arrival))
        return out
    }
    if (phase === "walking" && leg.Mode === "walk") {
        if (userLocation) out.push({ key: "gps-now", label: "From where I am now", detail: "current location", originLabel: "Current location", origin: userLocation, departAt: now })
        const arrival = t(leg.ArrivalTime)
        if (leg.ToStop && arrival) out.push(fromStop(leg.ToStop, "target-stop", `From ${leg.ToStop.stop_name}`, `when you get there (~${laClock(arrival, tz)})`, arrival))
        return out
    }
    const here = leg.Mode === "transit" ? leg.FromStop : leg.ToStop
    if (here) out.push(fromStop(here, "here-now", `Leave from ${here.stop_name} now`, "a different way from here", now))
    const rideArrival = ride ? t(ride.ArrivalTime) : null
    if (ride?.ToStop && rideArrival) {
        out.push(fromStop(ride.ToStop, "onward", `Take the ${rideName} anyway`, `re-route from ${ride.ToStop.stop_name} (arr ${laClock(rideArrival, tz)})`, rideArrival))
    }
    return out
}
