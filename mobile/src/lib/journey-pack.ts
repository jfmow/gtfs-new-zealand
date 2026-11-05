import type { TripStopRef } from "@transit/shared/models"
import type { JourneyType } from "@transit/shared/types/journey"
import { api } from "./api"
import { queryClient } from "./plans"
import { unwrap } from "./queries"
import { stored, useStored } from "./storage"

/**
 * The tracked journey saved on the phone - iOS's offline pack. With the plan
 * and every ride's stops on disk, a journey resumes and keeps tracking (from
 * GPS and the timetable) after a relaunch with no signal.
 */
export interface JourneyPack {
    planId: string
    regionUrl: string
    plan: JourneyType
    /** Stops for each ride, by trip id. */
    stopsByTrip: Record<string, TripStopRef[]>
    savedAt: number
}

export const journeyPackStore = stored<JourneyPack | null>("journey-pack", null)

export function useJourneyPack(planId: string | undefined) {
    const [pack] = useStored(journeyPackStore)
    return pack && pack.planId === planId ? pack : null
}

/** Save `plan` and its rides' stops. Keeps whatever's already saved if a fetch fails. */
export async function saveJourneyPack(plan: JourneyType, regionUrl: string) {
    const existing = journeyPackStore.get()
    const base = existing?.planId === plan.ID ? existing.stopsByTrip : {}
    const tripIds = [...new Set(plan.Legs.filter((l) => l.Mode === "transit" && l.TripID).map((l) => l.TripID))]
    const stopsByTrip: Record<string, TripStopRef[]> = { ...base }
    await Promise.all(tripIds.filter((id) => !stopsByTrip[id]?.length).map(async (id) => {
        const cached = queryClient.getQueryData<TripStopRef[]>(["trip-stops", regionUrl, id])
        if (cached?.length) { stopsByTrip[id] = cached; return }
        try {
            const stops = (await unwrap(api.stopsForTrip(id))) ?? []
            if (stops.length) stopsByTrip[id] = stops
        } catch { /* offline - try again next time */ }
    }))
    journeyPackStore.set({ planId: plan.ID, regionUrl, plan, stopsByTrip, savedAt: Date.now() })
}

/** Every ride's stops are on the phone - the journey can carry on with no signal. */
export function packIsComplete(pack: JourneyPack | null): boolean {
    if (!pack) return false
    const tripIds = pack.plan.Legs.filter((l) => l.Mode === "transit" && l.TripID).map((l) => l.TripID)
    return tripIds.every((id) => (pack.stopsByTrip[id]?.length ?? 0) > 0)
}

/** Put the saved journey back into the query cache, so screens find it with no network. */
export function seedFromPack(pack: JourneyPack) {
    if (!queryClient.getQueryData(["plan", pack.planId])) queryClient.setQueryData(["plan", pack.planId], pack.plan)
    for (const [id, stops] of Object.entries(pack.stopsByTrip)) {
        if (!queryClient.getQueryData(["trip-stops", pack.regionUrl, id])) queryClient.setQueryData(["trip-stops", pack.regionUrl, id], stops)
    }
}

export function clearJourneyPack() {
    journeyPackStore.set(null)
}
