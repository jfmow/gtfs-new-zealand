import { useEffect, useRef, useState } from "react"
import { Footprints } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JourneyType, Leg } from "./types"

function routeName(leg: Leg) {
    return leg.Route?.route_short_name || leg.RouteID || "Bus"
}

/** Widths in proportion to `shares`, never under each piece's minimum (room for its label). */
function pieceWidths(shares: number[], minimums: number[], available: number): number[] {
    if (shares.length === 0) return []
    const minTotal = minimums.reduce((a, b) => a + b, 0)
    const spare = available - minTotal
    if (spare <= 0) return minimums.map((m) => m * (available / Math.max(minTotal, 1)))
    const total = shares.reduce((a, b) => a + b, 0)
    const wants = shares.map((s, i) => Math.max(0, (s / total) * available - minimums[i]))
    const totalWant = wants.reduce((a, b) => a + b, 0)
    return minimums.map((m, i) => m + (totalWant > 0 ? (spare * wants[i]) / totalWant : spare / minimums.length))
}

/**
 * A journey as one joined bar of labelled pieces - a walk (icon + minutes)
 * or a ride (its route, in its colour) - each about as wide as its share of
 * the trip, a wait folded into the piece it comes before so there are no
 * gaps. While tracking (`currentIndex`), done pieces fade, the current one
 * is outlined and a marker sits over `progress`. iOS `JourneyLegBar`.
 */
export function JourneyLegBar({ route, currentIndex, progress }: { route: JourneyType; currentIndex?: number; progress?: number }) {
    const ref = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(() => setWidth(el.clientWidth))
        observer.observe(el)
        setWidth(el.clientWidth)
        return () => observer.disconnect()
    }, [])

    const legs = route.Legs
    const start = new Date(route.DepartureTime).getTime()
    const end = new Date(route.ArrivalTime).getTime()
    const shares = legs.map((leg, i) => {
        const from = new Date(leg.DepartureTime).getTime() || start
        const to = i + 1 < legs.length ? new Date(legs[i + 1].DepartureTime).getTime() || end : end
        return Math.max(to - from, 1000)
    })
    const gap = 3
    const widths = pieceWidths(shares, legs.map((l) => (l.Mode === "walk" ? 40 : 48)), Math.max(0, width - gap * Math.max(legs.length - 1, 0)))

    return (
        <div ref={ref} aria-label={`Your trip: ${legs.map((l) => (l.Mode === "walk" ? "walk" : `the ${routeName(l)}`)).join(", then ")}`}>
            {progress !== undefined && width > 0 && (
                <span
                    aria-hidden
                    className="mb-0.5 block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-blue-600 dark:border-t-blue-400"
                    style={{ marginLeft: Math.max(0, Math.min(width - 10, width * progress - 5)) }}
                />
            )}
            <div className="flex" style={{ gap }} aria-hidden>
                {width > 0 && legs.map((leg, i) => {
                    const state = currentIndex === undefined ? "upcoming" : i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming"
                    const minutes = Math.max(1, Math.round((new Date(leg.ArrivalTime).getTime() - new Date(leg.DepartureTime).getTime()) / 60_000))
                    const color = "#" + (leg.Route?.route_color || "525252")
                    const text = leg.Route?.route_text_color ? "#" + leg.Route.route_text_color : "#ffffff"
                    return (
                        <span
                            key={i}
                            className={cn(
                                "flex h-[26px] shrink-0 items-center justify-center gap-0.5 overflow-hidden rounded-md text-xs font-semibold",
                                leg.Mode === "walk" && "bg-muted text-foreground",
                                state === "done" && "opacity-40",
                                state === "current" && "ring-2 ring-inset ring-blue-600 dark:ring-blue-400",
                            )}
                            style={{ width: widths[i], ...(leg.Mode === "walk" ? {} : { background: color, color: text }) }}
                        >
                            {leg.Mode === "walk" ? (
                                <><Footprints className="h-3 w-3" strokeWidth={2.5} />{minutes}</>
                            ) : (
                                <span className="truncate px-1 font-bold">{routeName(leg)}</span>
                            )}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
