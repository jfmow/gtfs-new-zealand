import { useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import type { Leg } from "@/components/journey/types"
import {
    reliabilityChangeKeys,
    type DayType,
    type LeagueRow,
    type ReliabilityConnection,
    type ReliabilityStat,
    type RouteReliabilityReport,
} from "@transit/shared/reliability"

// The reliability response types live in the shared package
// (packages/shared/src/reliability.ts). The hooks and colours are web-only.
export type {
    ReliabilityStat, ReliabilityBand, ReliabilityHour, ReliabilityPeriod, LoggedAlert, HeatStop, DayType,
    RouteReliabilityReport, GeoJSONLike, LeagueRow, ReliabilityConnection,
} from "@transit/shared/reliability"

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

/** Per ride index: how often the change onto it works out, from how both rides usually run. */
export function useConnectionOdds(legs: Leg[]): Map<number, ReliabilityConnection> {
    const keys = reliabilityChangeKeys(legs)
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
