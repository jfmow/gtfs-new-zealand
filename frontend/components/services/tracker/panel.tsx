import { memo } from "react"
import { X } from "lucide-react"
import { Button } from "../../ui/button"
import LoadingSpinner from "../../loading-spinner"
import ServiceTrackerContent from "./body"
import { useServiceTracker } from "./use-service-tracker"

interface ServiceTrackerPanelProps {
    tripId: string
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    onClose: () => void
}

/**
 * Desktop counterpart to ServiceTrackerModal: docks beside the map instead of
 * covering it. Drives its own polling via useServiceTracker so it can be open
 * at the same time as the map keeps rendering everything else.
 */
const ServiceTrackerPanel = memo(function ServiceTrackerPanel({ tripId, currentStop, onClose }: ServiceTrackerPanelProps) {
    const { stops, stopTimes, vehicle, refreshing } = useServiceTracker(tripId, true, true)

    return (
        <aside className="flex flex-col w-[420px] max-w-[38vw] shrink-0 border border-border rounded-md bg-background overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-background z-10">
                <span className="text-sm font-medium text-muted-foreground">Tracking vehicle</span>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close tracker">
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <div className="p-4">
                {vehicle ? (
                    <ServiceTrackerContent
                        vehicle={vehicle}
                        stops={stops}
                        tripId={tripId}
                        currentStop={currentStop}
                        stopTimes={stopTimes}
                        refreshing={refreshing}
                    />
                ) : (
                    <LoadingSpinner description="Loading vehicle..." height="200px" />
                )}
            </div>
        </aside>
    )
})

export default ServiceTrackerPanel
