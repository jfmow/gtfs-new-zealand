import Link from "next/link"
import { cn } from "@/lib/utils"

export type MapMode = "stops" | "vehicles"

const MODES: { mode: MapMode; label: string }[] = [
    { mode: "stops", label: "Stops" },
    { mode: "vehicles", label: "Vehicles" },
]

/**
 * The Map tab's Stops / Vehicles switch - the iOS Map tab's `MapModePicker`
 * (a capsule with the chosen segment raised on a card).
 */
export function MapModeSwitch({ mode, className }: { mode: MapMode; className?: string }) {
    return (
        <nav
            aria-label="Map mode"
            className={cn("inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-[3px] shadow-sm", className)}
        >
            {MODES.map((item) => {
                const active = item.mode === mode
                return (
                    <Link
                        key={item.mode}
                        href={{ pathname: "/map", query: { mode: item.mode } }}
                        replace
                        shallow
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "flex min-h-[30px] items-center rounded-full px-4 text-sm font-medium transition-colors",
                            active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {item.label}
                    </Link>
                )
            })}
        </nav>
    )
}
