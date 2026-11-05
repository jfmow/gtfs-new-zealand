import type { Leg } from "./types/journey"

/** How a route usually runs at a stop at that time of the week - `reliability.Stat` on the backend. */
export interface ReliabilityStat {
    samples: number
    /** Between 1 min early and 5 min late. */
    on_time_pct: number
    early_pct: number
    late_pct: number
    /** Median delay in minutes (negative = early). */
    typical_min: number
    cancelled_pct?: number
    /** "Usually on time", "Usually 3–5 min late", "Often early". */
    summary: string
    /** "82% on time · 1 in 10 cancelled". */
    detail: string
    level: "good" | "fair" | "poor"
}


/** How a route runs in one time-of-week band - `reliability.BandStat`. */
export interface ReliabilityBand {
    band: string
    /** "Weekday mornings, 7-9am". */
    label: string
    /** null with too little data. */
    stat: ReliabilityStat | null
}

export interface ReliabilityHour {
    hour: number
    samples: number
    typical_min?: number
    on_time_pct?: number
    trips_per_day?: number
}

export interface ReliabilityPeriod {
    /** "2026-10-19" - the Monday, for a week. */
    start: string
    samples: number
    on_time_pct?: number
    cancelled_pct?: number
    trips: number
}

export interface LoggedAlert {
    id: string
    header: string
    effect: string
    cause: string
    first_seen: number
    last_seen: number
}

export interface HeatStop {
    name: string
    lat: number
    lon: number
    typical_min?: number
    level?: ReliabilityStat["level"]
}

export type DayType = "wd" | "sat" | "sun"

/** A route - `GET reliability/route`. */
export interface RouteReliabilityReport {
    route: { route_id: string; route_short_name: string; route_long_name: string; route_color: string; vehicle_type: string }
    report: {
        overall: ReliabilityStat | null
        bands: ReliabilityBand[]
        /** Where it's usually latest, worst first. */
        late_stops: { stop_id: string; stop_name: string; stat: ReliabilityStat }[]
    }
    hours: { day: DayType; live: ReliabilityHour[]; scheduled: number[] }
    trend: { days: ReliabilityPeriod[]; weeks: ReliabilityPeriod[] }
    alerts: { recent: LoggedAlert[]; weeks: { week: string; alerts: number; hours: number }[] }
    /** The route's line, each stretch coloured by lateness (GeoJSON, `properties.color`), and its stops. */
    map: { line: GeoJSONLike | null; stops: HeatStop[] }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeoJSONLike = any

/** One route over the last week - `GET reliability/league`. */
export interface LeagueRow {
    route_id: string
    short_name: string
    color: string
    samples: number
    on_time_pct: number
    late_pct: number
    cancelled_pct: number
    trips: number
}

/** How often a change between two rides works out - `reliability.Connection`. */
export interface ReliabilityConnection {
    /** 0-1. */
    chance: number
    /** "Works 9 times in 10". */
    summary: string
    level: ReliabilityStat["level"]
}

/** "routeA|stopA|unixA|routeB|stopB|unixB|slack" for each change, by the index of the ride changed to. */
export function reliabilityChangeKeys(legs: Leg[]): Map<number, string> {
    const out = new Map<number, string>()
    let prev = -1
    legs.forEach((leg, i) => {
        if (leg.Mode === "walk") return
        if (prev >= 0) {
            const a = legs[prev]
            if (a.RouteID && a.ToStop && leg.RouteID && leg.FromStop) {
                const arrive = new Date(a.scheduled_arrival_time ?? a.ArrivalTime).getTime()
                const depart = new Date(leg.scheduled_departure_time ?? leg.DepartureTime).getTime()
                let walkMs = 0
                for (let j = prev + 1; j < i; j++) if (legs[j].Mode === "walk") walkMs += legs[j].Duration / 1_000_000
                const slack = Math.round((depart - arrive - walkMs) / 1000)
                out.set(i, [a.RouteID, a.ToStop.stop_id, Math.floor(arrive / 1000), leg.RouteID, leg.FromStop.stop_id, Math.floor(depart / 1000), slack].join("|"))
            }
        }
        prev = i
    })
    return out
}

