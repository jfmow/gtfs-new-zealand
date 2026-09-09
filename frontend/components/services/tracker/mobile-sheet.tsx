"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import TrackerMap from "./tracker-map"
import { useServiceTrackerContext } from "./use-service-tracker"

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
    const { tripId } = useServiceTrackerContext()
    const [activeSnapPoint, setActiveSnapPoint] = useState<number | string | null>(0.4)

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
                    <TrackerMap height="100%" />
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
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
                        {children}
                    </div>
                </DrawerContent>
            </Drawer>
        </>
    )
}
