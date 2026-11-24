import { rankedPlans } from "@transit/shared/easy-planner"
import type { JourneyPlanRequest } from "@transit/shared/endpoints"
import { pruneDominatedPlans } from "@transit/shared/logic/basics"
import type { Coordinate } from "@transit/shared/models"
import type { JourneyType, Leg } from "@transit/shared/types/journey"
import { legDate } from "@/components/journey"
import { api } from "./api"
import { rememberPlans, type PlanContext } from "./plans"

export type MissedResult = { kind: "ok"; plan: JourneyType } | { kind: "error"; title: string; message: string }

/**
 * Plans again after the rider missed `missed`: from where they are, to the
 * same place with the same options, leaving no earlier than a minute after
 * the missed ride (realtime may still think it's at the stop) and never on
 * that trip again.
 */
export async function replanAfterMissed(args: { missed: Leg; from: Coordinate; to: { label: string; lat: number; lon: number }; context?: PlanContext }): Promise<MissedResult> {
    const { missed, from, to, context } = args
    const missedDep = legDate(missed.DepartureTime)?.getTime() ?? 0
    const leaveAt = Math.max(Date.now(), missedDep + 60_000)
    const req: JourneyPlanRequest = {
        start: from,
        end: { lat: to.lat, lon: to.lon },
        timeType: leaveAt > Date.now() + 60_000 ? "departat" : "now",
        date: leaveAt > Date.now() + 60_000 ? new Date(leaveAt) : undefined,
        walkSpeed: context?.walkSpeed,
        maxWalkKm: context?.maxWalkKm,
        maxTransfers: context?.maxTransfers,
        modes: context?.modes,
        onlyRoutes: context?.onlyRoutes,
        minTransferSec: context?.minTransferSec,
        accessible: context?.accessible,
    }
    const res = await api.plan(req)
    if (!res.ok) return { kind: "error", title: "Couldn't plan right now", message: "Check your connection and try again." }
    const options = (res.data ?? []).filter((p) => !p.Legs.some((l) => l.Mode === "transit" && l.TripID === missed.TripID))
    const best = rankedPlans(pruneDominatedPlans(options), null)[0]
    if (!best) return { kind: "error", title: "No other way right now", message: "Nothing else gets there from here at the moment. Try Find a better route for more choices." }
    rememberPlans(options, {
        start: { label: "Your location", lat: from.lat, lon: from.lon },
        end: context?.end ?? to,
        arriveBy: false,
        maxWalkKm: context?.maxWalkKm ?? 1,
        walkSpeed: context?.walkSpeed ?? 3.6,
        maxTransfers: context?.maxTransfers ?? 5,
        onlyRoutes: context?.onlyRoutes ?? [],
        modes: context?.modes,
        minTransferSec: context?.minTransferSec,
        accessible: context?.accessible,
    })
    return { kind: "ok", plan: best }
}
