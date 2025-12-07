import { memo, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "../../ui/button"
import { Loader2, MapIcon, Navigation } from "lucide-react"
import { getStopsForTrip } from "../stops"
import { ApiFetch } from "@/lib/url-context"
import ServiceTrackerContent from "./body"
import { fullyEncodeURIComponent, useIsMobile } from "@/lib/utils"
import { Sheet, SheetContent, SheetTrigger } from "../../ui/sheet"
import { Service } from ".."

interface ServiceTrackerModalProps {
    service: Service
    defaultOpen?: boolean
    onOpenChange?: (v: boolean) => void
}

export interface PreviewData {
    tripHeadsign: string
    route_id: string
    route_name: string
    trip_id: string
    route_color: string
}

export interface StopTimes {
    parent_stop_id: string
    child_stop_id: string
    arrival_time: number
    departure_time: number
    scheduled_time: number
    stop: ServicesStop
    skipped: boolean
    passed: boolean
    dist: number
}

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

const ServiceTrackerModal = memo(function ServiceTrackerModal({
    service,
    defaultOpen,
    onOpenChange,
}: ServiceTrackerModalProps) {
    const [stops, setStops] = useState<ServicesStop[] | null>(null)
    const [stopTimes, setStopTimes] = useState<StopTimes[]>([])
    const [open, setOpen] = useState(defaultOpen)
    const [vehicle, setVehicle] = useState<VehiclesResponse>()
    const [initialLoading, setInitialLoading] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const isMobile = useIsMobile()

    useEffect(() => {
        async function getData(isRefresh = false) {
            if (isRefresh) {
                setRefreshing(true)
            }

            try {
                if (!service.location_tracking) { //does not have tracking
                    const stopsData = await getStopsForTrip(service.trip_id)
                    if (stopsData) {
                        setStops(stopsData)
                    }
                } else { //does have tracking
                    const res = await ApiFetch<VehiclesResponse[]>(`realtime/live?tripId=${fullyEncodeURIComponent(service.trip_id)}`, {
                        method: "GET"
                    })
                    if (!res.ok) {
                        console.error(res.error)
                        return
                    } else {
                        if (res.data && res.data.length >= 1) {
                            const vehicle = res.data[0]
                            setVehicle(vehicle)
                            const stopsData = await getStopsForTrip(service.trip_id)
                            if (stopsData) {
                                setStops(stopsData)
                            }
                        } else {
                            const stopsData = await getStopsForTrip(service.trip_id)
                            if (stopsData) {
                                setStops(stopsData)
                            }
                        }
                    }
                }

                const stopTimesRes = await ApiFetch<StopTimes[]>(`realtime/stop-times?tripId=${fullyEncodeURIComponent(service.trip_id)}`, {
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

        if (open) {
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
    }, [open, service])

    const handleOpenChange = (v: boolean) => {
        setOpen(v)
        if (onOpenChange) onOpenChange(v)
    }

    const triggerButton = !defaultOpen ? (
        <Button
            aria-label="Track service on map"
            disabled={initialLoading}
            className="w-full"
            variant={service.location_tracking ? "default" : "secondary"}
        >
            {initialLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-secondary" />
            ) : (
                <>
                    {service.location_tracking ? (
                        <>
                            <Navigation className="w-4 h-4" />
                            Track
                        </>
                    ) : (
                        <>
                            <MapIcon className="w-4 h-4" />
                            Preview
                        </>
                    )}
                </>
            )}
        </Button>
    ) : null


    const content = (
        <ServiceTrackerContent
            vehicle={vehicle}
            stops={stops}
            previewData={{
                tripHeadsign: service.headsign,
                route_id: service.route.id,
                route_name: service.route.name,
                trip_id: service.trip_id,
                route_color: service.route.color
            }}
            tripId={service.trip_id}
            currentStop={service.stop}
            stopTimes={stopTimes}
            refreshing={refreshing}
        />
    )

    if (!isMobile) {
        return (
            <Dialog open={open} onOpenChange={handleOpenChange}>
                {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
                {open && stops && (
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">{content}</DialogContent>
                )}
            </Dialog>
        )
    }

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            {triggerButton && <SheetTrigger asChild>{triggerButton}</SheetTrigger>}
            {open && stops && (
                <SheetContent side={"bottom"} className="max-h-[90vh] rounded-t-lg">
                    <div className="mx-auto w-full max-w-sm overflow-y-auto">{content}</div>
                </SheetContent>
            )}
        </Sheet>
    )
})

export default ServiceTrackerModal

export interface VehiclesResponse {
    trip_id: string
    route: Route
    trip: Trip
    occupancy: number
    license_plate: string
    position: Position
    type: string
    state: "Approaching" | "AtStop" | "Departed" | "Unknown"
    off_course: boolean
}

export interface Position {
    lat: number
    lon: number
}

export interface Route {
    id: string
    name: string
    color: string
}

export interface Trip {
    first_stop: ServicesStop
    next_stop: ServicesStop
    final_stop: ServicesStop
    current_stop: ServicesStop
    headsign: string
}

export interface ServicesStop {
    lat: number
    lon: number
    parent_stop_id: string
    child_stop_id: string
    name: string
    platform: string
    sequence: number
}
