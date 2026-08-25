import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { getStopsForTrip } from "../stops"
import type { VehiclesResponse, PreviewData, ServicesStop, StopTimes } from "."

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

export interface ServiceTrackerContextValue {
    vehicle?: VehiclesResponse
    stops: ServicesStop[] | null
    stopTimes: StopTimes[] | null
    previewData?: PreviewData
    tripId: string
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    refreshing: boolean
    /** Suppress the internal mini map - use when a caller already shows this trip on a bigger map alongside. */
    hideMap?: boolean
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
export function useServiceTracker(tripId: string, has: boolean, active: boolean) {
    const [stops, setStops] = useState<ServicesStop[] | null>(null)
    const [stopTimes, setStopTimes] = useState<StopTimes[]>([])
    const [vehicle, setVehicle] = useState<VehiclesResponse>()
    const [initialLoading, setInitialLoading] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

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

        async function getData(isRefresh = false) {
            if (isRefresh) {
                setRefreshing(true)
            }

            try {
                if (!has) {
                    const stopsData = await getStopsForTrip(tripId)
                    if (!cancelled && stopsData) {
                        setStops(stopsData)
                    }
                } else {
                    const res = await ApiFetch<VehiclesResponse[]>(`realtime/live?tripId=${fullyEncodeURIComponent(tripId)}`, {
                        method: "GET"
                    })
                    if (cancelled) return
                    if (!res.ok) {
                        console.error(res.error)
                        return
                    } else {
                        if (res.data && res.data.length >= 1) {
                            const vehicle = res.data[0]
                            setVehicle(vehicle)
                            const stopsData = await getStopsForTrip(tripId)
                            if (!cancelled && stopsData) {
                                setStops(stopsData)
                            }
                        } else {
                            const stopsData = await getStopsForTrip(tripId)
                            if (!cancelled && stopsData) {
                                setStops(stopsData)
                            }
                        }
                    }
                }

                if (cancelled) return

                const stopTimesRes = await ApiFetch<StopTimes[]>(`realtime/stop-times?tripId=${fullyEncodeURIComponent(tripId)}`, {
                    method: "GET",
                })
                if (!cancelled && stopTimesRes.ok) {
                    setStopTimes(stopTimesRes.data)
                }
            } catch (error) {
                console.error("Error fetching service tracker data:", error)
            } finally {
                if (isRefresh && !cancelled) {
                    setRefreshing(false)
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
        }

        return () => {
            cancelled = true
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalId) {
                clearInterval(intervalId)
            }
        }
    }, [has, active, tripId])

    return { stops, stopTimes, vehicle, initialLoading, refreshing }
}
