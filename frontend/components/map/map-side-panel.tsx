import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The panel's width plus its inset - what a map beside it should pad by. */
export const MAP_SIDE_PANEL_OCCUPIED_WIDTH = 400 + 12 * 2

/**
 * A card floating on a full-bleed map's left edge (desktop) - the iOS app's
 * `MapSidePanel` on iPad. Holds a stop's board or a service tracker, leaving
 * the rest of the map visible and usable. Its parent must be `relative`.
 */
export function MapSidePanel({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <aside
            className={cn(
                "map-side-panel absolute bottom-3 left-3 top-3 z-20 flex w-[400px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl",
                "animate-in fade-in slide-in-from-left-4 duration-200",
                className
            )}
        >
            {children}
        </aside>
    )
}

/** The side panel's title row: a back or close button, the title, then any actions. */
export function MapSidePanelHeader({
    title,
    leading,
    actions,
}: {
    title: ReactNode
    leading?: ReactNode
    actions?: ReactNode
}) {
    return (
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
            {leading}
            <h2 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{title}</h2>
            {actions}
        </div>
    )
}
