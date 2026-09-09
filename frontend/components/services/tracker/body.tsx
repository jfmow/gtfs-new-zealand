import { memo, useEffect, useState } from "react"
import { formatUnixTime } from "@/lib/formating"
import StopsList from "./stops-list"
import TrackerMap from "./tracker-map"
import { TrackerSummaryCard } from "./summary-card"
import { useServiceTrackerContext } from "./use-service-tracker"
import { shareTrip } from "./helpers"
import { ApiFetch } from "@/lib/url-context"
import { TriangleAlertIcon, Loader2, MapPinIcon, FlagIcon, Navigation2, Share2, X, CalendarClockIcon, RadioIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, fullyEncodeURIComponent } from "@/lib/utils"
import type { AlertResponseData } from "@/lib/alert-causes"
import RouteNotifications from "@/components/notifications/route-notifications"
import { BellIcon } from "lucide-react"

type RouteAlert = AlertResponseData

const ServiceTrackerContent = memo(function ServiceTrackerContent() {
    const { vehicle, stops, stopTimes, previewData, tripId, tripUpdateTracking, refreshing, hideMap, stopsLayout } = useServiceTrackerContext()

    // On a full-screen page the inline map fills more of the view; docked/inset it
    // sits in a compact slot above the stop list.
    const mapHeight = stopsLayout === "page" ? "min(58vh, 560px)" : "320px"

    const activeRouteId = vehicle?.route.id || previewData?.route_id
    const [routeAlerts, setRouteAlerts] = useState<RouteAlert[]>([])
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (!activeRouteId) {
            setRouteAlerts([])
            return
        }
        let cancelled = false
        ApiFetch<RouteAlert[]>(`realtime/alerts/route/${fullyEncodeURIComponent(activeRouteId)}`, { method: "GET" }).then((res) => {
            if (cancelled) return
            setRouteAlerts(res.ok ? res.data : [])
        })
        return () => {
            cancelled = true
        }
    }, [activeRouteId])

    const visibleAlerts = routeAlerts.filter((alert) => !dismissedAlerts.has(alert.title))
    const dismissAlert = (title: string) => setDismissedAlerts((prev) => new Set(prev).add(title))

    const handleShare = () => shareTrip(tripId, vehicle)

    // Vehicle tracking mode
    if (vehicle) {
        const isAtStop = vehicle.state === "AtStop";
        const isUnknown = vehicle.state === "Unknown"

        const stopStatusTitle = isAtStop
            ? "Current Stop"
            : isUnknown
                ? "Upcoming/Previous"
                : "Next";

        const stopStatusName = isAtStop
            ? vehicle.trip.current_stop.name
            : vehicle.trip.next_stop.name;

        const stopStatusPlatform = isAtStop
            ? vehicle.trip.current_stop.platform
            : vehicle.trip.next_stop.platform;


        const stopStatusVariant = isAtStop
            ? "current"
            : isUnknown
                ? "default"
                : "next";

        const stopStatusArrivalTime =
            tripId && stopTimes
                ? formatUnixTime(
                    stopTimes.find(
                        (stop) => isAtStop ? stop.parent_stop_id === vehicle.trip.current_stop.parent_stop_id : stop.parent_stop_id === vehicle.trip.next_stop.parent_stop_id
                    )?.arrival_time || 0
                )
                : "";

        return (
            <div className="space-y-3">
                <div>
                    <RouteAlertsBanner alerts={visibleAlerts} onDismiss={dismissAlert} routeId={activeRouteId} />

                    {vehicle.state === "Unknown" && <TrackingNotice level="limited" hasVehicle />}

                    {vehicle.off_course && (
                        <Card className="border-destructive bg-destructive/5 mb-4">
                            <CardContent className="flex items-center gap-2 p-3 sm:p-4">
                                <TriangleAlertIcon className="h-4 w-4 sm:h-5 sm:w-5 text-destructive flex-shrink-0" />
                                <p className="text-sm font-medium text-destructive">Vehicle off course</p>
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex items-center justify-between gap-3 overflow-hidden">
                        <div className="flex items-center w-full flex-nowrap gap-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span
                                    aria-label="Service route name"
                                    className="shrink-0 px-2 py-1 rounded text-white dark:text-gray-100 text-xs font-medium"
                                    style={{
                                        background: "#" + (vehicle.route.color !== "" ? vehicle.route.color : "000000"),
                                        filter: "brightness(0.9) contrast(1.1)",
                                    }}
                                >
                                    {vehicle.route.name}
                                </span>
                            </div>
                            <h1 className="text-lg sm:text-xl font-display font-bold text-foreground leading-tight">
                                {vehicle.trip.headsign}
                            </h1>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {refreshing && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Share this trip"
                                onClick={handleShare}
                            >
                                <Share2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:gap-4">
                        <TrackerSummaryCard />
                        <StopStatusCard
                            title={stopStatusTitle}
                            stopName={stopStatusName}
                            platform={stopStatusPlatform}
                            variant={stopStatusVariant}
                            arrivalTime={stopStatusArrivalTime}
                        />
                    </div>

                </div>

                {!hideMap && <TrackerMap height={mapHeight} />}

                <StopsList layout={stopsLayout} tripId={tripId} stops={stops} vehicle={vehicle} stopTimes={stopTimes} routeShortName={vehicle?.route.name ?? previewData?.route_name} />
            </div>
        )
    }

    // Preview mode
    if (!vehicle && previewData && stops) {
        const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence)

        return (
            <div className="space-y-3 relative">
                <div>
                    <RouteAlertsBanner alerts={visibleAlerts} onDismiss={dismissAlert} routeId={activeRouteId} />

                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center w-full flex-nowrap gap-3 mb-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <span
                                        aria-label="Service route name"
                                        className="shrink-0 px-2 py-1 rounded text-white dark:text-gray-100 text-xs font-medium"
                                        style={{
                                            background: "#" + (previewData.route_color !== "" ? previewData.route_color : "000000"),
                                            filter: "brightness(0.9) contrast(1.1)",
                                        }}
                                    >
                                        {previewData.route_name}
                                    </span>
                                </div>
                                <h1 className="text-lg sm:text-xl font-display font-bold text-foreground leading-tight">
                                    {previewData.tripHeadsign}
                                </h1>
                            </div>
                            <TrackingNotice level={tripUpdateTracking ? "limited" : "scheduled"} />
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex flex-wrap gap-1 items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1 text-sm">
                                                <span className="font-medium">Stops:</span>
                                                <span>{stops.length}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1 text-sm">
                                                <MapPinIcon className="h-4 w-4 text-green-600" />
                                                <span className="font-medium">From:</span>
                                                <span>{sortedStops[0].name}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1 text-sm">
                                                <FlagIcon className="h-4 w-4 text-red-600" />
                                                <span className="font-medium">To:</span>
                                                <span>{sortedStops[sortedStops.length - 1].name}</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                </div>

                {!hideMap && <TrackerMap height={mapHeight} />}

                <StopsList layout={stopsLayout} tripId={tripId} stops={stops} stopTimes={stopTimes} routeShortName={previewData?.route_name} />
            </div>
        )
    }

    return null
})

export default ServiceTrackerContent


function TrackingNotice({
    level,
    hasVehicle = false,
}: {
    level: "scheduled" | "limited"
    /** In "limited" mode: true when a vehicle position exists but is stale/unreliable, false when there's no position at all. */
    hasVehicle?: boolean
}) {
    const scheduled = level === "scheduled"
    const limitedText = hasVehicle
        ? "We're getting arrival updates for this trip, but its live position is unreliable right now — the map may be approximate."
        : "Arrival times below are live predictions for this trip. There's no vehicle position, so the map shows the route only."
    return (
        <div
            className={cn(
                "mb-4 flex items-start gap-2.5 rounded-lg border p-3",
                scheduled
                    ? "border-border bg-muted/50"
                    : "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40",
            )}
        >
            {scheduled ? (
                <CalendarClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
                <RadioIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="text-sm">
                <p
                    className={cn(
                        "font-medium",
                        scheduled ? "text-foreground" : "text-amber-800 dark:text-amber-200",
                    )}
                >
                    {scheduled ? "Timetable only" : "Limited tracking"}
                </p>
                <p className={scheduled ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300/90"}>
                    {scheduled
                        ? "This service isn't reporting its position. Times below come from the schedule, not a live vehicle."
                        : limitedText}
                </p>
            </div>
        </div>
    )
}

const RouteAlertsBanner = memo(function RouteAlertsBanner({
    alerts,
    onDismiss,
    routeId,
}: {
    alerts: RouteAlert[]
    onDismiss: (title: string) => void
    routeId?: string
}) {
    if (alerts.length === 0) return null

    const renderAlert = (alert: RouteAlert) => (
        <Card key={alert.title} className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="flex items-start gap-2 p-3 sm:p-4">
                <TriangleAlertIcon className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{alert.title}</p>
                    {alert.description && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-3">{alert.description}</p>
                    )}
                </div>
                <button
                    onClick={() => onDismiss(alert.title)}
                    aria-label="Dismiss alert"
                    className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 flex-shrink-0"
                >
                    <X className="h-4 w-4" />
                </button>
            </CardContent>
        </Card>
    )

    const notifyMeRow = routeId ? (
        <RouteNotifications routeId={routeId}>
            <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
            >
                <span>Notify me about route {routeId}</span>
                <BellIcon className="h-3 w-3 text-muted-foreground" />
            </button>
        </RouteNotifications>
    ) : null

    if (alerts.length === 1) {
        return (
            <div className="mb-4 space-y-1.5">
                {renderAlert(alerts[0])}
                {notifyMeRow}
            </div>
        )
    }

    return (
        <div className="mb-4">
            <Popover>
                <PopoverTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900">
                        <TriangleAlertIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        {alerts.length} alerts on this route
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(24rem,90vw)] max-h-80 overflow-y-auto overscroll-contain space-y-2 p-2">
                    {alerts.map(renderAlert)}
                    {notifyMeRow}
                </PopoverContent>
            </Popover>
        </div>
    )
})

const StopStatusCard = memo(function StopStatusCard({
    title,
    stopName,
    arrivalTime,
    variant = "default",
}: {
    title: string
    stopName: string
    platform?: string
    arrivalTime?: string
    variant?: "current" | "next" | "final" | "default"
    isArrived?: boolean
}) {
    const getVariantStyles = () => {
        switch (variant) {
            case "current":
                return "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950"
            case "next":
                return "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
            case "final":
                return "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
            default:
                return "border-border bg-card"
        }
    }

    const getIconColor = () => {
        switch (variant) {
            case "current":
                return "text-orange-600 dark:text-orange-400"
            case "next":
                return "text-blue-600 dark:text-blue-400"
            case "final":
                return "text-red-600 dark:text-red-400"
            default:
                return "text-muted-foreground"
        }
    }

    const getTitleColor = () => {
        switch (variant) {
            case "current":
                return "text-orange-700 dark:text-orange-300"
            case "next":
                return "text-blue-700 dark:text-blue-300"
            case "final":
                return "text-red-700 dark:text-red-300"
            default:
                return "text-foreground"
        }
    }

    return (
        <Card className={`${getVariantStyles()} overflow-hidden transition-colors`}>
            <CardContent className="p-3">
                <div className="flex items-start gap-2">
                    <div className={`${getIconColor()} mt-0.5 flex-shrink-0`}>
                        {variant === "final" ? <FlagIcon className="h-4 w-4" /> : variant === "current" ? <MapPinIcon className="h-4 w-4" /> : <Navigation2 className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <p className={`text-xs font-medium ${getTitleColor()}`}>{title.replace(":", "")}</p>
                            {arrivalTime && (
                                <p className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">
                                    {arrivalTime}
                                </p>
                            )}
                        </div>
                        <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{stopName}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
})
