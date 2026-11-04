import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A pill floating over a full-bleed map - the iOS `FilterChip`/`Chip`:
 * filled when active, a card with a light shadow otherwise so it reads over
 * any basemap. Forwards its ref so it can be a popover trigger.
 */
export const MapChip = forwardRef<HTMLButtonElement, {
    active: boolean
    icon?: ReactNode
    children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">>(function MapChip({ active, icon, children, className, ...rest }, ref) {
    return (
        <button
            ref={ref}
            type="button"
            aria-pressed={active}
            className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium shadow-sm transition-colors",
                active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background/95 text-foreground backdrop-blur hover:bg-accent",
                className
            )}
            {...rest}
        >
            {icon}
            {children}
        </button>
    )
})

/**
 * The row of controls floating at the top of the map: the mode switch, then
 * a horizontally scrolling row of filter pills (the iOS `MapModeFilterBar`).
 * `insetLeft` keeps it clear of an open side panel; `note` is a small line of
 * status text under the pills.
 */
export function MapTopBar({ switcher, children, insetLeft = 0, note, below }: { switcher: ReactNode; children: ReactNode; insetLeft?: number; note?: ReactNode; below?: ReactNode }) {
    // One floating row, as on iOS (2026-11-03): the switch on the left, the
    // filter (and anything else) on the right; an active filter's chip below.
    return (
        <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] transition-[padding] duration-300"
            style={{ paddingLeft: insetLeft + 12 }}
        >
            <div className="flex items-center gap-2">
                <div className="pointer-events-auto">{switcher}</div>
                <div className="flex-1" />
                <div className="pointer-events-auto flex items-center gap-2">{children}</div>
            </div>
            {below && <div className="pointer-events-auto flex">{below}</div>}
            {note && (
                <div className="pointer-events-auto flex max-w-sm items-center gap-1.5 self-center rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                    {note}
                </div>
            )}
        </div>
    )
}
