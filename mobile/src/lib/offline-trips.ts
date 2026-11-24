import { useEffect } from "react"
import { AppState } from "react-native"
import type { JourneyPlanRequest } from "@transit/shared/endpoints"
import { haversineMeters } from "@transit/shared/logic/basics"
import { goTime, type Coordinate, type TripStopRef } from "@transit/shared/models"
import { getRegionSlug, type Region } from "@transit/shared/regions"
import type { JourneyType } from "@transit/shared/types/journey"
import { normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { api } from "./api"
import { plannerOptionsStore } from "./planner-store"
import { queryClient } from "./plans"
import { settingsStore, savedTripsStore, type SavedTrip } from "./saved"
import { stored, useStored } from "./storage"

/**
 * Saved trips planned ahead, for planning with no signal. While online the
 * app asks the server for each saved trip's departures over the next few
 * hours and keeps them on the phone with every ride's stops (so a journey
 * started from one tracks offline too, like the tracked journey's pack). If
 * the planner can't reach the server, it shows these instead.
 */

export interface TripPlansPack {
    tripId: string
    regionUrl: string
    from: Coordinate
    to: Coordinate
    fetchedAt: number
    plans: JourneyType[]
    /** Stops for each ride, by trip id. */
    stopsByTrip: Record<string, TripStopRef[]>
}

const MAX_TRIPS = 4
const PLANS_PER_TRIP = 8
const STOPS_FOR_PLANS = 4
/** Refreshed when older than this (and the app is open with a signal). */
const REFRESH_AFTER_MS = 30 * 60_000
/** Start and end must be this close to a saved trip's to use its pack. */
const MATCH_START_M = 400
const MATCH_END_M = 200
/** Points kept per map line, so the pack stays small. */
const MAX_LINE_POINTS = 60

export const offlineTripPlansStore = stored<Record<string, TripPlansPack>>("offline-trip-plans", {})

/** Keeps every `step`th point of each line (and its last), so a stored plan's map stays light. */
function thinGeometry(plan: JourneyType): JourneyType {
    const geo = plan.RouteGeoJSON as unknown as { type?: string; features?: { geometry?: { type?: string; coordinates?: number[][] } }[] } | null
    if (!geo?.features) return plan
    const features = geo.features.map((f) => {
        const coords = f.geometry?.coordinates
        if (!coords || f.geometry?.type !== "LineString" || coords.length <= MAX_LINE_POINTS) return f
        const step = Math.ceil(coords.length / MAX_LINE_POINTS)
        const thin = coords.filter((_, i) => i % step === 0)
        if (thin[thin.length - 1] !== coords[coords.length - 1]) thin.push(coords[coords.length - 1])
        return { ...f, geometry: { ...f.geometry, coordinates: thin } }
    })
    return { ...plan, RouteGeoJSON: { ...geo, features } as unknown as JourneyType["RouteGeoJSON"], LeaveLater: undefined }
}

async function planTrip(trip: SavedTrip, region: Region): Promise<TripPlansPack | null> {
    const options = plannerOptionsStore.get()
    const req: JourneyPlanRequest = {
        start: { lat: trip.from.lat, lon: trip.from.lon },
        end: { lat: trip.to.lat, lon: trip.to.lon },
        timeType: "now",
        walkSpeed: Number(normalizeWalkSpeed(settingsStore.get().walkSpeed)),
        maxWalkKm: options.maxWalkKm,
        maxTransfers: options.maxTransfers,
        modes: options.modes,
        accessible: options.accessible || undefined,
        // As many as the server gives: its range scan fills in the next
        // departures across the following hour and a half.
        minResults: 10,
    }
    const res = await api.plan(req)
    if (!res.ok || !res.data?.length) return null
    const plans = [...res.data]
    // A second batch from where the first ends covers the next few hours.
    const lastFirstRide = Math.max(...plans.map((p) => goTime(p.Legs.find((l) => l.Mode === "transit")?.DepartureTime as unknown as string)?.getTime() ?? 0))
    if (lastFirstRide > Date.now()) {
        const more = await api.plan({ ...req, timeType: "departat", date: new Date(lastFirstRide + 60_000) })
        if (more.ok && more.data) plans.push(...more.data)
    }
    const kept = plans
        .sort((a, b) => (goTime(a.DepartureTime as unknown as string)?.getTime() ?? 0) - (goTime(b.DepartureTime as unknown as string)?.getTime() ?? 0))
        .slice(0, PLANS_PER_TRIP)
        .map(thinGeometry)
    const stopsByTrip: Record<string, TripStopRef[]> = {}
    const tripIds = [...new Set(kept.slice(0, STOPS_FOR_PLANS).flatMap((p) => p.Legs.filter((l) => l.Mode === "transit" && l.TripID).map((l) => l.TripID)))]
    await Promise.all(tripIds.map(async (id) => {
        const r = await api.stopsForTrip(id)
        if (r.ok && r.data?.length) stopsByTrip[id] = r.data
    }))
    return { tripId: trip.id, regionUrl: region.url, from: trip.from, to: trip.to, fetchedAt: Date.now(), plans: kept, stopsByTrip }
}

let refreshing = false

/** Re-plans the region's saved trips whose packs are old (or missing); drops packs for trips that are gone. */
export async function refreshOfflineTripPlans(region: Region, force = false) {
    if (refreshing) return
    refreshing = true
    try {
        const slug = getRegionSlug(region)
        const trips = savedTripsStore.get().filter((t) => t.region === slug).slice(0, MAX_TRIPS)
        const current = offlineTripPlansStore.get()
        const next: Record<string, TripPlansPack> = {}
        for (const [id, pack] of Object.entries(current)) {
            if (pack.regionUrl !== region.url || trips.some((t) => t.id === id)) next[id] = pack
        }
        for (const trip of trips) {
            const pack = next[trip.id]
            if (!force && pack && Date.now() - pack.fetchedAt < REFRESH_AFTER_MS) continue
            try {
                const fresh = await planTrip(trip, region)
                if (fresh) next[trip.id] = fresh
            } catch { /* offline - keep the old pack */ }
        }
        offlineTripPlansStore.set(next)
    } finally {
        refreshing = false
    }
}

/** Keeps saved trips' packs fresh: on launch, when the app comes back, and when the trips change. */
export function useOfflineTripPlans(region: Region) {
    const [trips] = useStored(savedTripsStore)
    useEffect(() => {
        refreshOfflineTripPlans(region).catch(() => {})
        const sub = AppState.addEventListener("change", (s) => {
            if (s === "active") refreshOfflineTripPlans(region).catch(() => {})
        })
        return () => sub.remove()
    }, [region, trips.length])
}

/**
 * Saved plans for a search from `start` to `end`, if it's one of the saved
 * trips: the ones that haven't left yet, with their rides' stops put where
 * the journey pack looks for them (so tracking one works offline).
 */
export function offlinePlansFor(start: Coordinate, end: Coordinate, regionUrl: string, now = Date.now()): { plans: JourneyType[]; fetchedAt: number } | null {
    for (const pack of Object.values(offlineTripPlansStore.get())) {
        if (pack.regionUrl !== regionUrl) continue
        if (haversineMeters(start, pack.from) > MATCH_START_M || haversineMeters(end, pack.to) > MATCH_END_M) continue
        const plans = pack.plans.filter((p) => {
            const ride = p.Legs.find((l) => l.Mode === "transit")
            const dep = goTime((ride?.DepartureTime ?? p.DepartureTime) as unknown as string)
            return !!dep && dep.getTime() > now
        })
        if (!plans.length) return null
        for (const [tripId, stops] of Object.entries(pack.stopsByTrip)) {
            if (!queryClient.getQueryData(["trip-stops", regionUrl, tripId])) queryClient.setQueryData(["trip-stops", regionUrl, tripId], stops)
        }
        return { plans, fetchedAt: pack.fetchedAt }
    }
    return null
}
