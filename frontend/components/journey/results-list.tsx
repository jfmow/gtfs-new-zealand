"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlarmClock, AlertTriangle, ArrowLeftRight, ArrowRight, Bus, ChevronRight, Flag, Footprints, Loader2, RefreshCw, Ship, TrainFront } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JourneyType, Leg } from "./types"
import { formatDuration, formatTime, getFirstTransitLeg } from "./helpers"
import { RealtimeStatus } from "./types"

/** Results older than this (for a "Leave now" search) offer a refresh. */
const STALE_MS = 2 * 60_000

interface ResultsListProps {
    routes: JourneyType[]
    onSelect: (route: JourneyType) => void
    /** When set, future journeys get a "remind me to leave" button. */
    onRemindToLeave?: (route: JourneyType) => void
    /** When the results were planned, and whether they go stale (a "Leave now" search). */
    plannedAt?: Date | null
    canGoStale?: boolean
    onRefresh?: () => void
    /** "Later departures" (or earlier, arriving by). */
    onLoadMore?: () => void
    loadMoreLabel?: string
    isLoadingMore?: boolean
    /** Highlighted - the journey shown in the detail column (wide screens). */
    selectedId?: string
}

/**
 * The planner's options - the iOS `JourneyResultCard` list: duration, leave
 * → arrive, Direct / transfers, a "remind me" button, the leg chain, and a
 * disruption banner when a ride can't be used. A journey whose first ride
 * has already left stays listed, greyed.
 */
export function ResultsList({
    routes,
    onSelect,
    onRemindToLeave,
    plannedAt,
    canGoStale,
    onRefresh,
    onLoadMore,
    loadMoreLabel = "Later departures",
    isLoadingMore,
    selectedId,
}: ResultsListProps) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(id)
    }, [])

    if (routes.length === 0) return null
    const stale = !!canGoStale && !!plannedAt && now - plannedAt.getTime() > STALE_MS

    return (
        <div id="journey-results" className="mt-6 space-y-2 scroll-mt-20">
            <div className="flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <h2>{routes.length} route{routes.length !== 1 ? "s" : ""} found</h2>
                {stale && plannedAt && (
                    <>
                        <span>· planned {formatTime(plannedAt)}</span>
                        {onRefresh && (
                            <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={onRefresh}>
                                <RefreshCw className="h-3.5 w-3.5" /> Refresh
                            </Button>
                        )}
                    </>
                )}
            </div>
            <div className="space-y-2">
                {routes.map((route) => {
                    const hasDisruption = route.Legs.some((l) => l.Mode === "transit" && l.trip_usable === false)
                    const firstRide = getFirstTransitLeg(route)
                    const missed = !!firstRide && new Date(firstRide.DepartureTime).getTime() < now
                    const canRemind =
                        !!onRemindToLeave && !!firstRide && new Date(route.DepartureTime).getTime() > now + 60_000
                    const selected = selectedId === route.ID
                    return (
                        <div
                            key={route.ID + route.DepartureTime}
                            className={cn(
                                "relative overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40",
                                selected && "border-primary ring-1 ring-primary",
                                missed && "opacity-55",
                            )}
                        >
                            <button
                                type="button"
                                className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                onClick={() => onSelect(route)}
                                aria-label={`${formatDuration(route.TotalDuration)}, leave ${formatTime(route.DepartureTime)}, arrive ${formatTime(route.ArrivalTime)}, ${route.Transfers === 0 ? "direct" : `${route.Transfers} transfers`}${missed ? ", already left" : ""}`}
                            />
                            {hasDisruption && (
                                <div className="pointer-events-none relative flex items-center gap-2 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                                    <AlertTriangle className="h-3 w-3" />
                                    Service disruption on this route
                                </div>
                            )}
                            <div className="pointer-events-none relative flex flex-col gap-2.5 p-3.5">
                                <div className="flex items-start gap-2">
                                    <div className="flex flex-1 flex-col">
                                        <span className="font-mono text-lg font-semibold leading-none">{formatDuration(route.TotalDuration)}</span>
                                        <span className="mt-1 text-xs tabular-nums text-muted-foreground">
                                            {formatTime(route.DepartureTime)}
                                            <ArrowRight className="mx-1 inline h-3 w-3" />
                                            {formatTime(route.ArrivalTime)}
                                        </span>
                                    </div>
                                    {missed && <Badge variant="outline" className="text-[10px]">Left</Badge>}
                                    <Badge variant={route.Transfers === 0 ? "default" : "secondary"} className="text-[10px]">
                                        {route.Transfers === 0 ? "Direct" : `${route.Transfers} transfer${route.Transfers !== 1 ? "s" : ""}`}
                                    </Badge>
                                    {canRemind && (
                                        <button
                                            type="button"
                                            aria-label="Remind me when to leave for this journey"
                                            onClick={() => onRemindToLeave!(route)}
                                            className="pointer-events-auto relative z-10 -my-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                        >
                                            <AlarmClock className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                                <LegChain legs={route.Legs} />
                            </div>
                        </div>
                    )
                })}
            </div>
            {onLoadMore && (
                <Button variant="ghost" className="w-full text-muted-foreground" onClick={onLoadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4 rotate-90" />}
                    {loadMoreLabel}
                </Button>
            )}
        </div>
    )
}

type ChainItem =
    | { kind: "start" }
    | { kind: "end" }
    | { kind: "walk"; minutes: number }
    | { kind: "ride"; leg: Leg }
    | { kind: "transfer"; waitMinutes: number | null }

/** bus / train / ferry, from the route's vehicle type. */
function modeOf(leg: Leg): "bus" | "train" | "ferry" {
    const type = (leg.Route?.vehicle_type ?? "").toLowerCase()
    if (type.includes("train") || type.includes("rail")) return "train"
    if (type.includes("ferry")) return "ferry"
    return "bus"
}

/**
 * A journey at a glance - the iOS `LegChain`: start, walk minutes, each ride
 * with its mode and route badge, a transfer marker with the wait, the end.
 */
export function LegChain({ legs }: { legs: Leg[] }) {
    const items: ChainItem[] = [] //removed [{ kind: "start" }], because the start is implied by the first walk or ride
    let lastRideArrival: number | null = null
    legs.forEach((leg, index) => {
        if (leg.Mode === "walk") {
            items.push({ kind: "walk", minutes: Math.max(1, Math.round(leg.Duration / 60_000_000_000)) })
            return
        }
        if (lastRideArrival !== null) {
            let walkAfterMs = 0
            for (let i = index - 1; i >= 0 && legs[i].Mode === "walk"; i--) walkAfterMs += legs[i].Duration / 1_000_000
            const wait = Math.floor((new Date(leg.DepartureTime).getTime() - lastRideArrival - walkAfterMs) / 60_000)
            items.push({ kind: "transfer", waitMinutes: Math.max(0, wait) })
        }
        items.push({ kind: "ride", leg })
        lastRideArrival = new Date(leg.ArrivalTime).getTime()
    })
    //items.push({ kind: "end" }) // removed because the end is implied by the last walk or ride

    const spoken = items
        .map((item) => {
            switch (item.kind) {
                case "walk": return `walk ${item.minutes} minutes`
                case "ride": return `${modeOf(item.leg)} ${item.leg.Route?.route_short_name || item.leg.RouteID}`
                case "transfer": return item.waitMinutes ? `transfer, ${item.waitMinutes} minute wait` : "transfer"
                case "end": return "arrive"
                default: return null
            }
        })
        .filter(Boolean)
        .join(", ")

    return (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label={spoken} role="img">
            {items.map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1" aria-hidden>
                    <ChainPiece item={item} />
                    {i < items.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/70" />}
                </span>
            ))}
        </div>
    )
}

function ChainPiece({ item }: { item: ChainItem }) {
    switch (item.kind) {
        case "start":
            return <span className="mx-px block h-2.5 w-2.5 rounded-full border-2 border-foreground" />
        case "end":
            return <Flag className="h-3 w-3 fill-foreground text-foreground" />
        case "walk":
            return (
                <span className="inline-flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
                    <Footprints className="h-3 w-3" />{item.minutes}
                </span>
            )
        case "transfer":
            return (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    <ArrowLeftRight className="h-2.5 w-2.5" />
                    {item.waitMinutes ? `${item.waitMinutes}m` : null}
                </span>
            )
        case "ride": {
            const leg = item.leg
            const Icon = { bus: Bus, train: TrainFront, ferry: Ship }[modeOf(leg)]
            const status = leg.realtime_status
            const live = status === RealtimeStatus.Delayed || status === RealtimeStatus.Early
            return (
                <span className="inline-flex items-center gap-1">
                    <Icon className="h-3 w-3 text-foreground" />
                    <span className="relative inline-flex">
                        <span
                            className="rounded px-1.5 py-0.5 text-[11px] font-bold leading-4"
                            style={{
                                background: "#" + (leg.Route?.route_color || "424242"),
                                color: leg.Route?.route_text_color ? `#${leg.Route.route_text_color}` : "#ffffff",
                                opacity: leg.trip_usable === false ? 0.5 : 1,
                            }}
                        >
                            {leg.Route?.route_short_name || leg.RouteID}
                        </span>
                        {live && (
                            <span className={cn("absolute -right-1 -top-1 h-2 w-2 rounded-full", status === RealtimeStatus.Delayed ? "bg-amber-500" : "bg-green-500")} />
                        )}
                    </span>
                </span>
            )
        }
    }
}
