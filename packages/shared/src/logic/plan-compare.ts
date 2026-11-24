import { goTime } from "../models"
import type { JourneyType, Leg } from "../types/journey"

/**
 * Comparing planner results at a glance: every result card draws its journey
 * as a strip on one shared clock, so a later start, a shorter ride or a long
 * wait at a change stands out without reading times. Also what changed when
 * the results refresh themselves.
 */

const ms = (d: unknown) => goTime(d as Date | string | null)?.getTime() ?? null

export interface PlanAxis {
    /** Epoch ms at the left and right edges. */
    start: number
    end: number
    /** Gridline times (epoch ms), on whole steps of the clock. */
    ticks: number[]
}

const TICK_STEPS_MIN = [5, 10, 15, 20, 30, 60, 120]

/** The shared clock for a set of results: earliest departure to latest arrival, on round ticks (at most `maxTicks`). */
export function planAxis(plans: JourneyType[], maxTicks = 5): PlanAxis | null {
    let start = Infinity
    let end = -Infinity
    for (const p of plans) {
        const d = ms(p.DepartureTime)
        const a = ms(p.ArrivalTime)
        if (d !== null) start = Math.min(start, d)
        if (a !== null) end = Math.max(end, a)
    }
    if (!isFinite(start) || !isFinite(end) || end <= start) return null
    const spanMin = (end - start) / 60_000
    const step = (TICK_STEPS_MIN.find((s) => spanMin / s <= maxTicks) ?? 240) * 60_000
    const ticks: number[] = []
    for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t)
    return { start, end, ticks }
}

/** Where a time sits on the axis, 0..1. */
export function axisFraction(axis: PlanAxis, t: number): number {
    return Math.min(1, Math.max(0, (t - axis.start) / (axis.end - axis.start)))
}

export interface StripSegment {
    kind: "walk" | "ride"
    leg: Leg
    index: number
    /** Left edge and width as fractions of the axis. */
    left: number
    width: number
}

/** A plan's legs placed on the axis. Gaps between segments are waiting time. */
export function stripSegments(plan: JourneyType, axis: PlanAxis): StripSegment[] {
    const out: StripSegment[] = []
    plan.Legs.forEach((leg, index) => {
        const d = ms(leg.DepartureTime)
        const a = ms(leg.ArrivalTime)
        if (d === null || a === null || a <= d) return
        const left = axisFraction(axis, d)
        out.push({ kind: leg.Mode === "transit" ? "ride" : "walk", leg, index, left, width: Math.max(0, axisFraction(axis, a) - left) })
    })
    return out
}

/** The rides a plan takes (trip ids) - the same journey across a refresh, whatever its new id. */
export function planSignature(plan: JourneyType): string {
    return plan.Legs.filter((l) => l.Mode === "transit").map((l) => l.TripID || l.RouteID).join("|") || "walk"
}

export interface PlanChange {
    /** Minutes later (+) or earlier (-) than when the rider last saw it. */
    arrivalDeltaMin: number
}

/** How a refreshed plan differs from the version shown before (same rides); null when it hasn't moved. */
export function planChange(before: JourneyType | undefined, after: JourneyType): PlanChange | null {
    if (!before || planSignature(before) !== planSignature(after)) return null
    const b = ms(before.ArrivalTime)
    const a = ms(after.ArrivalTime)
    if (a === null || b === null) return null
    const delta = Math.round((a - b) / 60_000)
    return delta === 0 ? null : { arrivalDeltaMin: delta }
}

/**
 * Changes with less than `minSlackMs` to spare once the walk between rides
 * is done - the ones a small delay breaks. Returns the index of each ride
 * changed onto.
 */
export function tightChanges(plan: JourneyType, minSlackMs = 60_000): number[] {
    const out: number[] = []
    let lastArrival: number | null = null
    let walkMs = 0
    plan.Legs.forEach((leg, i) => {
        if (leg.Mode !== "transit") {
            walkMs += leg.Duration / 1e6
            return
        }
        const dep = ms(leg.DepartureTime)
        if (lastArrival !== null && dep !== null && dep - lastArrival - walkMs < minSlackMs) out.push(i)
        lastArrival = ms(leg.ArrivalTime)
        walkMs = 0
    })
    return out
}

/** Minutes the plan's LeaveLater option gains (0 if none). */
export function leaveLaterMinutes(plan: JourneyType): number {
    if (!plan.LeaveLater) return 0
    const a = ms(plan.DepartureTime)
    const b = ms(plan.LeaveLater.DepartureTime)
    return a === null || b === null ? 0 : Math.max(0, Math.round((b - a) / 60_000))
}
