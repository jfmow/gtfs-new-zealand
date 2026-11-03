import { Bus, Ship, Star, TramFront } from "lucide-react"

/** A saved stop's small tile: its colour, a star - iOS `HomeSavedTile`. */
export function SavedTile({ color, size = 24 }: { color: string; size?: number }) {
    return (
        <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-[7px]"
            style={{ width: size, height: size, backgroundColor: `${color}2e`, color }}
        >
            <Star className="h-3 w-3 fill-current" strokeWidth={2.5} />
        </span>
    )
}

/** A stop's mode glyph on a muted tile - iOS `HomeModeTile`. */
export function ModeTile({ stopType, size = 24 }: { stopType?: string; size?: number }) {
    const Icon = stopType === "train" ? TramFront : stopType === "ferry" ? Ship : Bus
    return (
        <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-[7px] bg-muted text-foreground"
            style={{ width: size, height: size }}
        >
            <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
    )
}
