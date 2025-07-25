import { useRef, useEffect, useState } from "react"
import {
    MapPin,
    Clock,
    AlertTriangle,
    Train,
    Waypoints,
    Bell,
    X,
    Navigation,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { format } from "date-fns"
import notification from "@/lib/notifications"
import { formatDistance } from "@/lib/utils"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."

interface StopsListProps {
    stops: ServicesStop[] | null
    vehicle?: VehiclesResponse
    stopTimes?: StopTimes[] | null
    tripId?: string
}

export default function StopsList({
    stops,
    vehicle,
    stopTimes,
    tripId,
}: StopsListProps) {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const nextStopRef = useRef<HTMLDivElement>(null)

    const [isSelectingReminder, setIsSelectingReminder] = useState(false)
    const [reminderType, setReminderType] = useState<"get_off" | "arrival" | null>(null)

    useEffect(() => {
        if (
            !isSelectingReminder &&
            nextStopRef.current &&
            scrollAreaRef.current &&
            vehicle?.trip.next_stop.id
        ) {
            const { next_stop, current_stop } = vehicle.trip

            if (next_stop.sequence >= current_stop.sequence) {
                nextStopRef.current.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                })
            }
        }
    }, [vehicle, isSelectingReminder])

    const formatUnixTime = (unixTime: number | null | undefined) =>
        unixTime ? format(new Date(unixTime), "h:mm a") : null

    const getStopStatus = (stop: ServicesStop) => {
        if (!vehicle) return { isCurrentStop: false, isNextStop: false, passed: false }

        const isCurrentStop =
            vehicle.trip.current_stop.id === stop.id &&
            stop.platform === vehicle.trip.current_stop.platform

        const isNextStop =
            vehicle.trip.next_stop.id === stop.id &&
            stop.platform === vehicle.trip.next_stop.platform &&
            !isCurrentStop

        const passed = vehicle.trip.current_stop.sequence > stop.sequence

        return { isCurrentStop, isNextStop, passed }
    }

    const getStopTime = (stopId: string) =>
        stopTimes?.find((st) => st.stop_id === stopId)

    const getVehiclePosition = () => {
        if (!stops || !vehicle) return null

        const stopsToUse = isSelectingReminder
            ? stops.filter((stop) => !getStopStatus(stop).passed)
            : stops

        const currentStopIndex = stopsToUse.findIndex(
            (stop) =>
                stop.id === vehicle.trip.current_stop.id &&
                stop.platform === vehicle.trip.current_stop.platform,
        )

        if (currentStopIndex === -1) return null

        return {
            currentStopIndex,
            showAtStop: vehicle.state === "Arrived",
            showBetweenStops:
                vehicle.state === "Departed" && currentStopIndex < stopsToUse.length - 1,
        }
    }

    // --- Reminder Handlers ---
    const handleStopSelection = async (stop: ServicesStop) => {
        if (!isSelectingReminder || !tripId || !reminderType) return

        const ok = await notification.addReminder(stop.name, tripId, reminderType)

        if (ok) {
            toast.success(
                reminderType === "get_off"
                    ? "Reminder added! You'll get a notification when your stop is next"
                    : "Arrival reminder set! You'll get a notification when approaching this stop",
                { duration: 8000 },
            )
        } else {
            toast.error("Failed to add reminder")
        }

        setIsSelectingReminder(false)
        setReminderType(null)
    }

    const toggleReminder = (type: "get_off" | "arrival") => {
        if (isSelectingReminder && reminderType === type) {
            setIsSelectingReminder(false)
            setReminderType(null)
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
                                ? "Click a green stop to be reminded when it's time to get off"
                                : "Click a green stop to be reminded when the vehicle is arriving"}
                        </p>
                    </div>
                )}

                {stops
                    ?.filter((stop) => (isSelectingReminder ? !getStopStatus(stop).passed : true))
                    .map((stop, index) => {
                        const { isCurrentStop, isNextStop, passed } = getStopStatus(stop)
                        const stopTime = getStopTime(stop.id)
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

                        const delayLabel =
                            delay > 0
                                ? `Late: ${delay}min`
                                : delay < 0
                                    ? `Early: ${Math.abs(delay)}min`
                                    : ""

                        return (
                            <div key={`${stop.id}-${stop.platform}`} className="relative">
                                {/* --- Vehicle Position Indicator --- */}
                                {vehiclePosition?.showAtStop &&
                                    vehiclePosition.currentStopIndex === index && (
                                        <div className="absolute -left-1 sm:-left-2 top-1/2 -translate-y-1/2 z-10">
                                            <div className="flex items-center gap-1 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-medium shadow-lg">
                                                <Train className="w-3 h-3" />
                                                <span className="hidden sm:inline">Here</span>
                                            </div>
                                        </div>
                                    )}

                                {vehiclePosition?.showBetweenStops &&
                                    vehiclePosition.currentStopIndex === index &&
                                    !isLast && (
                                        <div className="absolute left-[9px] sm:left-[11px] bottom-[-16px] z-10">
                                            <div className="bg-blue-500 text-white p-1.5 rounded-full shadow-lg animate-pulse">
                                                <Train className="w-3 h-3" />
                                            </div>
                                        </div>
                                    )}

                                {/* --- Stop Card --- */}
                                <div
                                    ref={isNextStop ? nextStopRef : null}
                                    onClick={() => canSelect && handleStopSelection(stop)}
                                    className={`relative flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 min-h-[60px] ${isCurrentStop
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

                                                    <span className="flex items-center gap-1">
                                                        <Waypoints className="w-3 h-3" />
                                                        Distance {formatDistance(distance)}
                                                    </span>

                                                    {(arrivalTime || departureTime) && (
                                                        <span className="flex items-center gap-1">
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

                                                    {delay !== 0 && (
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
                                                {isCurrentStop && vehicle && (
                                                    <Badge variant="secondary" className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300">
                                                        {vehicle.state === "Arrived" ? "Now" : "Prev"}
                                                    </Badge>
                                                )}
                                                {isNextStop && (
                                                    <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                                        Next
                                                    </Badge>
                                                )}
                                                {stopTime?.skipped && (
                                                    <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                                        <AlertTriangle className="w-3 h-3 mr-0.5" />
                                                        <span className="hidden sm:inline">Skipped</span>
                                                        <span className="sm:hidden">Skip</span>
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

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
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

                <Button
                    onClick={() => toggleReminder("arrival")}
                    className={`${!isSelectingReminder ? "border border-transparent" : ""} flex-1`}
                    variant={isSelectingReminder && reminderType === "arrival" ? "outline" : "secondary"}
                >
                    {isSelectingReminder && reminderType === "arrival" ? (
                        <>
                            <X className="w-4 h-4 mr-2" />
                            Cancel Selection
                        </>
                    ) : (
                        <>
                            <Navigation className="w-4 h-4 mr-2" />
                            Remind me when it&apos;s arriving
                        </>
                    )}
                </Button>
            </div>
        </>
    )
}
