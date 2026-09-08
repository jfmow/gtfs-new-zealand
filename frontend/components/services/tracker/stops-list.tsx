import { useRef, useEffect, useState } from "react"
import { MapPin, Clock, AlertTriangle, Train, Waypoints, Bell, X, AlarmClock, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import notification, { addJourneyReminder } from "@/lib/notifications"
import { formatDistance, cn } from "@/lib/utils"
import { nzHHMM, nzServiceDate, formatTime } from "@/components/journey/helpers"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."
import { formatUnixTime } from "@/lib/formating"

interface StopsListProps {
    stops: ServicesStop[] | null
    vehicle?: VehiclesResponse
    stopTimes?: StopTimes[] | null
    tripId?: string
    /** Short route name for the reminder copy (blank tolerated). */
    routeShortName?: string
    /**
     * "inset" (default): the stop list scrolls inside a fixed-height box and the
     * reminder actions sit below it. "page": the list flows with a full-screen
     * page and the reminder actions pin to the bottom of the viewport.
     */
    layout?: "inset" | "page"
}

type ReminderType = "get_off" | "arrival" | "n_stops_away" | "leave"

export default function StopsList({
    stops,
    vehicle,
    stopTimes,
    tripId,
    routeShortName,
    layout = "inset",
}: StopsListProps) {
    const isPage = layout === "page"
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const nextStopRef = useRef<HTMLDivElement>(null)
    const reminderRef = useRef<HTMLDivElement>(null)

    const [isSelectingReminder, setIsSelectingReminder] = useState(false)
    const [reminderType, setReminderType] = useState<ReminderType | null>(null)
    const [showReminderOptions, setShowReminderOptions] = useState(false)
    const [nStopsAway, setNStopsAway] = useState(1)
    const [leaveOffsets, setLeaveOffsets] = useState<number[]>([30, 15, 5, 0])

    const openReminderOptions = () => {
        setShowReminderOptions(true)
        setTimeout(() => {
            reminderRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }, 60)
    }

    const startReminder = (type: ReminderType) => {
        setShowReminderOptions(false)
        setIsSelectingReminder(true)
        setReminderType(type)
    }

    const cancelReminder = () => {
        setIsSelectingReminder(false)
        setReminderType(null)
        setShowReminderOptions(false)
        setTimeout(() => {
            nextStopRef?.current?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 100)
    }

    // Auto-scroll the "next stop" row into view. Runs when the list first has
    // data (the stops/vehicle often arrive a beat after this mounts, so an
    // empty-deps effect would fire before nextStopRef is attached and do
    // nothing) and again whenever the vehicle advances to a new next stop.
    // Keyed so it doesn't re-scroll on every poll that leaves the stop unchanged.
    const lastScrolledKey = useRef<string | null>(null)
    const nextStopKey = vehicle
        ? `${vehicle.trip.next_stop.parent_stop_id}|${vehicle.trip.next_stop.platform}`
        : null
    useEffect(() => {
        if (!nextStopKey || !nextStopRef.current || lastScrolledKey.current === nextStopKey) return
        lastScrolledKey.current = nextStopKey
        const t = setTimeout(() => {
            nextStopRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 120)
        return () => clearTimeout(t)
    }, [nextStopKey, stops])

    const getStopStatus = (stop: ServicesStop) => {
        if (!vehicle) return { isCurrentStop: false, isNextStop: false, passed: false }

        const isCurrentStop =
            vehicle.trip.current_stop.parent_stop_id === stop.parent_stop_id &&
            stop.platform === vehicle.trip.current_stop.platform

        const isNextStop =
            vehicle.trip.next_stop.parent_stop_id === stop.parent_stop_id &&
            stop.platform === vehicle.trip.next_stop.platform &&
            !isCurrentStop

        const passed = vehicle.trip.current_stop.sequence > stop.sequence

        return { isCurrentStop, isNextStop, passed }
    }

    const getStopTime = (stopId: string) =>
        stopTimes?.find((st) => st.parent_stop_id === stopId || st.child_stop_id === stopId)

    const getVehiclePosition = () => {
        if (!stops || !vehicle) return null

        const stopsToUse = isSelectingReminder
            ? stops.filter((stop) => !getStopStatus(stop).passed)
            : stops

        const currentStopIndex = stopsToUse.findIndex(
            (stop) =>
                stop.parent_stop_id === vehicle.trip.current_stop.parent_stop_id &&
                stop.platform === vehicle.trip.current_stop.platform,
        )

        if (currentStopIndex === -1) return null

        return {
            currentStopIndex,
            showAtStop: vehicle.state === "AtStop",
            showBetweenStops:
                (vehicle.state === "Leaving" || vehicle.state === "Travelling") && currentStopIndex < stopsToUse.length - 1,
        }
    }

    // A "leave" alert whose moment has already passed is impossible. Bound the
    // check by the latest stop the rider could still board at, so a valid choice
    // for a far-along stop is never disabled; handleStopSelection re-checks
    // against the exact stop that's picked. (These reminders are always one-off.)
    const latestBoardableLeaveMs = (() => {
        const times = (stops ?? [])
            .filter((s) => {
                const st = getStopStatus(s)
                return !st.passed && !st.isCurrentStop
            })
            .map((s) => {
                const t = getStopTime(s.parent_stop_id)
                return t?.departure_time || t?.scheduled_time || 0
            })
            .filter((ms) => ms > 0)
        return times.length ? Math.max(...times) : null
    })()
    const leaveOffsetImpossible = (minutes: number) =>
        latestBoardableLeaveMs !== null && latestBoardableLeaveMs - minutes * 60_000 <= Date.now() + 15_000

    // --- Reminder Handlers ---
    const handleStopSelection = async (stop: ServicesStop) => {
        if (!isSelectingReminder || !tripId || !reminderType) return

        if (reminderType === "leave") {
            const st =
                stopTimes?.find((s) => s.child_stop_id === stop.child_stop_id) ??
                stopTimes?.find((s) => s.parent_stop_id === stop.parent_stop_id)
            const schedMs = st?.scheduled_time
            if (!schedMs) {
                toast.error("No scheduled time for this stop")
                return
            }
            // The backend anchors the reminder on the trip + scheduled time, but
            // the rider cares about when the bus actually leaves - show the live
            // (delay-adjusted) departure in the confirmation, falling back to the
            // timetable when there's no realtime prediction yet.
            const displayMs = st?.departure_time || schedMs
            if (leaveOffsets.length === 0) {
                toast.error("Pick at least one alert time")
                return
            }
            // Drop any heads-up whose moment has already passed for this stop.
            const usableOffsets = leaveOffsets.filter((o) => displayMs - o * 60_000 > Date.now() + 15_000)
            if (usableOffsets.length === 0) {
                toast.error("That service leaves too soon to remind you")
                return
            }
            const res = await addJourneyReminder({
                kind: "fixed_trip",
                start: { lat: stop.lat, lon: stop.lon, label: stop.name },
                end: { lat: stop.lat, lon: stop.lon, label: stop.name },
                timeType: "departat",
                targetHHMM: nzHHMM(new Date(schedMs)),
                serviceDate: nzServiceDate(new Date(schedMs)),
                boardTripId: tripId,
                boardStopId: stop.child_stop_id,
                scheduledDepartureIso: new Date(schedMs).toISOString(),
                routeShortName: routeShortName ?? "",
                boardStopName: stop.name,
                accessSeconds: 0,
                offsets: usableOffsets,
                maxWalkKm: "1",
                walkSpeed: "4.8",
                maxTransfers: "5",
                deeplink: `/vehicles?tripId=${encodeURIComponent(tripId)}`,
            })
            if (res.ok) {
                // Prefer the backend's own computed departure ("HH:MM"); fall
                // back to the live prediction from the stop list.
                const shownTime = res.nextLeaveLocal
                    ? formatTime(`1970-01-01T${res.nextLeaveLocal}:00`)
                    : formatTime(new Date(displayMs))
                const dropped = leaveOffsets.length - usableOffsets.length
                toast.success(
                    `Reminder set — the ${routeShortName ? routeShortName + " " : ""}${shownTime} departure from ${stop.name}` +
                        (dropped > 0 ? " (earlier alert times had already passed)" : ""),
                    { duration: 8000 },
                )
            } else {
                toast.error(res.message || "Failed to add reminder")
            }
            setIsSelectingReminder(false)
            setReminderType(null)
            return
        }

        const ok = await notification.addReminder(
            stop.parent_stop_id,
            tripId,
            reminderType,
            reminderType === "n_stops_away" ? nStopsAway : undefined,
        )

        if (ok) {
            toast.success(
                reminderType === "get_off"
                    ? "Reminder added! You'll get a notification when your stop is next"
                    : reminderType === "n_stops_away"
                        ? `Reminder set! You'll get a notification when the vehicle is ${nStopsAway} stop${nStopsAway === 1 ? "" : "s"} away`
                        : "Arrival reminder set! You'll get a notification when approaching this stop",
                { duration: 8000 },
            )
        } else {
            toast.error("Failed to add reminder")
        }

        setIsSelectingReminder(false)
        setReminderType(null)
    }

    const vehiclePosition = getVehiclePosition()

    return (
        <>
            <div
                ref={scrollAreaRef}
                className={cn(
                    "relative space-y-1 rounded-xl border border-border bg-card p-2 sm:p-3",
                    !isPage && "max-h-[50vh] overflow-y-auto overscroll-contain sm:max-h-[440px]",
                )}
            >
                {isSelectingReminder && (
                    <div className={cn(
                        "sticky z-20 mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950",
                        isPage ? "top-14" : "top-0",
                    )}>
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                            {reminderType === "get_off"
                                ? "Tap the stop where you want to get off"
                                : reminderType === "leave"
                                    ? "Tap the stop you'll board at"
                                    : `Tap the stop to watch — you'll be told when the vehicle is ${nStopsAway} stop${nStopsAway === 1 ? "" : "s"} away`}
                        </p>
                    </div>
                )}

                {stops
                    ?.filter((stop) => (isSelectingReminder ? !getStopStatus(stop).passed && !getStopStatus(stop).isCurrentStop : true))
                    .map((stop, index) => {
                        const { isCurrentStop, isNextStop, passed } = getStopStatus(stop)
                        const stopTime = getStopTime(stop.parent_stop_id)
                        const distance = stopTime?.dist || 0
                        const isLast = index === stops.length - 1
                        const arrivalTime = formatUnixTime(stopTime?.arrival_time)
                        const departureTime = formatUnixTime(stopTime?.departure_time)
                        const canSelect = isSelectingReminder && !passed && !isCurrentStop

                        const delay =
                            stopTime?.arrival_time && stopTime?.scheduled_time
                                ? Math.round(
                                    (stopTime.arrival_time - stopTime.scheduled_time) / 60 / 1000,
                                )
                                : 0

                        // Ignore absurd values from a stale/bogus realtime feed.
                        const delayIsPlausible = Math.abs(delay) < 180
                        const delayLabel =
                            !delayIsPlausible
                                ? ""
                                : delay > 1
                                    ? `Late: ${delay}min`
                                    : delay < -1
                                        ? `Early: ${Math.abs(delay)}min`
                                        : ""

                        return (
                            <div key={`${stop.parent_stop_id}-${stop.platform}-${index}`} className="relative">
                                {vehiclePosition?.showBetweenStops &&
                                    vehiclePosition.currentStopIndex === index &&
                                    !isLast && !isSelectingReminder && (
                                        <div className="absolute left-[9px] sm:left-[11px] bottom-[-16px] z-10">
                                            <div className="bg-blue-500 text-white p-1.5 rounded-full shadow-lg animate-pulse">
                                                <Train className="w-3 h-3" />
                                            </div>
                                        </div>
                                    )}

                                <div
                                    ref={isNextStop ? nextStopRef : null}
                                    onClick={() => canSelect && handleStopSelection(stop)}
                                    role={canSelect ? "button" : undefined}
                                    tabIndex={canSelect ? 0 : undefined}
                                    onKeyDown={(e) => {
                                        if (canSelect && (e.key === "Enter" || e.key === " ")) {
                                            e.preventDefault()
                                            handleStopSelection(stop)
                                        }
                                    }}
                                    className={cn(
                                        "relative flex min-h-[56px] items-start gap-3 rounded-lg border border-transparent px-2.5 py-2.5 transition-colors",
                                        stopTime?.skipped && "opacity-50",
                                        canSelect && "cursor-pointer border-green-300 bg-green-50/60 hover:bg-green-50 dark:border-green-800 dark:bg-green-950/30 dark:hover:bg-green-950/50",
                                        isCurrentStop
                                            ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/60"
                                            : isNextStop
                                                ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/60"
                                                : passed
                                                    ? "opacity-60"
                                                    : "active:bg-muted",
                                    )}
                                >
                                    {/* Indicator */}
                                    <div className="flex flex-col items-center mt-1">
                                        <div
                                            className={`w-3 h-3 rounded-full border-2 transition-colors ${isCurrentStop
                                                ? "bg-orange-400 border-orange-400"
                                                : isNextStop
                                                    ? "bg-blue-400 border-blue-400 animate-pulse"
                                                    : passed
                                                        ? "bg-muted-foreground/40 border-muted-foreground/40"
                                                        : canSelect
                                                            ? "bg-green-100 dark:bg-green-900 border-green-500"
                                                            : "bg-card border-muted-foreground/40"
                                                }`}
                                        />
                                        {!isLast && (
                                            <div className="w-0.5 h-8 mt-1 bg-border" />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="min-w-0">
                                                <h3
                                                    className={`font-medium text-base leading-tight ${isCurrentStop
                                                        ? "text-orange-700 dark:text-orange-300"
                                                        : isNextStop
                                                            ? "text-blue-700 dark:text-blue-300"
                                                            : passed
                                                                ? "text-muted-foreground"
                                                                : canSelect
                                                                    ? "text-green-700 dark:text-green-400"
                                                                    : "text-foreground"
                                                        }`}
                                                >
                                                    {stop.name}
                                                </h3>

                                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-muted-foreground">
                                                    {stop.platform && (
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="w-3 h-3" />
                                                            Platform {stop.platform}
                                                        </span>
                                                    )}
                                                    {vehicle && !passed && !isCurrentStop && distance >= 1 && (
                                                        <span className="flex items-center gap-1">
                                                            <Waypoints className="w-3 h-3" />
                                                            {formatDistance(distance)} to go
                                                        </span>
                                                    )}

                                                    {(arrivalTime || departureTime) && (
                                                        <span className="flex items-center gap-1 font-mono tabular-nums">
                                                            <Clock className="w-3 h-3" />
                                                            {arrivalTime}
                                                            {departureTime && arrivalTime !== departureTime && (
                                                                <>
                                                                    <span className="text-muted-foreground/50">&rarr;</span>
                                                                    <span>{departureTime}</span>
                                                                </>
                                                            )}
                                                        </span>
                                                    )}

                                                    {delayLabel !== "" && (
                                                        <Badge
                                                            variant="secondary"
                                                            className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5"
                                                        >
                                                            {delayLabel}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-1 items-end flex-shrink-0">
                                                {isCurrentStop && vehicle && !stopTime?.skipped && (
                                                    <Badge variant="secondary" className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300">
                                                        {vehicle.state === "AtStop" ? "Current" : "Previous"}
                                                    </Badge>
                                                )}
                                                {isNextStop && !stopTime?.skipped && (
                                                    <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                                        Next
                                                    </Badge>
                                                )}
                                                {stopTime?.skipped && (
                                                    <Badge variant="outline" className="text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">
                                                        <AlertTriangle className="w-3 h-3 mr-0.5" />
                                                        <span>Skipped</span>
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
            </div>

            <div
                ref={reminderRef}
                className={cn(
                    "scroll-mt-16",
                    isPage && !isSelectingReminder && !showReminderOptions
                        ? "sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur"
                        : "mt-4",
                )}
            >
                {isSelectingReminder ? (
                    <div className="space-y-3">
                        {reminderType === "n_stops_away" && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                                <span className="text-muted-foreground">Tell me when it&apos;s</span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        aria-label="Fewer stops"
                                        onClick={() => setNStopsAway((n) => Math.max(1, n - 1))}
                                        className="flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-accent"
                                    >
                                        &minus;
                                    </button>
                                    <span className="w-8 text-center font-semibold tabular-nums">{nStopsAway}</span>
                                    <button
                                        type="button"
                                        aria-label="More stops"
                                        onClick={() => setNStopsAway((n) => Math.min(20, n + 1))}
                                        className="flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-accent"
                                    >
                                        +
                                    </button>
                                </div>
                                <span className="text-muted-foreground">
                                    stop{nStopsAway === 1 ? "" : "s"} away
                                </span>
                            </div>
                        )}

                        {reminderType === "leave" && (
                            <div className="rounded-lg border border-border bg-muted/40 p-3">
                                <p className="mb-1.5 text-xs text-muted-foreground">Alert me</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { v: 30, l: "30 min before" },
                                        { v: 15, l: "15 min" },
                                        { v: 5, l: "5 min" },
                                        { v: 0, l: "At departure" },
                                    ].map((o) => {
                                        const impossible = leaveOffsetImpossible(o.v)
                                        return (
                                        <button
                                            key={o.v}
                                            type="button"
                                            disabled={impossible}
                                            title={impossible ? "That time has already passed" : undefined}
                                            aria-pressed={leaveOffsets.includes(o.v)}
                                            onClick={() =>
                                                setLeaveOffsets((cur) =>
                                                    cur.includes(o.v) ? cur.filter((x) => x !== o.v) : [...cur, o.v],
                                                )
                                            }
                                            className={cn(
                                                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                                impossible
                                                    ? "cursor-not-allowed border-input bg-muted text-muted-foreground/50 line-through"
                                                    : leaveOffsets.includes(o.v)
                                                        ? "border-primary bg-primary text-primary-foreground"
                                                        : "border-input bg-background hover:bg-accent",
                                            )}
                                        >
                                            {o.l}
                                        </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        <Button variant="outline" className="w-full" onClick={cancelReminder}>
                            <X className="mr-2 h-4 w-4" />
                            Cancel
                        </Button>
                    </div>
                ) : showReminderOptions ? (
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">What should we remind you about?</p>
                        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                            <ReminderOptionRow
                                icon={<Bell className="h-4 w-4" />}
                                title="When to get off"
                                subtitle="A nudge as your stop comes up"
                                onClick={() => startReminder("get_off")}
                            />
                            <ReminderOptionRow
                                icon={<Waypoints className="h-4 w-4" />}
                                title="A few stops before mine"
                                subtitle="So you can get ready in time"
                                onClick={() => startReminder("n_stops_away")}
                            />
                            <ReminderOptionRow
                                icon={<AlarmClock className="h-4 w-4" />}
                                title="Before it leaves my stop"
                                subtitle="So you're not late getting there"
                                onClick={() => startReminder("leave")}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowReminderOptions(false)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                        >
                            Not now
                        </button>
                    </div>
                ) : (
                    <Button className="w-full" onClick={openReminderOptions}>
                        <Bell className="mr-2 h-4 w-4" />
                        Set a reminder
                    </Button>
                )}
            </div>
        </>
    )
}

function ReminderOptionRow({
    icon,
    title,
    subtitle,
    onClick,
}: {
    icon: React.ReactNode
    title: string
    subtitle: string
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground">{subtitle}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        </button>
    )
}
