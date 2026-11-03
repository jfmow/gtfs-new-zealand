import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { ChevronRight, History, Rss } from "lucide-react"
import type { Service } from "@/components/services"
import { ApiFetch } from "@/lib/url-context"
import { cn, fullyEncodeURIComponent } from "@/lib/utils"
import { headsignDisplay, timeTillArrivalString } from "@/lib/formating"
import { ModeTile, SavedTile } from "./tiles"
import { inRegion } from "@/lib/region-time"

const REFRESH_MS = 30_000

/**
 * A stop's next few departures, soonest first, refreshed every 30s. After a
 * refresh fails the last good list stays, marked stale - the iOS
 * `NextDeparturesLoader`.
 */
export function useLiveNextDepartures(stopQuery: string, limit = 2) {
    const [services, setServices] = useState<Service[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [staleSince, setStaleSince] = useState<Date | null>(null)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    useEffect(() => {
        let cancelled = false
        let hasData = false
        setServices(null)
        setFailed(false)
        setStaleSince(null)

        async function load() {
            const res = await ApiFetch<Service[]>(`services/${fullyEncodeURIComponent(stopQuery)}?limit=8`)
            if (cancelled) return
            if (res.ok) {
                hasData = true
                setServices(
                    res.data
                        .filter((s) => s.time_till_arrival >= 0 && !s.departed)
                        .sort((a, b) => a.time_till_arrival - b.time_till_arrival)
                        .slice(0, limit)
                )
                setFailed(false)
                setStaleSince(null)
                setLastUpdated(new Date())
            } else if (res.status_code === 404) {
                hasData = true
                setServices([])
                setStaleSince(null)
            } else if (hasData) {
                setStaleSince((since) => since ?? new Date())
            } else {
                setFailed(true)
            }
        }

        load()
        const id = setInterval(() => { if (document.visibilityState === "visible") load() }, REFRESH_MS)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [stopQuery, limit])

    return { services, failed, isStale: staleSince !== null, lastUpdated }
}

/** One departure: route badge, headsign, platform, countdown (blue when live-tracked). */
export function DepartureLine({ service }: { service: Service }) {
    const isLive = !service.canceled && (service.location_tracking || service.trip_update_tracking)
    const hasPlatform = service.platform && service.platform !== "no platform"
    const countdown = service.canceled ? "Cancelled" : timeTillArrivalString(service.arrival_time)
    return (
        <div className="flex min-w-0 items-center gap-2 text-xs">
            <span
                className="shrink-0 rounded px-1.5 py-0.5 font-display text-[11px] font-bold leading-4 text-white"
                style={{ background: "#" + (service.route.color || "424242") }}
            >
                {service.route.name}
            </span>
            <span className="min-w-0 truncate text-foreground">{headsignDisplay(service.headsign)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
                {hasPlatform && <span className="text-muted-foreground">Pl {service.platform}</span>}
                <span
                    className={cn(
                        "font-mono font-medium tabular-nums",
                        service.canceled ? "text-destructive" : isLive ? "text-blue-600 dark:text-blue-400" : "text-foreground"
                    )}
                    aria-label={isLive ? `Live, ${countdown}` : countdown}
                >
                    {countdown}
                </span>
            </span>
        </div>
    )
}

/**
 * One stop on Home (a saved stop or a nearby one) as a small departure
 * board - the iOS `HomeBoardCard`: a header (tile, name, detail), then a
 * line per departure with its route, where it's going and the countdown.
 */
export function HomeStopRow({
    stopQuery,
    title,
    detail,
    tile,
    href,
    menu,
    lines = 3,
}: {
    stopQuery: string
    title: string
    detail?: string
    tile: ReactNode
    href: string
    /** Options button, top right (sits over the row's link). */
    menu?: ReactNode
    /** Departures shown. */
    lines?: number
}) {
    const { services, failed, isStale, lastUpdated } = useLiveNextDepartures(stopQuery, lines)

    return (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:bg-accent/30">
            <Link href={href} className="absolute inset-0 z-0" aria-label={`${title}${detail ? `, ${detail}` : ""} - departures`} />
            <div className="pointer-events-none relative">
                <div className={cn("flex items-center gap-2.5 px-3.5 pb-2 pt-3", menu && "pr-11")}>
                    <span className="shrink-0" aria-hidden>{tile}</span>
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</span>
                    {detail && <span className="shrink-0 text-[13px] text-muted-foreground">{detail}</span>}
                    {!menu && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />}
                </div>
                {services === null && !failed && Array.from({ length: lines }).map((_, i) => (
                    <div key={i} className="border-t border-border px-3.5 py-2.5">
                        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    </div>
                ))}
                {failed && <p className="border-t border-border px-3.5 py-2.5 text-[13px] text-muted-foreground">Couldn&apos;t load departures</p>}
                {services && services.length === 0 && <p className="border-t border-border px-3.5 py-2.5 text-[13px] text-muted-foreground">No more departures today</p>}
                {services && services.length > 0 && (
                    <div className={cn(isStale && "opacity-60")}>
                        {services.map((service) => <BoardLine key={service.trip_id + service.platform} service={service} />)}
                    </div>
                )}
                {isStale && lastUpdated && (
                    <p className="flex items-center gap-1 border-t border-border px-3.5 py-2 text-xs text-amber-600 dark:text-amber-400">
                        <History className="h-3 w-3" />
                        Times as of {lastUpdated.toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))}
                    </p>
                )}
            </div>
            {menu && <div className="absolute right-2 top-2 z-10">{menu}</div>}
        </div>
    )
}

/** One line of a board: route badge, headsign, then the countdown (blue + a live icon when tracked). */
export function BoardLine({ service }: { service: Service }) {
    const isLive = !service.canceled && (service.location_tracking || service.trip_update_tracking)
    const countdown = service.canceled ? "Cancelled" : timeTillArrivalString(service.arrival_time)
    return (
        <div className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5">
            <span className="min-w-[44px] shrink-0">
                <RouteBadge name={service.route.name} color={service.route.color} />
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-[15px]", service.canceled ? "text-muted-foreground line-through" : "text-foreground")}>
                {headsignDisplay(service.headsign)}
            </span>
            {isLive && <Rss className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />}
            <span
                className={cn("shrink-0 font-mono text-[15px] font-medium tabular-nums", service.canceled ? "text-destructive" : isLive ? "text-blue-600 dark:text-blue-400" : "text-foreground")}
                aria-label={isLive ? `Live, ${countdown}` : countdown}
            >
                {countdown}
            </span>
        </div>
    )
}

/** A route's badge in its colour - iOS `RouteBadge`. */
export function RouteBadge({ name, color, className }: { name: string; color?: string; className?: string }) {
    return (
        <span
            className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white", className)}
            style={{ background: "#" + (color || "424242") }}
        >
            {name}
        </span>
    )
}

/** A saved stop's tile: its colour with a star. */
export function FavouriteTile({ color }: { color: string }) {
    return <SavedTile color={color} />
}

/** A nearby stop's tile: its mode on a muted square. */
export function StopModeTile({ stopType }: { stopType: string }) {
    return <ModeTile stopType={stopType} />
}
