import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Bus, ChevronRight, History, Loader2, Ship, Star, TrainFront } from "lucide-react"
import type { Service } from "@/components/services"
import { ApiFetch } from "@/lib/url-context"
import { cn, fullyEncodeURIComponent } from "@/lib/utils"
import { formatTextToNiceLookingWords, timeTillArrivalString } from "@/lib/formating"
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
            <span className="min-w-0 truncate text-foreground">{formatTextToNiceLookingWords(service.headsign)}</span>
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
 * One stop on Home (a saved stop or a nearby one) - the iOS `HomeStopRow`:
 * a tile, the name and a detail, then its next two departures, full width
 * so long names and several route badges fit.
 */
export function HomeStopRow({
    stopQuery,
    title,
    detail,
    tile,
    href,
    menu,
}: {
    stopQuery: string
    title: string
    detail?: string
    tile: ReactNode
    href: string
    /** Options button, top right (sits over the row's link). */
    menu?: ReactNode
}) {
    const { services, failed, isStale, lastUpdated } = useLiveNextDepartures(stopQuery, 2)

    return (
        <div className="relative rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent/40">
            <Link href={href} className="absolute inset-0 z-0 rounded-xl" aria-label={`${title}${detail ? `, ${detail}` : ""} - departures`} />
            <div className={cn("pointer-events-none relative flex items-start gap-3 px-3.5 py-3", menu && "pr-11")}>
                <span className="shrink-0" aria-hidden>{tile}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{title}</span>
                        {detail && <span className="shrink-0 font-mono text-xs text-muted-foreground">{detail}</span>}
                        {!menu && <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground/60" aria-hidden />}
                    </div>
                    {services === null && !failed && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading departures
                        </span>
                    )}
                    {failed && <span className="text-xs text-muted-foreground">Couldn&apos;t load departures</span>}
                    {services && services.length === 0 && <span className="text-xs text-muted-foreground">No upcoming services</span>}
                    {services && services.length > 0 && (
                        <div className={cn("flex flex-col gap-2", isStale && "opacity-60")}>
                            {services.map((service) => <DepartureLine key={service.trip_id + service.platform} service={service} />)}
                            {isStale && lastUpdated && (
                                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                    <History className="h-3 w-3" />
                                    Times as of {lastUpdated.toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {menu && <div className="absolute right-2 top-2 z-10">{menu}</div>}
        </div>
    )
}

/** A saved stop's tile: its colour with a star. */
export function FavouriteTile({ color }: { color: string }) {
    return (
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: `${color}2e`, color }}>
            <Star className="h-4 w-4" fill="currentColor" />
        </span>
    )
}

/** A nearby stop's tile: its mode on a muted square. */
export function StopModeTile({ stopType }: { stopType: string }) {
    const Icon = stopType === "train" ? TrainFront : stopType === "ferry" ? Ship : Bus
    return (
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-muted text-foreground">
            <Icon className="h-4 w-4" />
        </span>
    )
}
