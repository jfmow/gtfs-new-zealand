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
 * `insetLeft` keeps it clear of an open side panel.
 */
export function MapTopBar({ switcher, children, insetLeft = 0 }: { switcher: ReactNode; children: ReactNode; insetLeft?: number }) {
    return (
        <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 pt-3 transition-[padding] duration-300"
            style={{ paddingLeft: insetLeft }}
        >
            <div className="pointer-events-auto">{switcher}</div>
            <div className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-hide">
                {children}
            </div>
        </div>
    )
}
