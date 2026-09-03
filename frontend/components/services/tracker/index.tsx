import { memo, useState } from "react"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "../../ui/button"
import { Eye, Loader2, Navigation } from "lucide-react"
import ServiceTrackerContent from "./body"
import { useIsMobile } from "@/lib/utils"
import { Sheet, SheetContent, SheetTrigger } from "../../ui/sheet"
import { useServiceTracker, ServiceTrackerProvider } from "./use-service-tracker"

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
    /** Suppress the internal mini map - use when the caller already shows this trip on a bigger map alongside. */
    hideMap?: boolean
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

const ServiceTrackerModal = memo(function ServiceTrackerModal({
    loaded,
    tripId,
    currentStop,
    has,
    defaultOpen,
    onOpenChange,
    previewData,
    hideMap,
}: ServiceTrackerModalProps) {
    const [open, setOpen] = useState(defaultOpen)
    const isMobile = useIsMobile()
    const { stops, stopTimes, vehicle, initialLoading, refreshing } = useServiceTracker(tripId, has, !!open)

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
                            <Eye className="w-4 h-4" />
                            Preview
                        </>
                    )}
                </>
            )}
        </Button>
    ) : null

    const content = (
        <ServiceTrackerProvider
            value={{ vehicle, stops, stopTimes, previewData, tripId, currentStop, refreshing, hideMap }}
        >
            <ServiceTrackerContent />
        </ServiceTrackerProvider>
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
                <SheetContent side={"bottom"} className="max-h-[90vh] overflow-y-auto rounded-t-lg">
                    <div className="mx-auto w-full max-w-sm">{content}</div>
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
    state: "Arriving" | "AtStop" | "Leaving" | "Travelling" | "Unknown"
    off_course: boolean
}

export interface Position {
    lat: number
    lon: number
    bearing: number
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
