import { useQuery } from "@tanstack/react-query"
import type { ApiResult } from "@transit/shared/api"
import { filterAndSortDepartures } from "@transit/shared/logic/basics"
import type { AlertsForStop, Coordinate } from "@transit/shared/models"
import { api } from "./api"
import { useRegion } from "./region"

/** Unwraps an ApiResult for react-query: data, or a thrown error with the backend's message. */
export async function unwrap<T>(p: Promise<ApiResult<T>>): Promise<T> {
    const res = await p
    if (!res.ok) throw new Error(res.error || "Request failed")
    return res.data
}

/** A stop's live board, polled every 10 s (as iOS and the web), sorted like the web board. */
export function useDepartures(stopQuery: string | null, limit = 200) {
    const { region, ready } = useRegion()
    return useQuery({
        queryKey: ["departures", region.url, stopQuery, limit],
        queryFn: async () => {
            const res = await api.departures(stopQuery!, limit)
            // "no services found for stop" is a 404 - an empty board, as iOS shows it, not an error.
            if (!res.ok && res.status_code === 404) return []
            if (!res.ok) throw new Error(res.error || "Request failed")
            return filterAndSortDepartures(res.data ?? [])
        },
        enabled: ready && !!stopQuery,
        refetchInterval: 10_000,
    })
}

export function useClosestStops(at: Coordinate | null) {
    const { region, ready } = useRegion()
    // Round so small GPS moves don't refetch.
    const key = at ? `${at.lat.toFixed(3)},${at.lon.toFixed(3)}` : null
    return useQuery({
        queryKey: ["closest", region.url, key],
        queryFn: async () => (await unwrap(api.closestStops(at!))) ?? [],
        enabled: ready && !!at,
        staleTime: 60_000,
    })
}

export function useStopAlerts(stopQuery: string | null, todayOnly = false) {
    const { region, ready } = useRegion()
    return useQuery({
        queryKey: ["stop-alerts", region.url, stopQuery, todayOnly],
        queryFn: async () => {
            const res = await api.alertsForStop(stopQuery!, todayOnly)
            // A stop with no alerts (or no routes) is a 404 - all clear, as iOS shows it.
            if (!res.ok && res.status_code === 404) return { alerts: {}, routes_to_display: [] } as AlertsForStop
            return unwrap(Promise.resolve(res))
        },
        enabled: ready && !!stopQuery && region.realtime !== false,
        staleTime: 60_000,
    })
}
