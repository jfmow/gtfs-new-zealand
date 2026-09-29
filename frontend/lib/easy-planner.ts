import type { JourneyType, Leg, Stop } from "@/components/journey/types"

/**
 * The step-by-step planner's logic - a port of the iOS app's
 * `EasyPlanner.swift` (TransitCore), so both apps recommend the same journey
 * in the same words.
 */

export type EasyTravelMode = "bus" | "train" | "ferry"

export interface EasyPlannerOptions {
    maxWalkKm: number
    walkSpeed: number
    maxTransfers: number
    minTransferSec: number
}

/** A slower pace, a short walk, at most one change, two spare minutes at it. */
export const GENTLE: EasyPlannerOptions = { maxWalkKm: 0.6, walkSpeed: 3.2, maxTransfers: 1, minTransferSec: 120 }
/** Still a slower pace with spare change time, but the planner's usual reach - the fallback when `GENTLE` finds nothing. */
export const RELAXED: EasyPlannerOptions = { maxWalkKm: 1.0, walkSpeed: 3.2, maxTransfers: 3, minTransferSec: 60 }
/** The full planner's defaults. */
export const STANDARD: EasyPlannerOptions = { maxWalkKm: 1.0, walkSpeed: 4, maxTransfers: 5, minTransferSec: 0 }

const MODE_LABELS: Record<EasyTravelMode, string> = { bus: "bus", train: "train", ferry: "ferry" }

/** "train only", "bus or train", "any transport". */
export function modesSummary(modes: EasyTravelMode[]): string {
    const chosen = (["bus", "train", "ferry"] as EasyTravelMode[]).filter((m) => modes.includes(m)).map((m) => MODE_LABELS[m])
    if (chosen.length === 0) return "any transport"
    if (chosen.length === 1) return `${chosen[0]} only`
    return chosen.slice(0, -1).join(", ") + " or " + chosen[chosen.length - 1]
}

export interface EasyAttempt {
    modes: EasyTravelMode[]
    options: EasyPlannerOptions
    /** Said above the results when this looser search is the one that found them. */
    note: string | null
}

/**
 * The searches to try in order: the rider's answers, then more walking and
 * changes, then any transport - so a search that finds nothing says what it
 * changed instead of leaving them at a dead end.
 */
export function easyAttempts(modes: EasyTravelMode[], walkLess: boolean): EasyAttempt[] {
    const attempts: EasyAttempt[] = [{ modes, options: walkLess ? GENTLE : STANDARD, note: null }]
    if (walkLess) {
        attempts.push({ modes, options: RELAXED, note: "To find a way, this one has a bit more walking or an extra change." })
    }
    if (modes.length > 0) {
        attempts.push({ modes: [], options: walkLess ? RELAXED : STANDARD, note: `There's no way by ${modesSummary(modes)}, so this uses any transport.` })
    }
    return attempts
}

// ---------------------------------------------------------------------------
// ranking

const TRANSFER_PENALTY_MIN = 10
const WALK_PENALTY_MIN_PER_KM = 15
/** For arrive-by, a plan that gets there at least this early is preferred over one that cuts it fine. */
const COMFORTABLE_SLACK_MS = 5 * 60_000

const ms = (d: Date | string) => new Date(d).getTime()

/**
 * A "bother" score in minutes: time spent (from now, or from leaving home for
 * an arrive-by trip), plus 10 per change and 15 per km walked. A direct bus
 * that's a little slower beats a quicker trip with a change.
 */
function score(plan: JourneyType, arriveBy: Date | null, now: number): number {
    const departure = ms(plan.DepartureTime)
    const arrival = ms(plan.ArrivalTime)
    const minutes = (arriveBy ? arriveBy.getTime() - departure : arrival - now) / 60_000
    const walkKm = plan.Legs.reduce((km, leg) => (leg.Mode === "walk" ? km + leg.DistanceKm : km), 0)
    return minutes + plan.Transfers * TRANSFER_PENALTY_MIN + walkKm * WALK_PENALTY_MIN_PER_KM
}

export function recommendedPlan(plans: JourneyType[], arriveBy: Date | null, now = Date.now()): JourneyType | null {
    let pool = plans
    if (arriveBy) {
        const onTime = plans.filter((p) => ms(p.ArrivalTime) <= arriveBy.getTime())
        const comfortable = onTime.filter((p) => ms(p.ArrivalTime) <= arriveBy.getTime() - COMFORTABLE_SLACK_MS)
        pool = comfortable.length ? comfortable : onTime.length ? onTime : plans
    }
    let best: JourneyType | null = null
    let bestScore = Infinity
    for (const plan of pool) {
        const s = score(plan, arriveBy, now)
        if (s < bestScore) {
            best = plan
            bestScore = s
        }
    }
    return best
}

/** `plans` with the recommendation first, the rest by departure. */
export function rankedPlans(plans: JourneyType[], arriveBy: Date | null, now = Date.now()): JourneyType[] {
    const best = recommendedPlan(plans, arriveBy, now)
    if (!best) return plans
    const rest = plans.filter((p) => p !== best).sort((a, b) => ms(a.DepartureTime) - ms(b.DepartureTime))
    return [best, ...rest]
}

// ---------------------------------------------------------------------------
// plain-English steps

export interface EasyStep {
    kind: "walk" | "ride"
    mode?: EasyTravelMode
    /** "Catch the 70 bus at 10:01 am" */
    headline: string
    /** "From Queen Street. Stop 7021. Get off at Ellerslie at 10:15 am." */
    detail?: string
}

/** "10:01 am" in New Zealand time. */
export function clock(date: Date | string): string {
    return new Date(date)
        .toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", timeZone: "Pacific/Auckland" })
        .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`)
}

export function legMode(leg: Leg): EasyTravelMode | undefined {
    const type = (leg.Route?.vehicle_type ?? "").toLowerCase()
    if (type.includes("train") || type.includes("rail")) return "train"
    if (type.includes("ferry")) return "ferry"
    if (type.includes("bus")) return "bus"
    return undefined
}

const stopName = (stop: Stop) => stop.stop_name.trim()

/** " Stop 7021." - the number on a bus stop's sign. Stations and wharves are known by name (and platform). */
function stopCodeSentence(stop: Stop): string {
    if (!stop.stop_code || (stop.stop_type && stop.stop_type !== "bus")) return ""
    return ` Stop ${stop.stop_code}.`
}

function rideStep(leg: Leg): EasyStep {
    const mode = legMode(leg)
    const name = leg.Route?.route_short_name || leg.RouteID
    // A bus is known by the number on its front; a train or ferry line's code
    // (AT's "S-C", "DEV") means little, so it's only a detail.
    const vehicle = mode === "bus" ? `the ${name} bus` : mode === "train" ? "the train" : mode === "ferry" ? "the ferry" : `the ${name}`
    const headline = `Catch ${vehicle} at ${clock(leg.DepartureTime)}`

    const detail: string[] = []
    if (leg.FromStop) {
        if (mode !== "bus" && leg.FromStop.platform_number) {
            detail.push(`From platform ${leg.FromStop.platform_number} at ${stopName(leg.FromStop)}.`)
        } else {
            detail.push(`From ${stopName(leg.FromStop)}.${stopCodeSentence(leg.FromStop)}`)
        }
    }
    if ((mode === "train" || mode === "ferry") && name) detail.push(`It's the ${name} line.`)
    if (leg.ToStop) detail.push(`Get off at ${stopName(leg.ToStop)} at ${clock(leg.ArrivalTime)}.`)
    return { kind: "ride", mode, headline, detail: detail.length ? detail.join(" ") : undefined }
}

/** The steps for `plan`. `destinationName` names the last walk. */
export function easySteps(plan: JourneyType, destinationName: string): EasyStep[] {
    const steps: EasyStep[] = []
    plan.Legs.forEach((leg, index) => {
        if (leg.Mode === "transit") {
            steps.push(rideStep(leg))
            return
        }
        const last = index === plan.Legs.length - 1
        // A zero-length hop between two platforms isn't worth a step.
        if (leg.DistanceKm < 0.02 && index > 0 && !last) return
        const minutes = Math.max(1, Math.round(leg.Duration / 60_000_000_000))
        const target = leg.ToStop ? stopName(leg.ToStop) : last ? destinationName : "the stop"
        const metres = Math.round((leg.DistanceKm * 1000) / 10) * 10
        steps.push({
            kind: "walk",
            headline: `Walk ${minutes} min to ${target}`,
            detail: metres > 0 ? `About ${metres} metres.${leg.ToStop ? stopCodeSentence(leg.ToStop) : ""}` : undefined,
        })
    })
    return steps
}

/** An hour from now, on the next quarter hour - the arrive-by default. */
export function defaultArriveBy(now = new Date()): Date {
    const quarter = 15 * 60_000
    return new Date(Math.ceil((now.getTime() + 60 * 60_000) / quarter) * quarter)
}
