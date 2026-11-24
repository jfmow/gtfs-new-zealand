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

/** Closer than this to a place, you're at it - so you're not going there. */
export const AT_PLACE_METERS = 400

/**
 * Where to go: if you're at home, work (and the other way round); otherwise
 * work in the morning and home from midday. With only one of the two saved,
 * that one unless you're there; failing that the most recent destination you
 * aren't at. Null when there's nothing sensible to offer.
 */
export function likelyDestination(places: GoPlace[], here: Coordinate | null, localHour: number, recent: GoPlace[] = []): GoPlace | null {
    const home = places.find((p) => p.kind === "home")
    const work = places.find((p) => p.kind === "work")
    const at = (p: GoPlace | undefined) => !!p && !!here && haversineMeters(here, p) < AT_PLACE_METERS
    if (home && work) {
        if (at(home)) return work
        if (at(work)) return home
        return localHour >= 4 && localHour < 12 ? work : home
    }
    const one = home ?? work
    if (one && !at(one)) return one
    return recent.find((r) => !at(r)) ?? null
}
