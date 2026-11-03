import { forwardRef, useRef, useEffect, useState, useMemo } from "react"
import { Bell, ChevronDown, ChevronUp, Flag, MapPin, Triangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { StopReminderDialog, type StopReminderTarget } from "../stop-reminder-dialog"
import { useServiceTrackerContext } from "./use-service-tracker"
import { findRiderStop } from "./helpers"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."
import { inRegion } from "@/lib/region-time"
import { cleanStopName } from "@/lib/formating"

interface StopsListProps {
    stops: ServicesStop[] | null
    vehicle?: VehiclesResponse
    stopTimes?: StopTimes[] | null
    tripId?: string
    /** Short route name for the reminder copy (blank tolerated). */
    routeShortName?: string
    /** Route colour (hex, no #) for the timeline rail. */
    routeColor?: string
    /**
     * "inset" (default): the stop list scrolls inside a fixed-height box, kept
     * scrolled to the next stop. "page": it flows with the drawer / page.
     */
    layout?: "inset" | "page"
}

type StopState = "passed" | "current" | "next" | "upcoming"

/** Stops shown behind / ahead of the vehicle before the rest fold away. */
const KEEP_BEHIND = 1
const KEEP_AHEAD = 6

/**
 * The trip's stops as a timeline - the iOS tracker's stop list: arrival
 * time, the route-coloured rail (dim once passed), a marker matching the
 * map's, "N min" for what's coming up, and the next / current stop
 * highlighted. Tap any stop still ahead to be reminded about it.
 */
export default function StopsList({
    stops,
    vehicle,
    stopTimes,
    tripId,
    routeShortName,
    routeColor,
    layout = "inset",
}: StopsListProps) {
    const { currentStop, previewData } = useServiceTrackerContext()
    const isPage = layout === "page"
    const nextStopRef = useRef<HTMLButtonElement>(null)
    const [showPast, setShowPast] = useState(false)
    const [showFarAhead, setShowFarAhead] = useState(false)
    const [reminderFor, setReminderFor] = useState<{ target: StopReminderTarget; isRiderStop: boolean } | null>(null)
    /** Stops given a reminder while this was open (the API can't list one-off reminders). */
    const [reminded, setReminded] = useState<Set<string>>(new Set())
    // Re-render every 30s so "N min" counts down between polls.
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 30_000)
        return () => clearInterval(id)
    }, [])

    const rail = "#" + (routeColor || vehicle?.route.color || previewData?.route_color || "737373")
    const riderStop = findRiderStop(stops, currentStop)

    // A trip can call at the same station twice (CRL Southern line trains at
    // Newmarket) - join stop times by platform first, then parent station.
    const getStopTime = (stop: ServicesStop) =>
        stopTimes?.find((st) => st.child_stop_id === stop.child_stop_id) ??
        stopTimes?.find((st) => st.parent_stop_id === stop.parent_stop_id)

    // Limited tracking (trip-update predictions, no live vehicle): the backend
    // still marks each stop `passed`, so progress comes from that instead.
    const limited = !vehicle && !!stops && !!stopTimes?.length
    const limitedNextKey = useMemo(() => {
        if (!limited) return null
        const next = stops!.find((s) => {
            const st = getStopTime(s)
            return st && !st.passed && !st.skipped
        })
        return next ? `${next.parent_stop_id}|${next.platform}` : null
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [limited, stops, stopTimes])

    const stateOf = (stop: ServicesStop): StopState => {
        const key = `${stop.parent_stop_id}|${stop.platform}`
        if (vehicle) {
            const cur = vehicle.trip.current_stop
            const nxt = vehicle.trip.next_stop
            const isCurrent = cur.parent_stop_id === stop.parent_stop_id && cur.platform === stop.platform && cur.sequence === stop.sequence
            if (isCurrent && vehicle.state === "AtStop") return "current"
            if (nxt.parent_stop_id === stop.parent_stop_id && nxt.platform === stop.platform && !isCurrent) return "next"
            if (stop.sequence <= cur.sequence) return "passed"
            return "upcoming"
        }
        if (limited) {
            if (key === limitedNextKey) return "next"
            if (getStopTime(stop)?.passed) return "passed"
        }
        return "upcoming"
    }

    const ordered = useMemo(() => [...(stops ?? [])].sort((a, b) => a.sequence - b.sequence), [stops])
    const states = ordered.map(stateOf)

    // Keep the next stop in view in a scrolling box (not in the drawer, where
    // it would yank the shared scroll past the summary at the top).
    const nextKey = vehicle ? `${vehicle.trip.next_stop.parent_stop_id}|${vehicle.trip.next_stop.platform}` : limitedNextKey
    const lastScrolledKey = useRef<string | null>(null)
    useEffect(() => {
        if (isPage || !nextKey || !nextStopRef.current || lastScrolledKey.current === nextKey) return
        lastScrolledKey.current = nextKey
        const t = setTimeout(() => nextStopRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120)
        return () => clearTimeout(t)
    }, [isPage, nextKey, stops])

    // Fold the stops long behind the vehicle and the far-ahead ones on a long list.
    const anchorIndex = (() => {
        const i = states.findIndex((s) => s === "current" || s === "next")
        return i === -1 ? null : i
    })()
    const lastIndex = ordered.length - 1
    const collapsing = anchorIndex !== null && ordered.length > KEEP_BEHIND + KEEP_AHEAD + 5
    const inPast = (i: number) => collapsing && i < (anchorIndex as number) - KEEP_BEHIND
    const inFarAhead = (i: number) => collapsing && i > (anchorIndex as number) + KEEP_AHEAD && i !== lastIndex
    const pastCount = ordered.filter((_, i) => inPast(i)).length
    const farAheadCount = ordered.filter((_, i) => inFarAhead(i)).length

    const openReminder = (stop: ServicesStop) => {
        if (!tripId) return
        const st = getStopTime(stop)
        setReminderFor({
            isRiderStop: riderStop?.sequence === stop.sequence,
            target: {
                tripId,
                parentStopId: stop.parent_stop_id,
                childStopId: stop.child_stop_id,
                stopName: stop.name,
                lat: stop.lat,
                lon: stop.lon,
                routeShortName,
                serviceLabel: routeShortName ? `The ${routeShortName}` : undefined,
                scheduledMs: st?.scheduled_time || undefined,
                predictedMs: st?.departure_time || st?.arrival_time || undefined,
            },
        })
    }

    const rows: React.ReactNode[] = []
    if (showPast && pastCount > 0) {
        rows.push(<CollapseToggle key="hide-past" label="Hide earlier stops" direction="up" onClick={() => setShowPast(false)} />)
    }
    ordered.forEach((stop, index) => {
        if (inPast(index) && !showPast) {
            if (index === 0 || !inPast(index - 1)) {
                rows.push(<CollapseToggle key="show-past" label={`${pastCount} earlier stop${pastCount === 1 ? "" : "s"}`} direction="down" onClick={() => setShowPast(true)} />)
            }
            return
        }
        if (inFarAhead(index) && !showFarAhead) {
            if (index === 0 || !inFarAhead(index - 1)) {
                rows.push(<CollapseToggle key="show-ahead" label={`${farAheadCount} more stop${farAheadCount === 1 ? "" : "s"}`} direction="down" onClick={() => setShowFarAhead(true)} />)
            }
            return
        }
        const state = states[index]
        const stopTime = getStopTime(stop)
        const yours = riderStop?.sequence === stop.sequence
        const tappable = !!tripId && state !== "passed"
        const key = `${stop.parent_stop_id}|${stop.platform}|${stop.sequence}`
        rows.push(
            <TimelineRow
                key={key}
                ref={state === "next" ? nextStopRef : undefined}
                stop={stop}
                stopTime={stopTime}
                state={state}
                yours={yours}
                isFirst={index === 0}
                isLast={index === lastIndex}
                prevState={index > 0 ? states[index - 1] : undefined}
                rail={rail}
                reminded={reminded.has(key)}
                onTap={tappable ? () => openReminder(stop) : undefined}
            />,
        )
    })
    if (showFarAhead && farAheadCount > 0) {
        rows.push(<CollapseToggle key="hide-ahead" label="Show fewer stops" direction="up" onClick={() => setShowFarAhead(false)} />)
    }

    return (
        <div className="space-y-2">
            {/* Full-bleed rows, a bell on each stop still ahead (iOS, 2026-11-03). */}
            <div
                className={cn(
                    "-mx-1 overflow-hidden",
                    !isPage && "max-h-[50vh] overflow-y-auto overscroll-contain sm:max-h-[440px]",
                )}
            >
                {rows}
            </div>

            <StopReminderDialog
                target={reminderFor?.target ?? null}
                offersGetOff={!reminderFor?.isRiderStop}
                onOpenChange={(open) => { if (!open) setReminderFor(null) }}
                onSet={(target) => {
                    const stop = ordered.find((s) => s.parent_stop_id === target.parentStopId && s.child_stop_id === target.childStopId)
                    if (stop) setReminded((prev) => new Set(prev).add(`${stop.parent_stop_id}|${stop.platform}|${stop.sequence}`))
                }}
            />
        </div>
    )
}

interface TimelineRowProps {
    stop: ServicesStop
    stopTime?: StopTimes
    state: StopState
    prevState?: StopState
    yours: boolean
    isFirst: boolean
    isLast: boolean
    rail: string
    reminded: boolean
    onTap?: () => void
}

const TimelineRow = forwardRef<HTMLButtonElement, TimelineRowProps>(function TimelineRow({ stop, stopTime, state, prevState, yours, isFirst, isLast, rail, reminded, onTap }, ref) {
    const highlighted = state === "next" || state === "current"
    const arrival = stopTime?.arrival_time || 0
    const minutes = arrival > 0 ? Math.ceil((arrival - Date.now()) / 60_000) : null
    const showCountdown = state !== "passed" && minutes !== null && minutes >= 0 && minutes < 90

    const delay = stopTime?.arrival_time && stopTime?.scheduled_time
        ? Math.round((stopTime.arrival_time - stopTime.scheduled_time) / 60_000)
        : 0
    const delayLabel = Math.abs(delay) >= 180 ? "" : delay > 1 ? `${delay} min late` : delay < -1 ? `${-delay} min early` : ""

    // The line into this stop is dim once the vehicle is past the previous one.
    const incomingDim = prevState === "passed" && (state === "passed" || state === "current")

    const detail = [
        state === "current" ? { text: "At this stop", tone: "text-orange-600 dark:text-orange-400" } : null,
        state === "next" ? { text: "Next stop", tone: "text-blue-600 dark:text-blue-400" } : null,
        yours ? { text: "Your stop", tone: "text-red-600 dark:text-red-400" } : null,
        stopTime?.skipped ? { text: "Skipped", tone: "text-red-600 dark:text-red-400" } : null,
        stop.platform ? { text: `Platform ${stop.platform}`, tone: "" } : null,
        delayLabel && state !== "passed" ? { text: delayLabel, tone: "text-orange-600 dark:text-orange-400" } : null,
    ].filter((d): d is { text: string; tone: string } => d !== null)
    const name = cleanStopName(stop.name)
    const label = `${name}${state === "next" ? ", next stop" : state === "current" ? ", vehicle at this stop" : state === "passed" ? ", passed" : ""}${yours ? ", your stop" : ""}`

    return (
        <div
            role="listitem"
            aria-label={label}
            className={cn(
                "relative flex min-h-[54px] items-stretch gap-3 pl-3 pr-1 text-left",
                highlighted && (state === "current" ? "bg-orange-500/[0.07]" : "bg-blue-500/[0.07]"),
                state === "passed" && "opacity-70",
                stopTime?.skipped && "opacity-50",
            )}
        >
            {/* Rail + marker */}
            <span className="relative flex w-6 shrink-0 justify-center" aria-hidden>
                {!isFirst && (
                    <span className="absolute left-1/2 top-0 h-1/2 w-1 -translate-x-1/2" style={{ background: rail, opacity: incomingDim ? 0.3 : 1 }} />
                )}
                {!isLast && (
                    <span className="absolute bottom-0 left-1/2 h-1/2 w-1 -translate-x-1/2" style={{ background: rail, opacity: state === "passed" ? 0.3 : 1 }} />
                )}
                <span className="relative z-10 self-center">
                    <Marker state={state} yours={yours} isLast={isLast} rail={rail} />
                </span>
            </span>

            {/* Name, one detail line */}
            <span className="min-w-0 flex-1 self-center py-2">
                <span className={cn("block truncate text-[15px] leading-snug", (highlighted || yours) ? "font-medium text-foreground" : state === "passed" ? "text-muted-foreground" : "text-foreground")}>
                    {name}
                </span>
                {detail.length > 0 && (
                    <span className="flex h-[18px] flex-wrap gap-x-2 overflow-hidden text-[13px] leading-[18px] text-muted-foreground">
                        {detail.map((d) => <span key={d.text} className={d.tone}>{d.text}</span>)}
                    </span>
                )}
            </span>

            {/* "5 min" over its clock time */}
            {arrival > 0 && (
                <span className="flex shrink-0 flex-col items-end justify-center">
                    {showCountdown && (
                        <span className={cn("font-mono text-sm font-medium tabular-nums", state === "next" || yours ? "text-blue-600 dark:text-blue-400" : "text-foreground")}>
                            {minutes! <= 0 ? "Now" : `${minutes} min`}
                        </span>
                    )}
                    <span className="text-[13px] tabular-nums text-muted-foreground">
                        {new Date(arrival).toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))}
                    </span>
                </span>
            )}

            {/* A reminder for this stop */}
            {onTap ? (
                <button
                    ref={ref}
                    type="button"
                    onClick={onTap}
                    aria-label={reminded ? `Reminder set for ${name}` : `Remind me about ${name}`}
                    className="flex w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                    <Bell className={cn("h-4 w-4", reminded && "fill-current text-blue-600 dark:text-blue-400")} />
                </button>
            ) : (
                <span className="w-10 shrink-0" />
            )}
        </div>
    )
})

/** Matches the map's trip-stop markers: your stop, the end, next, at stop, passed, upcoming. */
function Marker({ state, yours, isLast, rail }: { state: StopState; yours: boolean; isLast: boolean; rail: string }) {
    if (yours) return <MapPin className="h-4 w-4 fill-red-500 text-red-600" />
    if (isLast) return <Flag className="h-3.5 w-3.5 fill-foreground text-foreground" />
    if (state === "next") return <Triangle className="h-3 w-3 rotate-180 fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400" />
    if (state === "current") return <span className="block h-3 w-3 rounded-full border-2 border-background bg-orange-500 ring-2 ring-orange-500" />
    if (state === "passed") return <span className="block h-2.5 w-2.5 rounded-full bg-border" />
    return <span className="block h-2.5 w-2.5 rounded-full border-2 bg-card" style={{ borderColor: rail }} />
}

/** A slim row that stands in for a run of folded stops (earlier, or far ahead). */
function CollapseToggle({ label, direction, onClick }: { label: string; direction: "up" | "down"; onClick: () => void }) {
    const Icon = direction === "up" ? ChevronUp : ChevronDown
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
        </button>
    )
}
