import { memo, type ReactNode } from "react"
import { ChevronLeft, X } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Button } from "../../ui/button"
import { Dialog, DialogContent, DialogTitle } from "../../ui/dialog"
import ErrorScreen from "../../ui/error-screen"
import LoadingSpinner from "../../loading-spinner"
import ServiceTrackerContent from "./body"
import TrackerMap from "./tracker-map"
import TrackerMobileSheet from "./mobile-sheet"
import { useServiceTracker, ServiceTrackerProvider } from "./use-service-tracker"
import type { PreviewData } from "."

type Variant = "panel" | "page" | "sheet" | "dialog"

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
    /** Force-hide the tracker's own map (defaults on for every variant except "page"). */
    hideMap?: boolean
    onClose: () => void
    /**
     * "panel" docks beside an existing view (desktop); "sheet" is the map-first
     * mobile drawer; "dialog" is the desktop split (map + detail); "page" is the
     * legacy full-screen mobile view.
     */
    variant?: Variant
    /** For "sheet": render the tracker's own full-screen map behind the drawer. Off when the page already shows one (e.g. /vehicles). */
    hasOwnMap?: boolean
    /** Label for the back/close affordance, e.g. "Departures". */
    backLabel?: string
}

/**
 * Single entry point for the service tracker. Owns the polling lifecycle and the
 * loading/error/empty states; each variant is a different shell around the shared
 * ServiceTrackerContent.
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
    hasOwnMap = true,
    backLabel = "Back",
}: ServiceTrackerViewProps) {
    // "page" is the only variant that still shows the tracker's own inline map;
    // the others supply the map themselves (sheet/dialog) or dock beside an
    // existing one (panel).
    const resolvedHideMap = hideMap ?? variant !== "page"
    const stopsLayout: "inset" | "page" = variant === "panel" || variant === "dialog" ? "inset" : "page"
    const { stops, stopTimes, vehicle, initialLoading, refreshing, error } = useServiceTracker(tripId, has, true)
    const reduceMotion = useReducedMotion()

    const ready = !!vehicle || (!!previewData && !!stops)

    const withProvider = (children: ReactNode) => (
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
            {children}
        </ServiceTrackerProvider>
    )

    const detail = ready ? (
        <ServiceTrackerContent />
    ) : initialLoading ? (
        <LoadingSpinner description="Loading service…" height="200px" />
    ) : error ? (
        <ErrorScreen
            traceId={error.traceId}
            errorTitle="Couldn't load this service"
            errorText={
                error.statusCode === 404 || error.statusCode === 400
                    ? "We don't have stop details for this trip right now — it may have just finished, or its timetable was updated. Try another service."
                    : error.message || "Something went wrong loading this service. Try again shortly."
            }
        />
    ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
            This service couldn&apos;t be loaded — it may have finished for the day.
        </p>
    )

    if (variant === "sheet") {
        return withProvider(
            <TrackerMobileSheet
                hasOwnMap={hasOwnMap}
                backLabel={backLabel === "Back" ? undefined : backLabel}
                onClose={onClose}
            >
                {detail}
            </TrackerMobileSheet>,
        )
    }

    if (variant === "dialog") {
        return withProvider(
            <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
                <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 p-0" aria-describedby={undefined}>
                    <DialogTitle className="sr-only">Live service tracker</DialogTitle>
                    <div className="flex min-h-0 flex-1">
                        <div className="relative w-1/2 border-r border-border">
                            {ready ? (
                                <TrackerMap height="100%" />
                            ) : (
                                <LoadingSpinner description="Loading map…" height="100%" />
                            )}
                        </div>
                        <div className="w-1/2 overflow-y-auto overscroll-contain p-4">{detail}</div>
                    </div>
                </DialogContent>
            </Dialog>,
        )
    }

    if (variant === "page") {
        return withProvider(
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
                    <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-4">{detail}</div>
                </div>
            </motion.div>,
        )
    }

    // "panel" - docked beside a full-page map on desktop.
    return withProvider(
        <aside className="flex h-full max-h-full w-[400px] max-w-[38vw] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border p-3">
                <span className="text-sm font-medium text-muted-foreground">Live tracker</span>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close tracker">
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">{detail}</div>
        </aside>,
    )
})

export default ServiceTrackerView

/** Backwards-compatible alias - the docked desktop panel used elsewhere. */
export const ServiceTrackerPanel = ServiceTrackerView
