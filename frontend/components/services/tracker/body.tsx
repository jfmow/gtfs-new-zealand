import { lazy, memo, Suspense, useRef, useEffect, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LoadingSpinner from "../../loading-spinner"
import { formatUnixTime, timeTillArrivalMsString } from "@/lib/formating"
import StopsList from "./stops-list"
import RaceTheBus from "./race-the-bus"
import { useServiceTrackerContext, useRouteLine } from "./use-service-tracker"
import type { MapItem } from "@/components/map/markers/create"
import type { LatLng } from "../../map/map"
import { ApiFetch } from "@/lib/url-context"
import { TriangleAlertIcon, Loader2, MapPinIcon, FlagIcon, Navigation2, Share2, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { getRegionSlug, urlStore } from "@/lib/url-store"
import { toast } from "sonner"
import type { AlertResponseData } from "@/lib/alert-causes"
import RouteNotifications from "@/components/notifications/route-notifications"
import { BellIcon } from "lucide-react"

const LeafletMap = lazy(() => import("../../map/map"))

const VehicleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-bus-front-icon lucide-bus-front"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>`

type RouteAlert = AlertResponseData

const ServiceTrackerContent = memo(function ServiceTrackerContent() {
    const { vehicle, stops, stopTimes, previewData, tripId, currentStop, refreshing, hideMap } = useServiceTrackerContext()
    const nextStopRef = useRef<HTMLLIElement>(null)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const [tabValue, setTabValue] = useState(hideMap ? "stops" : "track")

    // Auto-scroll to next stop when it changes or when switching to stops tab
    useEffect(() => {
        if (tabValue === "stops" && nextStopRef.current && scrollAreaRef.current) {
            // Small delay to ensure the tab content is rendered
            const timeoutId = setTimeout(() => {
                nextStopRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "nearest",
                })
            }, 100)
            return () => clearTimeout(timeoutId)
        }
    }, [tabValue, vehicle?.trip.next_stop.parent_stop_id, vehicle?.trip.next_stop.platform])

    const routeLine = useRouteLine(tripId, vehicle?.route.id)

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

    const handleShare = async () => {
        const region = getRegionSlug(urlStore.currentUrl)
        const url = `${window.location.origin}/trip?tripId=${fullyEncodeURIComponent(tripId)}&region=${region}`
        if (navigator.share) {
            try {
                await navigator.share({ title: vehicle ? `${vehicle.route.name} - ${vehicle.trip.headsign}` : "Track this trip", url })
            } catch {
                // user dismissed the share sheet - not an error
            }
        } else {
            try {
                await navigator.clipboard.writeText(url)
                toast.success("Link copied to clipboard")
            } catch {
                toast.error("Couldn't copy link - clipboard access was denied")
            }
        }
    }

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

        const currentStopArrivalMs = currentStop
            ? stopTimes?.find((st) => st.parent_stop_id === currentStop.id || st.child_stop_id === currentStop.id)?.arrival_time
            : undefined

        // Live "N stops away" readout, counted from the rider's own stop (only
        // known when this tracker was opened from that stop's departure board)
        // while the vehicle is confirmed en route - not yet, or already past, at it.
        const currentStopSeq = currentStop
            ? stopTimes?.find((st) => st.parent_stop_id === currentStop.id || st.child_stop_id === currentStop.id)?.stop.sequence
            : undefined
        const stopsAway =
            (vehicle.state === "Arriving" || vehicle.state === "Travelling") && currentStopSeq !== undefined
                ? Math.max(0, currentStopSeq - vehicle.trip.next_stop.sequence)
                : undefined

        return (
            <div className="space-y-3">
                <div>
                    <RouteAlertsBanner alerts={visibleAlerts} onDismiss={dismissAlert} routeId={activeRouteId} />

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
                            <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground leading-tight">
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

                    <div className="grid gap-3 sm:gap-4 mt-4">
                        <StopStatusCard
                            title={stopStatusTitle}
                            stopName={stopStatusName}
                            platform={stopStatusPlatform}
                            variant={stopStatusVariant}
                            arrivalTime={stopStatusArrivalTime}
                            stopsAway={stopsAway}
                        />
                    </div>

                    {currentStop && (
                        <div className="mt-4">
                            <RaceTheBus currentStop={currentStop} vehicleArrivalMs={currentStopArrivalMs} />
                        </div>
                    )}
                </div>

                {hideMap ? (
                    <StopsList tripId={tripId} stops={stops} vehicle={vehicle} stopTimes={stopTimes} routeShortName={vehicle?.route.name ?? previewData?.route_name} />
                ) : (
                    <Tabs onValueChange={setTabValue} defaultValue="track" className="w-full">
                        <TabsList className="w-full">
                            <TabsTrigger disabled={stops?.length === 0} className="w-full" value="stops">
                                Stops
                            </TabsTrigger>
                            <TabsTrigger className="w-full" value="track">
                                Track
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="track">
                            <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                <LeafletMap
                                    defaultZoom={
                                        currentStop
                                            ? [
                                                [vehicle.position.lat, vehicle.position.lon],
                                                [currentStop.lat, currentStop.lon],
                                            ]
                                            : [[vehicle.position.lat, vehicle.position.lon]]
                                    }
                                    line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                                    mapItems={
                                        stops
                                            ? [
                                                ...stops.map(
                                                    (stop) => {
                                                        const stopTime = stopTimes?.find(
                                                            (st) => st.parent_stop_id === stop.parent_stop_id || st.child_stop_id === stop.child_stop_id
                                                        )
                                                        return ({
                                                            lat: stop.lat,
                                                            lon: stop.lon,
                                                            icon: vehicle.trip.next_stop.parent_stop_id === stop.parent_stop_id || vehicle.trip.next_stop.child_stop_id === stop.child_stop_id
                                                                ? "next stop marker"
                                                                : currentStop?.name === stop.name
                                                                    ? "marked stop marker"
                                                                    : vehicle.trip.final_stop.parent_stop_id === stop.parent_stop_id || vehicle.trip.final_stop.child_stop_id === stop.child_stop_id
                                                                        ? "end marker"
                                                                        : vehicle.trip.next_stop.parent_stop_id === stop.parent_stop_id || vehicle.trip.next_stop.child_stop_id === stop.child_stop_id
                                                                            ? "next stop marker"
                                                                            : stop.parent_stop_id === vehicle.trip.current_stop.parent_stop_id || stop.child_stop_id === vehicle.trip.current_stop.child_stop_id
                                                                                ? "current stop marker"
                                                                                : stop.parent_stop_id === vehicle.trip.first_stop.parent_stop_id ? "start marker" : vehicle.trip.current_stop.sequence > stop.sequence
                                                                                    ? "dot gray"
                                                                                    : "dot",
                                                            id: stop.name,
                                                            routeID: "",
                                                            type: "stop",
                                                            zIndex: 1,
                                                            onClick: () => { },
                                                            popup: {
                                                                title: `${stop.name} ${stop.platform ? `| Platform ${stop.platform}` : ""}`,
                                                                subtitle: stopTime ? timeTillArrivalMsString(stopTime.arrival_time) : undefined,
                                                                linkText: "View departures",
                                                                linkHref: `/?s=${encodeURIComponent(stop.name)}`,
                                                            },
                                                        }) as MapItem
                                                    },
                                                ),
                                                {
                                                    lat: vehicle.position.lat,
                                                    lon: vehicle.position.lon,
                                                    icon: (vehicle.type === "bus" || vehicle.type === "train" || vehicle.type === "ferry") ? vehicle.type : "bus",
                                                    bearing: vehicle.position.bearing,
                                                    id: vehicle.trip_id,
                                                    routeID: vehicle.route.id,
                                                    zIndex: 1,
                                                    type: "vehicle",
                                                    onClick: () => { },
                                                    zoomButton: VehicleIcon,
                                                },
                                            ]
                                            : [
                                                {
                                                    lat: vehicle.position.lat,
                                                    lon: vehicle.position.lon,
                                                    icon: (vehicle.type === "bus" || vehicle.type === "train" || vehicle.type === "ferry") ? vehicle.type : "bus",
                                                    bearing: vehicle.position.bearing,
                                                    id: vehicle.trip_id,
                                                    routeID: vehicle.route.id,
                                                    zIndex: 1,
                                                    type: "vehicle",
                                                    onClick: () => { },
                                                    zoomButton: VehicleIcon,
                                                },
                                            ]
                                    }
                                    map_id={"tracker" + Math.random()}
                                    height={"300px"}
                                />
                            </Suspense>
                        </TabsContent>

                        <TabsContent value="stops">
                            <StopsList tripId={tripId} stops={stops} vehicle={vehicle} stopTimes={stopTimes} routeShortName={vehicle?.route.name ?? previewData?.route_name} />
                        </TabsContent>
                    </Tabs>
                )}
            </div >
        )
    }

    function getBoundsFromStops(stops: { lat: number; lon: number; sequence: number }[]): [LatLng, LatLng] {
        if (!Array.isArray(stops) || stops.length === 0) {
            throw new Error("Stops array is empty or invalid.");
        }


        let minLat = stops[0].lat;
        let maxLat = stops[0].lat;
        let minLng = stops[0].lon;
        let maxLng = stops[0].lon;

        for (const stop of stops) {
            if (stop.lat < minLat) minLat = stop.lat;
            if (stop.lat > maxLat) maxLat = stop.lat;
            if (stop.lon < minLng) minLng = stop.lon;
            if (stop.lon > maxLng) maxLng = stop.lon;
        }

        const mapBounds: [LatLng, LatLng] = [
            [minLat, minLng], // southwest corner
            [maxLat, maxLng], // northeast corner
        ];

        return mapBounds;
    }

    // Preview mode
    if (!vehicle && previewData && stops) {
        const sortedStops = stops.sort((a, b) => a.sequence - b.sequence)
        const mapBounds = getBoundsFromStops(sortedStops);

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
                                <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground leading-tight">
                                    {previewData.tripHeadsign}
                                </h1>
                            </div>
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

                {hideMap ? (
                    <StopsList tripId={tripId} stops={stops} stopTimes={stopTimes} routeShortName={previewData?.route_name} />
                ) : (
                    <Tabs defaultValue="track" className="w-full">
                        <TabsList className="w-full">
                            <TabsTrigger className="w-full" value="stops">
                                Stops
                            </TabsTrigger>
                            <TabsTrigger className="w-full" value="track">
                                Track
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="track">
                            <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                <LeafletMap
                                    defaultZoom={mapBounds}
                                    line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                                    mapItems={stops.map(
                                        (item, index) => {
                                            const stopTime = stopTimes?.find(
                                                (st) => st.parent_stop_id === item.parent_stop_id || st.child_stop_id === item.child_stop_id
                                            )
                                            return ({
                                                lat: item.lat,
                                                lon: item.lon,
                                                icon: index === stops.length - 1 ? "end marker" : "dot",
                                                id: item.name,
                                                routeID: "",
                                                zIndex: 1,
                                                type: "stop",
                                                onClick: () => { },
                                                popup: {
                                                    title: item.name,
                                                    subtitle: stopTime ? timeTillArrivalMsString(stopTime.arrival_time) : undefined,
                                                    linkText: "View departures",
                                                    linkHref: `/?s=${encodeURIComponent(item.name)}`,
                                                },
                                            }) as MapItem
                                        },
                                    )}
                                    map_id={"tracker preview" + Math.random()}
                                    height={"300px"}
                                />
                            </Suspense>
                        </TabsContent>

                        <TabsContent value="stops">
                            <StopsList tripId={tripId} stops={stops} stopTimes={stopTimes} routeShortName={previewData?.route_name} />
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        )
    }

    return null
})

export default ServiceTrackerContent


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
    stopsAway,
}: {
    title: string
    stopName: string
    platform?: string
    arrivalTime?: string
    variant?: "current" | "next" | "final" | "default"
    isArrived?: boolean
    /** Live count of stops until the rider's own stop - shown while the vehicle is confirmed en route. */
    stopsAway?: number
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
        <Card className={`${getVariantStyles()} transition-colors overflow-hidden`}>
            <CardContent className="p-3 overflow-hidden">
                <div className="flex items-center gap-1">
                    <div className={`${getIconColor()} flex-shrink-0`}>
                        {variant === "final" ? <FlagIcon className="h-4 w-4" /> : variant === "current" ? <MapPinIcon className="h-4 w-4" /> : <Navigation2 className="h-4 w-4" />}
                    </div>
                    <div className="flex flex-nowrap gap-1 w-full items-center overflow-hidden">
                        <p className={`text-xs text-nowrap font-medium ${getTitleColor()}`}>{title.replace(":", "")}:</p>
                        <p className="text-xs font-semibold text-foreground truncate">{stopName}</p>
                        {arrivalTime && (
                            <p className="text-xs font-mono tabular-nums font-semibold text-foreground text-nowrap">@ {arrivalTime}</p>
                        )}
                        {stopsAway !== undefined && stopsAway > 0 && (
                            <p className="text-xs text-muted-foreground text-nowrap">
                                <span className="text-foreground font-medium">{stopsAway}</span> {stopsAway === 1 ? "stop" : "stops"} away
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
})
