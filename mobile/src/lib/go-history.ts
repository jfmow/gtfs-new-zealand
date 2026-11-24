import { TRIP_MAX_AGE_MS, type GoTrip } from "@transit/shared/logic/go"
import type { JourneyType } from "@transit/shared/types/journey"
import { regions } from "./region"
import { stored, useStored } from "./storage"

/**
 * The journeys you've started - where to and when - kept on this phone so
 * Home's Go bar can offer the place you usually head to at this time
 * (likelyDestination in @transit/shared/logic/go). Per region, last 60 days,
 * at most MAX_TRIPS.
 */
const MAX_TRIPS = 300

interface StoredTrip extends GoTrip {
    region: string
}

const goTripsStore = stored<StoredTrip[]>("go-trips", [])

/** The hour (8.5 = 8:30) and weekend-ness of `at` on `tz`'s clock. */
export function clockOf(at: Date, tz: string): { hour: number; weekend: boolean } {
    const parts = new Intl.DateTimeFormat("en-NZ", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
    const weekday = get("weekday")
    return { hour: Number(get("hour")) + Number(get("minute")) / 60, weekend: weekday.startsWith("Sat") || weekday.startsWith("Sun") }
}

/** Notes a journey started to `plan`'s destination, now. */
export function recordGoTrip(plan: JourneyType, regionUrl: string) {
    const tz = regions.find((r) => r.url === regionUrl)?.timeZone
    if (!tz || !plan.EndLat || !plan.EndLon) return
    const now = Date.now()
    const trip: StoredTrip = { region: regionUrl, lat: plan.EndLat, lon: plan.EndLon, at: now, ...clockOf(new Date(now), tz) }
    goTripsStore.set((prev) => [trip, ...prev.filter((t) => now - t.at <= TRIP_MAX_AGE_MS)].slice(0, MAX_TRIPS))
}

/** This region's started journeys. */
export function useGoTrips(regionUrl: string): GoTrip[] {
    const [all] = useStored(goTripsStore)
    return all.filter((t) => t.region === regionUrl)
}
