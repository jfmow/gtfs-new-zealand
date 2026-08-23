import { useEffect, useState } from "react"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { getStopsForTrip } from "../stops"
import type { VehiclesResponse, ServicesStop, StopTimes } from "."

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

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
        async function getData(isRefresh = false) {
            if (isRefresh) {
                setRefreshing(true)
            }

            try {
                if (!has) {
                    const stopsData = await getStopsForTrip(tripId)
                    if (stopsData) {
                        setStops(stopsData)
                    }
                } else {
                    const res = await ApiFetch<VehiclesResponse[]>(`realtime/live?tripId=${fullyEncodeURIComponent(tripId)}`, {
                        method: "GET"
                    })
                    if (!res.ok) {
                        console.error(res.error)
                        return
                    } else {
                        if (res.data && res.data.length >= 1) {
                            const vehicle = res.data[0]
                            setVehicle(vehicle)
                            const stopsData = await getStopsForTrip(tripId)
                            if (stopsData) {
                                setStops(stopsData)
                            }
                        } else {
                            const stopsData = await getStopsForTrip(tripId)
                            if (stopsData) {
                                setStops(stopsData)
                            }
                        }
                    }
                }

                const stopTimesRes = await ApiFetch<StopTimes[]>(`realtime/stop-times?tripId=${fullyEncodeURIComponent(tripId)}`, {
                    method: "GET",
                })
                if (stopTimesRes.ok) {
                    setStopTimes(stopTimesRes.data)
                }
            } catch (error) {
                console.error("Error fetching service tracker data:", error)
            } finally {
                if (isRefresh) {
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
            getData().then(() => setInitialLoading(false))
            handleVisibilityChange()
            document.addEventListener("visibilitychange", handleVisibilityChange)
        }

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalId) {
                clearInterval(intervalId)
            }
        }
    }, [has, active, tripId])

    return { stops, stopTimes, vehicle, initialLoading, refreshing }
}
