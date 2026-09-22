import Foundation

/// Ranks/filters a set of `JourneyPlan` results - ported 1:1 from
/// `components/journey/helpers.ts` (2026-09-22).
public enum JourneyPlanRanking {
    /// Drops journeys that another result beats on every axis - a
    /// later-or-equal departure, an earlier-or-equal arrival, no more
    /// transfers, and no more walking, with at least one strict
    /// improvement. A full tie keeps only the earlier-listed plan.
    public static func pruneDominatedPlans(_ plans: [JourneyPlan]) -> [JourneyPlan] {
        guard plans.count >= 2 else { return plans }

        struct Metrics { let dep: TimeInterval; let arr: TimeInterval; let transfers: Int; let walk: Double }
        let metrics: [Metrics] = plans.map { plan in
            Metrics(
                dep: plan.departureTime.date?.timeIntervalSince1970 ?? 0,
                arr: plan.arrivalTime.date?.timeIntervalSince1970 ?? 0,
                transfers: plan.transfers,
                walk: totalWalkKm(plan)
            )
        }

        return plans.indices
            .filter { i in
                for j in metrics.indices where j != i {
                    let a = metrics[j]
                    let b = metrics[i]
                    let noWorse = a.dep >= b.dep && a.arr <= b.arr && a.transfers <= b.transfers && a.walk <= b.walk + 1e-6
                    let strictlyBetter = a.arr < b.arr || a.transfers < b.transfers || a.dep > b.dep
                    if noWorse, strictlyBetter { return false }
                    if noWorse, !strictlyBetter, j < i { return false }
                }
                return true
            }
            .map { plans[$0] }
    }

    private static func totalWalkKm(_ plan: JourneyPlan) -> Double {
        plan.legs.reduce(0) { sum, leg in leg.mode == "walk" ? sum + leg.distanceKm : sum }
    }
}
