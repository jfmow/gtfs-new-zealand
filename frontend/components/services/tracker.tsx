import { useUserLocation } from "@/lib/userLocation"
import { memo, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "../ui/button"
import { Loader2, MapIcon, Navigation } from "lucide-react"
import { getStopsForTrip } from "./stops"
import { ApiFetch } from "@/lib/url-context"
import ServiceTrackerContent from "./tracker-content"
import { useIsMobile } from "@/lib/utils"
import { Sheet, SheetContent, SheetTrigger } from "../ui/sheet"

interface ServiceTrackerModalProps {
    tripId: string
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    defaultOpen?: boolean
    onOpenChange?: (v: boolean) => void
    loaded: boolean
    has: boolean
    previewData?: PreviewData
}

export interface PreviewData {
    tripHeadsign: string
    route_id: string
    route_name: string
    trip_id: string
}

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

const ServiceTrackerModal = memo(function ServiceTrackerModal({
    loaded,
    tripId,
    currentStop,
    has,
    defaultOpen,
    onOpenChange,
    previewData,
}: ServiceTrackerModalProps) {
    const { location, locationFound, loading } = useUserLocation()
    const [stops, setStops] = useState<ServicesStop[] | null>(null)
    const [open, setOpen] = useState(defaultOpen)
    const [vehicle, setVehicle] = useState<VehiclesResponse>()
    const [initialLoading, setInitialLoading] = useState(false)
    const isMobile = useIsMobile()

    useEffect(() => {
        async function getData() {
            if (!has) {
                const stopsData = await getStopsForTrip(tripId)
                if (stopsData) {
                    setStops(stopsData)
                }
                return
            }
            const form = new FormData()
            form.set("tripId", tripId)
            const res = await ApiFetch<VehiclesResponse[]>(`realtime/live`, {
                method: "POST",
                body: form,
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

        let intervalId: NodeJS.Timeout | null

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                getData()
                intervalId = setInterval(getData, REFRESH_INTERVAL * 1000)
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
    }, [has, open, tripId])

    const handleOpenChange = (v: boolean) => {
        setOpen(v)
        if (onOpenChange) onOpenChange(v)
    }

    const triggerButton = !defaultOpen ? (
        <Button
            aria-label="Track service on map"
            disabled={!loaded || initialLoading}
            className="w-full"
            variant={!loaded ? "default" : !has ? "secondary" : "default"}
        >
            {!loaded || initialLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-secondary" />
            ) : (
                <>
                    {has ? (
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
            previewData={previewData}
            has={has}
            tripId={tripId}
            currentStop={currentStop}
            location={location}
            locationFound={locationFound}
            loading={loading}
        />
    )

    if (!isMobile) {
        return (
            <Dialog open={open} onOpenChange={handleOpenChange}>
                {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
                {open && (vehicle || (!has && previewData && stops)) && (
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">{content}</DialogContent>
                )}
            </Dialog>
        )
    }

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            {triggerButton && <SheetTrigger asChild>{triggerButton}</SheetTrigger>}
            {open && (vehicle || (!has && previewData && stops)) && (
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
    state: "Arrived" | "Departed" | "Arriving" | "Boarding"
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
    id: string
    name: string
    platform: string
    sequence: number
}

