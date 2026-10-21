import { useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { getRegionSlug, urlStore } from "@/lib/url-store"
import type { Leg } from "@/components/journey/types"

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

/** Text colour for a stat's level. */
export function reliabilityTone(level: ReliabilityStat["level"]): string {
    switch (level) {
        case "good":
            return "text-green-700 dark:text-green-400"
        case "fair":
            return "text-amber-700 dark:text-amber-400"
        default:
            return "text-red-700 dark:text-red-400"
    }
}

/** The real wait at a frequent service, against the timetable's - `reliability.Wait`. */
export interface ReliabilityWait {
    headway_min: number
    timetable_wait_min: number
    real_wait_min: number
}

/** A stop's figures, by route id. */
export interface StopReliability {
    routes: Record<string, ReliabilityStat>
    waits: Record<string, ReliabilityWait>
}

const NO_STOP_DATA: StopReliability = { routes: {}, waits: {} }

// The figures move over weeks, not minutes - one fetch per stop (or
// journey) per page is plenty.
const stopCache = new Map<string, Promise<StopReliability>>()

async function fetchStop(stopId: string): Promise<StopReliability> {
    const res = await ApiFetch<StopReliability>(
        `reliability/stop?stop=${encodeURIComponent(stopId)}&at=${Math.floor(Date.now() / 1000)}`,
    )
    return res.ok ? { routes: res.data.routes ?? {}, waits: res.data.waits ?? {} } : NO_STOP_DATA
}

/** How each route usually runs at this stop around now, and the real wait for frequent ones. Empty until loaded, or with no data. */
export function useStopReliability(stopId: string | undefined): StopReliability {
    const [stats, setStats] = useState<StopReliability>(NO_STOP_DATA)
    useEffect(() => {
        if (!stopId) return
        let cancelled = false
        // Stop ids aren't unique across regions.
        const key = `${getRegionSlug(urlStore.currentUrl)}:${stopId}`
        let pending = stopCache.get(key)
        if (!pending) {
            pending = fetchStop(stopId).catch(() => NO_STOP_DATA)
            stopCache.set(key, pending)
        }
        pending.then((s) => { if (!cancelled) setStats(s) })
        return () => { cancelled = true }
    }, [stopId])
    return stopId ? stats : NO_STOP_DATA
}

/** "route|stop|unix" for each ride in a journey - "" for walks. */
function rideKeys(legs: Leg[]): string[] {
    return legs.map((leg) => {
        if (leg.Mode === "walk" || !leg.RouteID || !leg.FromStop) return ""
        const departs = new Date(leg.scheduled_departure_time ?? leg.DepartureTime).getTime()
        return `${leg.RouteID}|${leg.FromStop.stop_id}|${Math.floor(departs / 1000)}`
    })
}

/** Per leg (aligned with `legs`): how that ride usually runs from where it's boarded, or null. */
export function useRidesReliability(legs: Leg[]): (ReliabilityStat | null)[] {
    const keys = rideKeys(legs)
    const query = keys.filter(Boolean).join(",")
    const [byKey, setByKey] = useState<Record<string, ReliabilityStat | null>>({})

    useEffect(() => {
        if (!query) return
        let cancelled = false
        const rides = query.split(",")
        ApiFetch<{ rides: (ReliabilityStat | null)[] }>(`reliability/rides?rides=${encodeURIComponent(query)}`)
            .then((res) => {
                if (cancelled || !res.ok) return
                const out: Record<string, ReliabilityStat | null> = {}
                rides.forEach((k, i) => { out[k] = res.data.rides?.[i] ?? null })
                setByKey(out)
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [query])

    return keys.map((k) => (k ? byKey[k] ?? null : null))
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

/** A route's reliability report for a day type; `undefined` while loading, `null` if the route wasn't found. */
export function useRouteReliability(routeId: string, day?: DayType): RouteReliabilityReport | null | undefined {
    const key = `${routeId}|${day ?? ""}`
    const [data, setData] = useState<{ key: string; report: RouteReliabilityReport | null } | undefined>()
    useEffect(() => {
        if (!routeId) return
        let cancelled = false
        ApiFetch<RouteReliabilityReport>(`reliability/route?route=${encodeURIComponent(routeId)}${day ? `&day=${day}` : ""}`)
            .then((res) => { if (!cancelled) setData({ key, report: res.ok ? res.data : null }) })
            .catch(() => { if (!cancelled) setData({ key, report: null }) })
        return () => { cancelled = true }
    }, [routeId, day, key])
    return data?.key === key ? data.report : undefined
}

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

/** Every route with enough data, most on time first; `undefined` while loading. */
export function useLeague(enabled: boolean): LeagueRow[] | undefined {
    const [rows, setRows] = useState<LeagueRow[] | undefined>()
    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        ApiFetch<{ routes: LeagueRow[] }>("reliability/league")
            .then((res) => { if (!cancelled) setRows(res.ok ? res.data.routes : []) })
            .catch(() => { if (!cancelled) setRows([]) })
        return () => { cancelled = true }
    }, [enabled])
    return rows
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
function changeKeys(legs: Leg[]): Map<number, string> {
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

/** Per ride index: how often the change onto it works out, from how both rides usually run. */
export function useConnectionOdds(legs: Leg[]): Map<number, ReliabilityConnection> {
    const keys = changeKeys(legs)
    const entries = [...keys.entries()]
    const query = entries.map(([, k]) => k).join(",")
    const [result, setResult] = useState<{ query: string; byIndex: Map<number, ReliabilityConnection> }>({ query: "", byIndex: new Map() })

    useEffect(() => {
        if (!query) return
        let cancelled = false
        const indexes = query.split(",").map((k) => entries.find(([, v]) => v === k)?.[0] ?? -1)
        ApiFetch<{ changes: (ReliabilityConnection | null)[] }>(`reliability/connections?changes=${encodeURIComponent(query)}`)
            .then((res) => {
                if (cancelled || !res.ok) return
                const byIndex = new Map<number, ReliabilityConnection>()
                res.data.changes?.forEach((c, n) => { if (c && indexes[n] >= 0) byIndex.set(indexes[n], c) })
                setResult({ query, byIndex })
            })
            .catch(() => {})
        return () => { cancelled = true }
        // entries is derived from query
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

    return result.query === query ? result.byIndex : new Map()
}
