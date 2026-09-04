import { useRef, useEffect, useState } from "react"
import { MapPin, Clock, AlertTriangle, Train, Waypoints, Bell, X, AlarmClock } from "lucide-react"
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
}

type ReminderType = "get_off" | "arrival" | "n_stops_away" | "leave"

export default function StopsList({
    stops,
    vehicle,
    stopTimes,
    tripId,
    routeShortName,
}: StopsListProps) {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const nextStopRef = useRef<HTMLDivElement>(null)

    const [isSelectingReminder, setIsSelectingReminder] = useState(false)
    const [reminderType, setReminderType] = useState<ReminderType | null>(null)
    const [nStopsAway, setNStopsAway] = useState(1)
    const [leaveOffsets, setLeaveOffsets] = useState<number[]>([30, 15, 5, 0])
    const [leavePrep, setLeavePrep] = useState(5)

    useEffect(() => {
        nextStopRef?.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        })
    }, [])

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
            if (leaveOffsets.length === 0) {
                toast.error("Pick at least one alert time")
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
                accessSeconds: leavePrep * 60,
                offsets: leaveOffsets,
                prepBufferSeconds: leavePrep * 60,
                maxWalkKm: "1",
                walkSpeed: "4.8",
                maxTransfers: "5",
                deeplink: `/vehicles?tripId=${encodeURIComponent(tripId)}`,
            })
            if (res.ok) {
                toast.success(
                    `Reminder set — the ${routeShortName ? routeShortName + " " : ""}${formatTime(new Date(schedMs))} departure from ${stop.name}`,
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

    const toggleReminder = (type: ReminderType) => {
        if (isSelectingReminder && reminderType === type) {
            setIsSelectingReminder(false)
            setReminderType(null)
            setTimeout(() => {
                nextStopRef?.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                })
            }, 100)
        } else {
            setIsSelectingReminder(true)
            setReminderType(type)
        }
    }

    const vehiclePosition = getVehiclePosition()

    return (
        <>
            <div
                ref={scrollAreaRef}
                className="max-h-[300px] overflow-y-auto space-y-1 p-2 sm:p-4 relative bg-white dark:bg-gray-900 rounded-md"
            >
                {isSelectingReminder && (
                    <div className="sticky top-0 z-20 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
                        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                            {reminderType === "get_off"
                                ? "Click a stop to be reminded when it's time to get off"
                                : reminderType === "leave"
                                    ? "Click the stop you'll board at"
                                    : "Click a stop to be reminded when the vehicle is arriving"}
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
                            <div key={`${stop.parent_stop_id}-${stop.platform}`} className="relative">
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
                                    className={`relative flex items-start gap-3 px-2 py-3 rounded-sm border transition-all duration-200 min-h-[60px] ${stopTime?.skipped ? "opacity-50" : ""} ${isCurrentStop
                                        ? "bg-orange-50 dark:bg-orange-900 border-orange-200 dark:border-orange-700 shadow-sm"
                                        : isNextStop
                                            ? "bg-blue-50 dark:bg-blue-900 border-blue-200 dark:border-blue-700 shadow-sm ring-2 ring-blue-100 dark:ring-blue-900"
                                            : passed
                                                ? "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                                                : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 active:bg-gray-50 dark:active:bg-gray-800"
                                        }`}
                                >
                                    {/* Indicator */}
                                    <div className="flex flex-col items-center mt-1">
                                        <div
                                            className={`w-3 h-3 rounded-full border-2 transition-colors ${isCurrentStop
                                                ? "bg-orange-400 border-orange-400"
                                                : isNextStop
                                                    ? "bg-blue-400 border-blue-400 animate-pulse"
                                                    : passed
                                                        ? "bg-gray-300 dark:bg-gray-600 border-gray-300 dark:border-gray-600"
                                                        : canSelect
                                                            ? "bg-green-100 dark:bg-green-800 border-green-400 dark:border-green-600"
                                                            : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                                }`}
                                        />
                                        {!isLast && (
                                            <div className="w-0.5 h-8 mt-1 bg-gray-200 dark:bg-gray-700" />
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
                                                                ? "text-gray-500 dark:text-gray-400"
                                                                : canSelect
                                                                    ? "text-green-700 dark:text-green-400"
                                                                    : "text-gray-900 dark:text-gray-100"
                                                        }`}
                                                >
                                                    {stop.name}
                                                </h3>

                                                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                                                    {stop.platform && (
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="w-3 h-3" />
                                                            Platform {stop.platform}
                                                        </span>
                                                    )}
                                                    {!passed && !isCurrentStop && (
                                                        <span className="flex items-center gap-1">
                                                            <Waypoints className="w-3 h-3" />
                                                            Distance {formatDistance(distance)}
                                                        </span>
                                                    )}

                                                    {(arrivalTime || departureTime) && (
                                                        <span className="flex items-center gap-1 font-mono tabular-nums">
                                                            <Clock className="w-3 h-3" />
                                                            {arrivalTime}
                                                            {departureTime && arrivalTime !== departureTime && (
                                                                <>
                                                                    <span className="text-gray-400">→</span>
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

            <div className="flex flex-col gap-2 mt-4">
                <Button
                    onClick={() => toggleReminder("get_off")}
                    className={`${!isSelectingReminder ? "border border-transparent" : ""} flex-1`}
                    variant={isSelectingReminder && reminderType === "get_off" ? "outline" : "default"}
                >
                    {isSelectingReminder && reminderType === "get_off" ? (
                        <>
                            <X className="w-4 h-4 mr-2" />
                            Cancel Selection
                        </>
                    ) : (
                        <>
                            <Bell className="w-4 h-4 mr-2" />
                            Remind me to get off
                        </>
                    )}
                </Button>

                <div className="flex gap-2 flex-1">
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={nStopsAway}
                        disabled={isSelectingReminder}
                        onChange={(e) => setNStopsAway(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                        aria-label="Number of stops away"
                        className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm text-center disabled:opacity-50"
                    />
                    <Button
                        onClick={() => toggleReminder("n_stops_away")}
                        className={`${!isSelectingReminder ? "border border-transparent" : ""} flex-1`}
                        variant={isSelectingReminder && reminderType === "n_stops_away" ? "outline" : "default"}
                    >
                        {isSelectingReminder && reminderType === "n_stops_away" ? (
                            <>
                                <X className="w-4 h-4 mr-2" />
                                Cancel Selection
                            </>
                        ) : (
                            <>
                                <Bell className="w-4 h-4 mr-2" />
                                Notify me {nStopsAway} stop{nStopsAway === 1 ? "" : "s"} away
                            </>
                        )}
                    </Button>
                </div>

                <Button
                    onClick={() => toggleReminder("leave")}
                    className={`${!isSelectingReminder ? "border border-transparent" : ""} flex-1`}
                    variant={isSelectingReminder && reminderType === "leave" ? "outline" : "default"}
                >
                    {isSelectingReminder && reminderType === "leave" ? (
                        <>
                            <X className="w-4 h-4 mr-2" />
                            Cancel Selection
                        </>
                    ) : (
                        <>
                            <AlarmClock className="w-4 h-4 mr-2" />
                            Remind me before this departs
                        </>
                    )}
                </Button>

                {isSelectingReminder && reminderType === "leave" && (
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                        <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">Alert me</p>
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { v: 30, l: "30 min before" },
                                    { v: 15, l: "15 min" },
                                    { v: 5, l: "5 min" },
                                    { v: 0, l: "At departure" },
                                ].map((o) => (
                                    <button
                                        key={o.v}
                                        type="button"
                                        onClick={() =>
                                            setLeaveOffsets((cur) =>
                                                cur.includes(o.v) ? cur.filter((x) => x !== o.v) : [...cur, o.v],
                                            )
                                        }
                                        className={cn(
                                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                            leaveOffsets.includes(o.v)
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-input bg-background hover:bg-accent",
                                        )}
                                    >
                                        {o.l}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">Time to get ready</p>
                            <div className="flex flex-wrap gap-1.5">
                                {[0, 5, 10, 15].map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => setLeavePrep(m)}
                                        className={cn(
                                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                            leavePrep === m
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-input bg-background hover:bg-accent",
                                        )}
                                    >
                                        {m === 0 ? "None" : `${m} min`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}
