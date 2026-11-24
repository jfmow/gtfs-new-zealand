import type { Coordinate } from "../models"
import { haversineMeters } from "./basics"

/**
 * Home's "Go" bar: the place the rider most likely wants to get to right now,
 * so one tap plans and starts the journey.
 */

export interface GoPlace {
    kind: "home" | "work" | "other"
    label: string
    lat: number
    lon: number
}

/** A journey the rider started: where to, and when (on the region's clock). */
export interface GoTrip {
    lat: number
    lon: number
    /** Hour of the day, with minutes as a fraction (8.5 = 8:30). */
    hour: number
    weekend: boolean
    /** Epoch ms. */
    at: number
}

/** Closer than this to a place, you're at it - so you're not going there. */
export const AT_PLACE_METERS = 400
/** A started journey counts towards a saved place this close to its end. */
export const TRIP_MATCH_METERS = 250
/** How far either side of now (in hours) a past trip counts as "this time". */
export const TRIP_HOUR_WINDOW = 1.5
/** Trips older than this are forgotten. */
export const TRIP_MAX_AGE_MS = 60 * 24 * 3600_000
/** Matching trips needed before habit beats the Home/Work rule. */
export const HABIT_MIN_TRIPS = 2

export interface GoContext {
    /** Saved places, in the rider's order. */
    places: GoPlace[]
    here: Coordinate | null
    /** Now, on the region's clock. */
    hour: number
    weekend: boolean
    /** Recent planner destinations, newest first. */
    recent?: GoPlace[]
    /** Journeys the rider started. */
    trips?: GoTrip[]
    now?: number
}

/** Hours between two times of day, the short way round midnight. */
function hourGap(a: number, b: number): number {
    const d = Math.abs(a - b) % 24
    return Math.min(d, 24 - d)
}

/** How many past journeys went to `p` at about this time on this kind of day. */
export function habitScore(p: GoPlace, ctx: GoContext): number {
    const now = ctx.now ?? Date.now()
    return (ctx.trips ?? []).filter((t) =>
        now - t.at <= TRIP_MAX_AGE_MS &&
        t.weekend === ctx.weekend &&
        hourGap(t.hour, ctx.hour) <= TRIP_HOUR_WINDOW &&
        haversineMeters(t, p) <= TRIP_MATCH_METERS,
    ).length
}

/**
 * Where to go, first match wins:
 * 1. Habit: the saved place (any kind) you've most often started a journey to
 *    at about this time on this kind of day - weekday or weekend - at least
 *    HABIT_MIN_TRIPS times in the last 60 days.
 * 2. Home and Work: whichever you're not at; elsewhere, Work in the morning
 *    and Home from midday.
 * 3. The one of Home/Work that's saved, unless you're there.
 * 4. Your other saved places, in your order.
 * 5. The most recent destination you searched for.
 * Never a place you're at. Null when nothing fits.
 */
export function likelyDestination(ctx: GoContext): GoPlace | null {
    const { places, here } = ctx
    const at = (p: GoPlace | undefined) => !!p && !!here && haversineMeters(here, p) < AT_PLACE_METERS
    const away = places.filter((p) => !at(p))

    let best: GoPlace | null = null
    let bestScore = HABIT_MIN_TRIPS - 1
    for (const p of away) {
        const score = habitScore(p, ctx)
        if (score > bestScore) {
            best = p
            bestScore = score
        }
    }
    if (best) return best

    const home = places.find((p) => p.kind === "home")
    const work = places.find((p) => p.kind === "work")
    if (home && work) {
        if (at(home)) return work
        if (at(work)) return home
        return ctx.hour >= 4 && ctx.hour < 12 ? work : home
    }
    const one = home ?? work
    if (one && !at(one)) return one
    const other = away.find((p) => p.kind === "other")
    if (other) return other
    return (ctx.recent ?? []).find((r) => !at(r)) ?? null
}
