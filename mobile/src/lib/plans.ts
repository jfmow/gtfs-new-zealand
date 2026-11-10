import { QueryClient, useQuery } from "@tanstack/react-query"
import type { JourneyPlanRequest, TravelMode } from "@transit/shared/endpoints"
import { getRegionSlug } from "@transit/shared/regions"
import { reliabilityChangeKeys, type ReliabilityConnection } from "@transit/shared/reliability"
import type { JourneyType } from "@transit/shared/types/journey"
import { api } from "./api"
import { unwrap } from "./queries"
import { useRegion } from "./region"
import { useSettings } from "./saved"

export const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

/**
 * The search a plan came from - iOS `PlannerSearchContext`: what a leave-by
 * reminder re-plans with each day, and the labels to show and save.
 */
export interface PlanContext {
    start: { label: string; lat: number; lon: number } | null
    end: { label: string; lat: number; lon: number } | null
    arriveBy: boolean
    maxWalkKm: number
    walkSpeed: number
    maxTransfers: number
    onlyRoutes: string[]
    modes?: TravelMode[]
    minTransferSec?: number
}

const contexts = new Map<string, PlanContext>()

/** Plans keyed by id, so the detail/tracking screens open the exact plan without refetching. */
export function rememberPlans(plans: JourneyType[], context?: PlanContext) {
    for (const p of plans) {
        queryClient.setQueryData(["plan", p.ID], p)
        if (context) contexts.set(p.ID, context)
    }
}

/** The search behind a plan from this session, if there was one. */
export function planContext(id: string): PlanContext | undefined {
    return contexts.get(id)
}

/** The context for plans from `req` - what's saved with them for reminders, saved trips and the tracker's labels. */
export function contextFor(req: JourneyPlanRequest, start: { label: string; lat: number; lon: number }, end: { label: string; lat: number; lon: number }): PlanContext {
    return {
        start: { label: start.label, lat: start.lat, lon: start.lon },
        end: { label: end.label, lat: end.lat, lon: end.lon },
        arriveBy: req.timeType === "arriveat",
        maxWalkKm: req.maxWalkKm ?? 1,
        walkSpeed: req.walkSpeed ?? 1,
        maxTransfers: req.maxTransfers ?? 5,
        onlyRoutes: req.onlyRoutes ?? [],
        modes: req.modes,
        minTransferSec: req.minTransferSec,
    }
}

/** A plan by id: from this session's results, else `services/plan/:id` (shared links, reminders). */
export function usePlan(id: string | undefined) {
    const { region, ready } = useRegion()
    return useQuery({
        queryKey: ["plan", id],
        queryFn: async () => {
            const plans = (await unwrap(api.planById(id!))) ?? []
            if (!plans[0]) throw new Error("This journey has expired - plan it again.")
            return plans[0]
        },
        enabled: ready && !!id,
        staleTime: Infinity,
        meta: { region: region.url },
    })
}

/** Fare estimates for plans, by id - empty while Show fares is off or the server has no fares. */
export function useFares(planIds: string[]) {
    const { region, ready } = useRegion()
    const [settings] = useSettings()
    const fareType = settings.fareType[getRegionSlug(region)] ?? "adult"
    const q = useQuery({
        queryKey: ["fares", region.url, fareType, planIds.join(",")],
        queryFn: async () => (await unwrap(api.fares(planIds, fareType)))?.fares ?? {},
        enabled: ready && settings.showFares && planIds.length > 0,
        staleTime: 10 * 60_000,
        retry: false,
    })
    return settings.showFares ? q.data ?? {} : {}
}

/** How often each change in a plan works out, by the index of the ride changed to. */
export function useConnectionOdds(plan: JourneyType | undefined) {
    const { region, ready } = useRegion()
    const keys = plan ? [...reliabilityChangeKeys(plan.Legs).entries()].sort((a, b) => a[0] - b[0]) : []
    const q = useQuery({
        queryKey: ["odds", region.url, plan?.ID],
        queryFn: async () => {
            const res = await unwrap(api.connections(keys.map(([, k]) => k)))
            const out = new Map<number, ReliabilityConnection>()
            keys.forEach(([i], n) => { const c = res?.changes[n]; if (c) out.set(i, c) })
            return out
        },
        enabled: ready && keys.length > 0,
        staleTime: Infinity,
        retry: false,
    })
    return q.data
}

/** Which of a plan's rides have a vehicle reporting now - polled while the preview is open. Rides over 3 h off keep the plan's answer. */
export function useLiveTripIds(plan: JourneyType | undefined) {
    const { region, ready } = useRegion()
    const ids = plan?.Legs.filter((l) => l.Mode === "transit" && l.TripID).map((l) => l.TripID) ?? []
    const q = useQuery({
        queryKey: ["live-trips", region.url, ids.join(",")],
        queryFn: async () => new Set(((await unwrap(api.liveVehicles({ tripIds: ids }))) ?? []).map((v) => v.trip_id)),
        enabled: ready && ids.length > 0 && region.realtime !== false,
        refetchInterval: 30_000,
    })
    return q.data
}
