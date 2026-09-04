"use client"

import { Badge } from "@/components/ui/badge"
import { AlarmClock, AlertTriangle, ArrowRight, Clock, Footprints } from "lucide-react"
import type { JourneyType } from "./types"
import {
    formatDuration,
    formatTime,
    getFirstTransitLeg,
    getWaitingTimeNs,
} from "./helpers"
import { RealtimeStatus } from "./types"

interface ResultsListProps {
    routes: JourneyType[]
    onSelect: (route: JourneyType) => void
    /** When set, future journeys get a "remind me to leave" button. */
    onRemindToLeave?: (route: JourneyType) => void
}

export function ResultsList({ routes, onSelect, onRemindToLeave }: ResultsListProps) {
    if (routes.length === 0) return null

    return (
        <div id="journey-results" className="mt-6 space-y-2 scroll-mt-20">
            <h2 className="text-sm font-medium text-muted-foreground">
                {routes.length} route{routes.length !== 1 ? 's' : ''} found
            </h2>
            <div className="space-y-2">
                {routes.map((route, index) => {
                    const hasDisruption = route.Legs.some(l => l.Mode === 'transit' && l.trip_usable === false)
                    const canRemind =
                        !!onRemindToLeave &&
                        !!getFirstTransitLeg(route) &&
                        new Date(route.DepartureTime).getTime() > Date.now() + 60_000
                    return (
                        <button
                            key={index}
                            type="button"
                            className="w-full text-left rounded-xl border hover:border-primary/40 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden"
                            onClick={() => onSelect(route)}
                        >
                            {hasDisruption && (
                                <div className="flex items-center gap-2 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                                    <AlertTriangle className="h-3 w-3" />
                                    Service disruption on this route
                                </div>
                            )}
                            <div className="flex w-full flex-col gap-2 px-3.5 py-3.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex flex-col">
                                        <span className="text-lg font-semibold leading-none">{formatDuration(route.TotalDuration)}</span>
                                        <span className="text-xs text-muted-foreground mt-1">
                                            {/* Journey-level times (already realtime-adjusted + the
                                                leading walk deferred) - when you leave and when you
                                                arrive, not any one train's schedule. */}
                                            {formatTime(route.DepartureTime)}
                                            <ArrowRight className="inline mx-1 h-3 w-3" />
                                            {formatTime(route.ArrivalTime)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Badge variant={route.Transfers === 0 ? 'default' : 'secondary'} className="text-[10px]">
                                            {route.Transfers === 0 ? 'Direct' : `${route.Transfers} transfer${route.Transfers !== 1 ? 's' : ''}`}
                                        </Badge>
                                        {canRemind && (
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                aria-label="Remind me when to leave for this journey"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onRemindToLeave!(route)
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        onRemindToLeave!(route)
                                                    }
                                                }}
                                                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                            >
                                                <AlarmClock className="h-4 w-4" />
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center flex-wrap gap-y-1 gap-x-0.5">
                                    {getRouteStepsJSX(route)}
                                </div>
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function getRouteStepsJSX(route: JourneyType) {
    return route.Legs.map((leg, index) => {
        const isLast = index === route.Legs.length - 1
        const nextLeg = !isLast ? route.Legs[index + 1] : null
        const waitingNs = nextLeg ? getWaitingTimeNs(leg, nextLeg) : null
        const isDelayed = leg.realtime_status === RealtimeStatus.Delayed
        const isEarly = leg.realtime_status === RealtimeStatus.Early
        const hasRealtime = isDelayed || isEarly

        return (
            <span key={index} className="inline-flex items-center gap-1">
                {leg.Mode === "walk" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Footprints className="h-3 w-3" />
                        {Math.max(0, Math.round(leg.Duration / 60000000000))} min
                    </span>
                ) : (
                    <span className="relative inline-flex items-center">
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium"
                            style={{
                                background:
                                    "#" +
                                    (leg.Route?.route_color && leg.Route.route_color !== ""
                                        ? leg.Route.route_color
                                        : "424242"),
                                color: leg.Route?.route_text_color && leg.Route.route_text_color !== ""
                                    ? `#${leg.Route.route_text_color}`
                                    : "#ffffff",
                                filter: "brightness(0.9) contrast(1.1)",
                                opacity: leg.trip_usable === false ? 0.5 : 1,
                            }}
                        >
                            {leg.Route?.route_short_name || leg.RouteID}
                        </span>
                        {hasRealtime && (
                            <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`}>
                                <span className={`absolute inset-0 rounded-full animate-ping opacity-75 ${isDelayed ? 'bg-amber-500' : 'bg-green-500'}`} />
                            </span>
                        )}
                    </span>
                )}

                {!isLast && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground mx-0.5" />}

                {!isLast && waitingNs && waitingNs >= 60000000000 && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground mx-1 text-xs">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDuration(waitingNs)}
                        <ArrowRight className="h-2.5 w-2.5" />
                    </span>
                )}
            </span>
        )
    })
}
