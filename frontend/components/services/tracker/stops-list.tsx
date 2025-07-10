import { useRef, useEffect, useState } from "react"
import { MapPin, Clock, AlertTriangle, Train, Waypoints, Bell, X, Navigation } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import type { ServicesStop, StopTimes, VehiclesResponse } from "."
import { formatDistance } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import notification from "@/lib/notifications"
import { toast } from "sonner"

interface StopsListProps {
    stops: ServicesStop[] | null
    vehicle?: VehiclesResponse
    stopTimes?: StopTimes[] | null
    tripId?: string
}

export default function StopsList({ stops, vehicle, stopTimes, tripId }: StopsListProps) {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const nextStopRef = useRef<HTMLDivElement>(null)
    const [isSelectingReminder, setIsSelectingReminder] = useState(false)
    const [reminderType, setReminderType] = useState<"get_off" | "arrival" | null>(null)

    useEffect(() => {
        // Don't auto-scroll when user is selecting a reminder stop
        if (isSelectingReminder) return

        if (nextStopRef.current && scrollAreaRef.current && vehicle && vehicle.trip.next_stop.id) {
            // Only scroll if the next stop is actually ahead (not a past stop)
            const nextStopSequence = vehicle.trip.next_stop.sequence
            const currentStopSequence = vehicle.trip.current_stop.sequence

            // Only scroll if next stop sequence is greater than or equal to current stop sequence
            if (nextStopSequence >= currentStopSequence) {
                nextStopRef.current.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                })
            }
        }
    }, [vehicle, isSelectingReminder])

    const formatUnixTime = (unixTime: number | null | undefined) => {
        if (!unixTime) return null
        try {
            return format(new Date(unixTime), "h:mm a")
        } catch {
            return null
        }
    }

    const getStopStatus = (stop: ServicesStop) => {
        if (!vehicle) {
            return { isCurrentStop: false, isNextStop: false, passed: false }
        }

        const isCurrentStop =
            vehicle.trip.current_stop.id === stop.id && stop.platform === vehicle.trip.current_stop.platform

        const isNextStop =
            vehicle.trip.next_stop.id === stop.id && vehicle.trip.next_stop.platform === stop.platform && !isCurrentStop

        const passed = vehicle.trip.current_stop.sequence > stop.sequence

        return { isCurrentStop, isNextStop, passed }
    }

    const getStopTime = (stopId: string) => {
        return stopTimes?.find((st) => st.stop_id === stopId)
    }

    const getVehiclePosition = () => {
        if (!stops || !vehicle) return null

        // Use the filtered stops array when in selection mode
        const stopsToUse = isSelectingReminder
            ? stops.filter((stop) => {
                const { passed } = getStopStatus(stop)
                return !passed
            })
            : stops

        const currentStopIndex = stopsToUse.findIndex(
            (stop) => stop.id === vehicle.trip.current_stop.id && stop.platform === vehicle.trip.current_stop.platform,
        )

        if (currentStopIndex === -1) return null

        return {
            currentStopIndex,
            showAtStop: vehicle.state === "Arrived",
            showBetweenStops: vehicle.state === "Departed" && currentStopIndex < stopsToUse.length - 1,
        }
    }

    const handleStopSelection = async (stop: ServicesStop) => {
        if (!isSelectingReminder || !tripId || !reminderType) return

        const ok = await notification.addReminder(stop.name, tripId, reminderType)
        if (ok) {
            const message =
                reminderType === "get_off"
                    ? "Reminder added! You'll get a notification when your stop is next"
                    : "Arrival reminder set! You'll get a notification when approaching this stop"
            toast.success(message, {
                duration: 8000,
            })
        } else {
            toast.error("Failed to add reminder")
        }
        setIsSelectingReminder(false)
        setReminderType(null)
    }

    const handleReminderClick = () => {
        if (isSelectingReminder && reminderType === "get_off") {
            setIsSelectingReminder(false)
            setReminderType(null)
        } else {
            setIsSelectingReminder(true)
            setReminderType("get_off")
        }
    }

    const handleArrivalReminder = () => {
        if (isSelectingReminder && reminderType === "arrival") {
            setIsSelectingReminder(false)
            setReminderType(null)
        } else {
            setIsSelectingReminder(true)
            setReminderType("arrival")
        }
    }

    const vehiclePosition = getVehiclePosition()

    return (
        <>
            <div ref={scrollAreaRef} className="max-h-[300px] overflow-y-auto space-y-1 p-2 sm:p-4 relative">
                {isSelectingReminder && (
                    <div className="sticky top-0 z-20 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                        <p className="text-sm text-blue-700 font-medium">
                            {reminderType === "get_off"
                                ? "Select a stop to be reminded when it's time to get off"
                                : "Select a stop to be reminded when the vehicle is arriving"}
                        </p>
                    </div>
                )}

                {stops
                    ?.filter((stop) => {
                        // When selecting reminder, only show current and future stops
                        if (isSelectingReminder) {
                            const { passed } = getStopStatus(stop)
                            return !passed
                        }
                        // When not selecting, show all stops
                        return true
                    })
                    ?.map((stop, index) => {
                        const { isCurrentStop, isNextStop, passed } = getStopStatus(stop)
                        const stopTime = getStopTime(stop.id)
                        const distance = stopTime?.dist || 0
                        const isLast = index === stops.length - 1
                        const arrivalTime = formatUnixTime(stopTime?.arrival_time)
                        const departureTime = formatUnixTime(stopTime?.departure_time)
                        const canSelectForReminder = isSelectingReminder && !passed && !isCurrentStop

                        let delay = 0
                        if (stopTime?.arrival_time && stopTime?.scheduled_time) {
                            delay = Math.round((stopTime.arrival_time - stopTime.scheduled_time) / 60 / 1000)
                        }

                        let delayLabel = ""
                        if (delay > 0) {
                            delayLabel = `Late: ${delay}min`
                        } else if (delay < 0) {
                            delayLabel = `Early: ${Math.abs(delay)}min`
                        }

                        return (
                            <div key={`${stop.id}-${stop.platform}`} className="relative">
                                {/* Vehicle Position Indicator - At Stop */}
                                {vehiclePosition?.showAtStop && vehiclePosition.currentStopIndex === index && (
                                    <div className="absolute -left-1 sm:-left-2 top-1/2 -translate-y-1/2 z-10">
                                        <div className="flex items-center gap-1 bg-green-500 text-white px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium shadow-lg">
                                            <Train className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                            <span className="hidden sm:inline">Here</span>
                                        </div>
                                    </div>
                                )}

                                {/* Vehicle Position Indicator - Between Stops */}
                                {vehiclePosition?.showBetweenStops && vehiclePosition.currentStopIndex === index && !isLast && (
                                    <div className="absolute left-[9px] sm:left-[11px] bottom-[-12px] sm:bottom-[-16px] z-10">
                                        <div className="flex items-center justify-center">
                                            <div className="bg-blue-500 text-white p-1 sm:p-1.5 rounded-full shadow-lg animate-pulse">
                                                <Train className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Stop Item */}
                                <div
                                    ref={isNextStop ? nextStopRef : null}
                                    onClick={() => handleStopSelection(stop)}
                                    className={`
                  relative flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border 
                  transition-all duration-200 min-h-[60px] sm:min-h-auto
                  ${isCurrentStop
                                            ? "bg-orange-50 border-orange-200 shadow-sm"
                                            : isNextStop
                                                ? "bg-blue-50 border-blue-200 shadow-sm ring-1 sm:ring-2 ring-blue-100"
                                                : passed
                                                    ? "bg-gray-50 border-gray-200"
                                                    : "bg-white border-gray-200 active:bg-gray-50"
                                        }
                  ${canSelectForReminder
                                            ? "cursor-pointer hover:bg-green-50 hover:border-green-200 hover:shadow-md"
                                            : ""
                                        }
                `}
                                >
                                    {/* Status Indicator */}
                                    <div className="flex flex-col items-center mt-1 sm:mt-1">
                                        <div
                                            className={`
                      w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 transition-colors flex-shrink-0
                      ${isCurrentStop
                                                    ? "bg-orange-400 border-orange-400"
                                                    : isNextStop
                                                        ? "bg-blue-400 border-blue-400 animate-pulse"
                                                        : passed
                                                            ? "bg-gray-300 border-gray-300"
                                                            : canSelectForReminder
                                                                ? "bg-green-100 border-green-400"
                                                                : "bg-white border-gray-300"
                                                }
                    `}
                                        />
                                        {!isLast && (
                                            <div
                                                className={`
                        w-0.5 h-6 sm:h-8 mt-1 transition-colors relative
                        ${isCurrentStop || (passed && vehicle && index < vehicle.trip.current_stop.sequence)
                                                        ? "bg-gray-300"
                                                        : "bg-gray-200"
                                                    }
                      `}
                                            />
                                        )}
                                    </div>

                                    {/* Stop Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <h3
                                                    className={`
                          font-medium text-sm sm:text-base leading-tight
                          ${isCurrentStop
                                                            ? "text-orange-700"
                                                            : isNextStop
                                                                ? "text-blue-700"
                                                                : passed
                                                                    ? "text-gray-500"
                                                                    : canSelectForReminder
                                                                        ? "text-green-700"
                                                                        : "text-gray-900"
                                                        }
                        `}
                                                >
                                                    {stop.name}
                                                    {canSelectForReminder && (
                                                        <span className="ml-2 text-xs text-green-600 font-normal">(Click to select)</span>
                                                    )}
                                                </h3>

                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-0.5">
                                                    {stop.platform && (
                                                        <p className="text-xs text-gray-600 flex items-center gap-1">
                                                            <MapPin className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                                            Platform {stop.platform}
                                                        </p>
                                                    )}

                                                    <p className="text-xs text-gray-600 flex items-center gap-1">
                                                        <Waypoints className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                                        Distance {formatDistance(distance)}
                                                    </p>

                                                    {/* Time Information - Mobile Optimized */}
                                                    {(arrivalTime || departureTime) && (
                                                        <div className="flex items-center gap-1 text-xs text-gray-600">
                                                            <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                                            <div className="flex items-center gap-1">
                                                                {arrivalTime && <span>{arrivalTime}</span>}
                                                                {departureTime && arrivalTime !== departureTime && (
                                                                    <>
                                                                        <span className="text-gray-400">→</span>
                                                                        <span>{departureTime}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {delay ? (
                                                        <Badge
                                                            variant="secondary"
                                                            className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 w-fit"
                                                        >
                                                            {delayLabel}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                            </div>

                                            {/* Status Badges - Mobile Optimized */}
                                            <div className="flex flex-col gap-1 items-end flex-shrink-0">
                                                {isCurrentStop && vehicle && (
                                                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5">
                                                        {vehicle.state === "Arrived" ? "Now" : "Prev"}
                                                    </Badge>
                                                )}

                                                {isNextStop && (
                                                    <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5">
                                                        Next
                                                    </Badge>
                                                )}

                                                {stopTime?.skipped && (
                                                    <Badge variant="outline" className="text-yellow-600 border-yellow-300 text-xs px-1.5 py-0.5">
                                                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
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

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <Button
                    onClick={handleReminderClick}
                    className="flex-1"
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
                    onClick={handleArrivalReminder}
                    className="flex-1"
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
