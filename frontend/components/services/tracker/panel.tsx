import { memo } from "react"
import { ChevronLeft, X } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Button } from "../../ui/button"
import LoadingSpinner from "../../loading-spinner"
import ServiceTrackerContent from "./body"
import { useServiceTracker, ServiceTrackerProvider } from "./use-service-tracker"
import type { PreviewData } from "."

interface ServiceTrackerViewProps {
    tripId: string
    /** Whether this service has live location tracking - drives which feed the hook polls. */
    has?: boolean
    /** Whether the service has trip-update (arrival prediction) tracking - shown as "Limited tracking" when there's no live vehicle. */
    tripUpdateTracking?: boolean
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    previewData?: PreviewData
    /** Hide the tracker's own mini-map (use when a bigger map is already on screen). */
    hideMap?: boolean
    onClose: () => void
    /**
     * "panel" docks beside an existing view (desktop); "page" takes the whole
     * screen with a back button (mobile).
     */
    variant?: "panel" | "page"
    /** Label for the back/close affordance, e.g. "Departures". */
    backLabel?: string
}

/**
 * Full-surface counterpart to ServiceTrackerModal: instead of covering the page
 * with a dialog/sheet, it either docks beside it (desktop panel) or replaces it
 * (mobile page). Both share ServiceTrackerContent and one polling lifecycle.
 */
const ServiceTrackerView = memo(function ServiceTrackerView({
    tripId,
    has = true,
    tripUpdateTracking,
    currentStop,
    previewData,
    hideMap,
    onClose,
    variant = "panel",
    backLabel = "Back",
}: ServiceTrackerViewProps) {
    // A docked panel usually sits next to a big map already; a full page doesn't.
    const resolvedHideMap = hideMap ?? variant === "panel"
    const { stops, stopTimes, vehicle, initialLoading, refreshing } = useServiceTracker(tripId, has, true)
    const reduceMotion = useReducedMotion()

    const ready = !!vehicle || (!!previewData && !!stops)

    const buildContent = (stopsLayout: "inset" | "page") =>
        ready ? (
            <ServiceTrackerProvider
                value={{
                    vehicle,
                    stops,
                    stopTimes,
                    previewData,
                    tripId,
                    tripUpdateTracking,
                    currentStop,
                    refreshing,
                    hideMap: resolvedHideMap,
                    stopsLayout,
                }}
            >
                <ServiceTrackerContent />
            </ServiceTrackerProvider>
        ) : initialLoading ? (
            <LoadingSpinner description="Loading service…" height="200px" />
        ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
                This service couldn&apos;t be loaded — it may have finished for the day.
            </p>
        )

    if (variant === "page") {
        return (
            <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: "12%" }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: "12%" }}
                transition={{ type: "spring", damping: 32, stiffness: 320, opacity: { duration: 0.15 } }}
                className="fixed inset-0 z-50 flex flex-col bg-background"
            >
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    <div className="sticky top-0 z-20 flex h-12 items-center border-b border-border bg-background/85 px-1.5 backdrop-blur">
                        <button
                            type="button"
                            onClick={onClose}
                            className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {backLabel}
                        </button>
                    </div>
                    <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-4">{buildContent("page")}</div>
                </div>
            </motion.div>
        )
    }

    const content = buildContent("inset")

    return (
        <aside className="flex h-full max-h-full w-[400px] max-w-[38vw] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border p-3">
                <span className="text-sm font-medium text-muted-foreground">Live tracker</span>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close tracker">
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">{content}</div>
        </aside>
    )
})

export default ServiceTrackerView

/** Backwards-compatible alias - the docked desktop panel used elsewhere. */
export const ServiceTrackerPanel = ServiceTrackerView
