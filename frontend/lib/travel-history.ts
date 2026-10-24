import { haversineDistance } from "@/lib/utils"
import { getRegionSlug, urlStore } from "@/lib/url-store"
import type { JourneyType, Leg } from "@/components/journey/types"
import type { FareEstimate } from "@/lib/fares"

/**
 * Journeys the rider started tracking, kept on this device only, for "Your
 * travel" - a few numbers per journey, never where from or to beyond the
 * labels they chose.
 */
export interface TravelRecord {
    id: string
    /** When they pressed Go (ms). */
    at: number
    region: string
    from: string
    to: string
    /** Minutes on board, and km by mode. */
    rideMinutes: number
    km: { bus: number; train: number; ferry: number; walk: number }
    fareCents?: number
    currency?: string
}

const KEY = "travelHistory"
const MAX_RECORDS = 1000

type Mode = "bus" | "train" | "ferry"

function modeOf(leg: Leg): Mode {
    const t = (leg.Route?.vehicle_type ?? "").toLowerCase()
    if (t.includes("train") || t.includes("rail")) return "train"
    if (t.includes("ferry")) return "ferry"
    return "bus"
}

/** A leg's distance - the planner's when it has one, else the straight line plus a quarter. */
function legKm(leg: Leg): number {
    if (leg.DistanceKm > 0) return leg.DistanceKm
    if (!leg.FromStop || !leg.ToStop) return 0
    return (haversineDistance(leg.FromStop.stop_lat, leg.FromStop.stop_lon, leg.ToStop.stop_lat, leg.ToStop.stop_lon) / 1000) * 1.25
}

export function readTravel(): TravelRecord[] {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? (JSON.parse(raw) as TravelRecord[]) : []
    } catch {
        return []
    }
}

/** Notes a journey the rider has set off on (once per plan). */
export function recordJourney(route: JourneyType, labels: { from: string; to: string }, fare?: FareEstimate | null) {
    try {
        const records = readTravel()
        if (records.some((r) => r.id === route.ID)) return
        const km = { bus: 0, train: 0, ferry: 0, walk: 0 }
        let rideMinutes = 0
        for (const leg of route.Legs) {
            if (leg.Mode === "walk") {
                km.walk += leg.DistanceKm || 0
                continue
            }
            km[modeOf(leg)] += legKm(leg)
            rideMinutes += Math.max(0, (new Date(leg.ArrivalTime).getTime() - new Date(leg.DepartureTime).getTime()) / 60_000)
        }
        records.push({
            id: route.ID,
            at: Date.now(),
            region: getRegionSlug(urlStore.currentUrl),
            from: labels.from,
            to: labels.to,
            rideMinutes: Math.round(rideMinutes),
            km,
            fareCents: fare && !fare.partial ? fare.cents : undefined,
            currency: fare?.currency,
        })
        localStorage.setItem(KEY, JSON.stringify(records.slice(-MAX_RECORDS)))
    } catch {
        // private mode - nothing kept
    }
}

export function clearTravel() {
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

// Rough CO2 per passenger-km (kg) - typical NZ figures, for an estimate:
// an average petrol car, a diesel bus, Auckland/Wellington electric trains,
// a passenger ferry.
export const CO2_KG_PER_KM = { car: 0.25, bus: 0.1, train: 0.02, ferry: 0.3 }

export interface TravelSummary {
    trips: number
    rideMinutes: number
    km: { bus: number; train: number; ferry: number; walk: number }
    spentCents: number
    /** Trips with a known fare. */
    pricedTrips: number
    currency?: string
    /** kg of CO2 saved against driving the same distance. */
    co2SavedKg: number
}

export function summarise(records: TravelRecord[]): TravelSummary {
    const s: TravelSummary = { trips: records.length, rideMinutes: 0, km: { bus: 0, train: 0, ferry: 0, walk: 0 }, spentCents: 0, pricedTrips: 0, co2SavedKg: 0 }
    for (const r of records) {
        s.rideMinutes += r.rideMinutes
        s.km.bus += r.km.bus
        s.km.train += r.km.train
        s.km.ferry += r.km.ferry
        s.km.walk += r.km.walk
        if (r.fareCents != null) {
            s.spentCents += r.fareCents
            s.pricedTrips++
            s.currency = r.currency
        }
    }
    const rideKm = s.km.bus + s.km.train + s.km.ferry
    s.co2SavedKg = Math.max(0, rideKm * CO2_KG_PER_KM.car - (s.km.bus * CO2_KG_PER_KM.bus + s.km.train * CO2_KG_PER_KM.train + s.km.ferry * CO2_KG_PER_KM.ferry))
    return s
}
