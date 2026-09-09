import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { fetchStopsForTrip } from "../stops"
import type { ShapesResponse, GeoJSON } from "@/components/map/geojson-types"
import type { VehiclesResponse, PreviewData, ServicesStop, StopTimes } from "."

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

export interface ServiceTrackerContextValue {
    vehicle?: VehiclesResponse
    stops: ServicesStop[] | null
    stopTimes: StopTimes[] | null
    previewData?: PreviewData
    tripId: string
    /**
     * The service has trip-update (arrival prediction) tracking but no live
     * vehicle position. Drives the "Limited tracking" vs "Timetable only" notice
     * when the tracker falls back to its no-vehicle view.
     */
    tripUpdateTracking?: boolean
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    refreshing: boolean
    /** Suppress the internal mini map - use when a caller already shows this trip on a bigger map alongside. */
    hideMap?: boolean
    /**
     * "inset" (default) caps the stop list in its own scroll box; "page" lets it
     * flow with a full-screen page and pins the reminder actions to the bottom.
     */
    stopsLayout?: "inset" | "page"
}

const ServiceTrackerContext = createContext<ServiceTrackerContextValue | null>(null)

export function ServiceTrackerProvider({
    value,
    children,
}: {
    value: ServiceTrackerContextValue
    children: ReactNode
}) {
    return <ServiceTrackerContext.Provider value={value}>{children}</ServiceTrackerContext.Provider>
}

export function useServiceTrackerContext(): ServiceTrackerContextValue {
    const ctx = useContext(ServiceTrackerContext)
    if (!ctx) {
        throw new Error("useServiceTrackerContext must be used within a ServiceTrackerProvider")
    }
    return ctx
}

/**
 * Owns the tracker's polling lifecycle so the modal, the docked panel, and the
 * /trip page can all drive ServiceTrackerContent without duplicating fetch logic.
 * `active` replaces the modal's `open` state - callers decide when polling should run.
 */
/** Why the tracker has no stop list to show - surfaced to the user instead of a guess. */
export interface ServiceTrackerError {
    message: string
    traceId?: string
    statusCode?: number
}

export function useServiceTracker(tripId: string, has: boolean, active: boolean) {
    const [stops, setStops] = useState<ServicesStop[] | null>(null)
    const [stopTimes, setStopTimes] = useState<StopTimes[]>([])
    const [vehicle, setVehicle] = useState<VehiclesResponse>()
    // Start "loading" whenever we're actually about to fetch - otherwise the
    // first render (before the effect runs) briefly falls through to the
    // "couldn't be loaded" branch and flashes an error at the user.
    const [initialLoading, setInitialLoading] = useState(() => active && !!tripId)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<ServiceTrackerError | null>(null)

    useEffect(() => {
        // A request fired for the previous tripId can still resolve after this
        // effect re-runs for a new one - `cancelled` stops it from clobbering the
        // new trip's data with the old trip's response.
        let cancelled = false

        // Drop the old trip's data immediately so a stale render doesn't show it
        // under the new tripId while the first fetch for it is in flight.
        setStops(null)
        setStopTimes([])
        setVehicle(undefined)
        setError(null)

        async function getData(isRefresh = false) {
            if (isRefresh) {
                setRefreshing(true)
            }

            let stopsError: ServiceTrackerError | null = null

            try {
                if (has) {
                    // A missing/failed live position isn't fatal - fall through
                    // and still load the stop list so the tracker can render.
                    const res = await ApiFetch<VehiclesResponse[]>(`realtime/live?tripId=${fullyEncodeURIComponent(tripId)}`, {
                        method: "GET",
                    })
                    if (cancelled) return
                    if (res.ok && res.data && res.data.length >= 1) {
                        setVehicle(res.data[0])
                    } else if (!res.ok) {
                        console.error(res.error)
                    }
                }

                if (cancelled) return

                const stopsRes = await fetchStopsForTrip(tripId)
                if (cancelled) return
                if (stopsRes.ok) {
                    setStops(stopsRes.stops)
                } else {
                    console.warn("Failed to fetch stops for trip:", stopsRes.error)
                    stopsError = {
                        message: stopsRes.error,
                        traceId: stopsRes.traceId,
                        statusCode: stopsRes.statusCode,
                    }
                }

                const stopTimesRes = await ApiFetch<StopTimes[]>(`realtime/stop-times?tripId=${fullyEncodeURIComponent(tripId)}`, {
                    method: "GET",
                })
                if (!cancelled && stopTimesRes.ok) {
                    setStopTimes(stopTimesRes.data)
                }
            } catch (err) {
                console.error("Error fetching service tracker data:", err)
                stopsError = { message: err instanceof Error ? err.message : "Unknown error" }
            } finally {
                if (!cancelled) {
                    setError(stopsError)
                    if (isRefresh) {
                        setRefreshing(false)
                    }
                }
            }
        }

        let intervalId: NodeJS.Timeout | null

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                getData(true) // Mark as refresh when visibility changes
                intervalId = setInterval(() => getData(true), REFRESH_INTERVAL * 1000)
            } else if (document.visibilityState === "hidden") {
                if (intervalId) {
                    clearInterval(intervalId)
                }
            }
        }

        if (active && tripId) {
            setInitialLoading(true)
            getData().then(() => {
                if (!cancelled) setInitialLoading(false)
            })
            handleVisibilityChange()
            document.addEventListener("visibilitychange", handleVisibilityChange)
        } else {
            setInitialLoading(false)
        }

        return () => {
            cancelled = true
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalId) {
                clearInterval(intervalId)
            }
        }
    }, [has, active, tripId])

    return { stops, stopTimes, vehicle, initialLoading, refreshing, error }
}

/**
 * Fetches the route shape (the polyline drawn on the map) for a trip.
 * Keyed on tripId + routeId (primitives) rather than a vehicle object, which is a
 * new reference every ~10s poll - this fetches once instead of on every poll.
 */
export function useRouteLine(tripId: string, routeId?: string) {
    const [routeLine, setRouteLine] = useState<{ color: string; line: GeoJSON } | null>(null)

    useEffect(() => {
        if (!tripId) {
            setRouteLine(null)
            return
        }

        let cancelled = false
        ApiFetch<ShapesResponse>(`map/geojson/shapes?tripId=${fullyEncodeURIComponent(tripId)}&routeId=${fullyEncodeURIComponent(routeId || "")}`, {
            method: "GET",
        }).then((response) => {
            if (cancelled) return
            if (!response.ok) {
                console.error(response.error)
                return
            }
            setRouteLine({
                color: response.data.color ? `#${response.data.color}` : "#393939",
                line: response.data.geojson,
            })
        })

        return () => {
            cancelled = true
        }
    }, [tripId, routeId])

    return routeLine
}
