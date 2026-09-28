"use client"

import { useEffect, useState, type ReactNode } from "react"
import { BellIcon, ChevronLeft, MessageCircleWarning, Navigation, TriangleAlertIcon } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import RouteNotifications from "@/components/notifications/route-notifications"
import TrackerMap from "./tracker-map"
import { useRouteAlerts } from "./body"
import { useServiceTrackerContext } from "./use-service-tracker"
import { useImmersive } from "@/lib/immersive"
import { cn } from "@/lib/utils"

interface TrackerMobileSheetProps {
    /** Render a full-screen map behind the drawer. False when the caller (e.g. /vehicles) already shows one. */
    hasOwnMap: boolean
    /** Text on the drawer's back control - e.g. "Departures". Defaults to "Close". */
    backLabel?: string
    onClose: () => void
    /** The trip detail (ServiceTrackerContent, or a loading/error state). */
    children: ReactNode
}

/**
 * Map-first mobile tracker: the map fills the screen and the trip detail lives in
 * a bottom drawer over it. Opens at a ~40% peek (route + occupancy + time-away +
 * next stop), pulls up to full height for the stop list and reminders. Swipe down
 * past the peek to dismiss.
 */
export default function TrackerMobileSheet({ hasOwnMap, backLabel, onClose, children }: TrackerMobileSheetProps) {
    const { tripId, vehicle, previewData } = useServiceTrackerContext()
    const [activeSnapPoint, setActiveSnapPoint] = useState<number | string | null>(0.4)
    /** The map follows the vehicle until the rider pans it; the follow button hands it back. */
    const [follow, setFollow] = useState(true)
    const [alertsOpen, setAlertsOpen] = useState(false)
    const routeId = vehicle?.route.id || previewData?.route_id
    const routeName = vehicle?.route.name || previewData?.route_name || routeId
    const routeAlerts = useRouteAlerts(hasOwnMap ? routeId : undefined)
    // Frame the vehicle in the map left visible above the drawer.
    const [viewportH, setViewportH] = useState(0)
    useEffect(() => setViewportH(window.innerHeight), [])
    // A full-screen tracker: no tab bar or resume card over it (as on iOS).
    useImmersive(true)

    // Back to the peek height whenever a different service is opened.
    useEffect(() => {
        setActiveSnapPoint(0.4)
    }, [tripId])

    // vaul runs a *modal* Radix dialog underneath even with modal={false}, so its
    // dismissable-layer strands `pointer-events: none` / `overflow: hidden` on
    // <body>. The restore only fires on vaul's own state changes, and a branch
    // swap or a toggle mid-animation can make Radix's shared layer miss it
    // entirely - which kills the whole page. Keep <body> unlocked the whole time
    // the sheet is open, past the animation race. (Mirrors route-detail-sheet.tsx.)
    useEffect(() => {
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = "" }
    }, [])
    useEffect(() => {
        const unlock = () => { document.body.style.pointerEvents = "" }
        unlock()
        const raf = requestAnimationFrame(unlock)
        const timer = setTimeout(unlock, 400)
        return () => {
            cancelAnimationFrame(raf)
            clearTimeout(timer)
        }
    }, [])
    useEffect(() => () => {
        document.body.style.pointerEvents = ""
        document.body.style.overflow = ""
    }, [])

    return (
        <>
            {hasOwnMap && (
                <div className="fixed inset-0 z-40">
                    <TrackerMap
                        height="100%"
                        follow={follow}
                        onUserMove={() => setFollow(false)}
                        padding={{ top: 64, bottom: activeSnapPoint === 1 ? 0 : Math.round(viewportH * 0.4) }}
                    />
                    {/* Back, route alerts and follow - floating over the map in
                        place of a header (the iOS tracker's top bar). */}
                    <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-center gap-2">
                        <FloatingButton onClick={onClose} label={backLabel ? `Back to ${backLabel}` : "Close"}>
                            <ChevronLeft className="h-5 w-5" />
                        </FloatingButton>
                        <span className="flex-1" />
                        {routeId && (
                            <FloatingButton onClick={() => setAlertsOpen(true)} label={`Alerts for route ${routeName}${routeAlerts.length ? `, ${routeAlerts.length} current` : ""}`}>
                                <MessageCircleWarning className="h-[18px] w-[18px]" />
                                {routeAlerts.length > 0 && (
                                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                                        {routeAlerts.length}
                                    </span>
                                )}
                            </FloatingButton>
                        )}
                        <FloatingButton onClick={() => setFollow(true)} label={follow ? "Following the vehicle" : "Follow the vehicle"} pressed={follow}>
                            <Navigation className={cn("h-[18px] w-[18px]", follow && "fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400")} />
                        </FloatingButton>
                    </div>
                </div>
            )}
            <Drawer
                open
                onOpenChange={(o) => { if (!o) onClose() }}
                modal={false}
                shouldScaleBackground={false}
                // Dragging below the 0.4 peek dismisses (returns to the board / map).
                snapPoints={[0.4, 1]}
                activeSnapPoint={activeSnapPoint}
                setActiveSnapPoint={setActiveSnapPoint}
            >
                {/* Fixed h-[85vh] (not max-h): vaul computes snap offsets as a
                    viewport fraction, so at 0.4 it translates an 85vh sheet down
                    ~51vh, leaving a ~34vh peek and ~15vh of map above it at snap 1.
                    Top snap must be exactly 1 or vertical drags over the content
                    move the sheet instead of scrolling it. */}
                <DrawerContent overlayClassName="hidden" className="z-50 h-[85vh]" aria-describedby={undefined}>
                    <DrawerTitle className="sr-only">Live service tracker</DrawerTitle>
                    {!hasOwnMap && (
                        <div className="flex items-center border-b border-border px-1.5 pb-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                {backLabel ?? "Close"}
                            </button>
                        </div>
                    )}
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
                        {children}
                    </div>
                </DrawerContent>
            </Drawer>

            <Dialog open={alertsOpen} onOpenChange={setAlertsOpen}>
                <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Route {routeName}</DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 space-y-2 overflow-y-auto">
                        {routeAlerts.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No current alerts for this route.</p>}
                        {routeAlerts.map((alert) => (
                            <div key={alert.title} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                                <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{alert.title}</p>
                                    {alert.description && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{alert.description}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                    {routeId && (
                        <RouteNotifications routeId={routeId}>
                            <button type="button" className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent/50">
                                <span>Notify me about this route</span>
                                <BellIcon className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </RouteNotifications>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}

/** A round button floating over the full-screen map - the iOS `FloatingBarButton`. */
function FloatingButton({ onClick, label, pressed, children }: { onClick: () => void; label: string; pressed?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={pressed}
            className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-md backdrop-blur transition-colors hover:bg-accent"
        >
            {children}
        </button>
    )
}
