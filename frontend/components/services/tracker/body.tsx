import { lazy, memo, Suspense, useRef, useEffect, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LoadingSpinner from "../../loading-spinner"
import { formatTextToNiceLookingWords, formatUnixTime } from "@/lib/formating"
import type { VehiclesResponse, PreviewData, ServicesStop, StopTimes } from "."
import StopsList from "./stops-list"
import type { MapItem } from "@/components/map/markers/create"
import type { LatLng } from "../../map/map"
import type { ShapesResponse, GeoJSON } from "@/components/map/geojson-types"
import { ApiFetch } from "@/lib/url-context"
import { TriangleAlertIcon, Loader2, MapPinIcon, FlagIcon, ClockIcon, Navigation2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { fullyEncodeURIComponent } from "@/lib/utils"

const LeafletMap = lazy(() => import("../../map/map"))

const VehicleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-bus-front-icon lucide-bus-front"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>`

interface ServiceTrackerContentProps {
    vehicle?: VehiclesResponse
    stops: ServicesStop[] | null
    stopTimes: StopTimes[] | null
    previewData?: PreviewData
    has: boolean
    tripId: string
    currentStop?: {
        id: string
        lat: number
        lon: number
        name: string
    }
    refreshing: boolean
}



const ServiceTrackerContent = memo(function ServiceTrackerContent({
    vehicle,
    stops,
    previewData,
    has,
    tripId,
    currentStop,
    stopTimes,
    refreshing,
}: ServiceTrackerContentProps) {
    const nextStopRef = useRef<HTMLLIElement>(null)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const [tabValue, setTabValue] = useState("track")
    const [routeLine, setRouteLine] = useState<{ color: string; line: GeoJSON } | null>(null)

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
    }, [tabValue, vehicle?.trip.next_stop.id, vehicle?.trip.next_stop.platform])

    useEffect(() => {
        const getRouteLine = async () => {
            try {
                const response = await ApiFetch<ShapesResponse>(`map/geojson/shapes?tripId=${fullyEncodeURIComponent(tripId)}&routeId=${fullyEncodeURIComponent(vehicle?.route.id || "")}`, {
                    method: "GET",
                })

                if (!response.ok) {
                    console.error(response.error)
                    return
                }

                return {
                    color: response.data.color ? `#${response.data.color}` : "#393939",
                    line: response.data.geojson,
                }
            } catch (error) {
                console.error(error)
            }
        }

        getRouteLine().then((res) => {
            if (res) {
                setRouteLine(res)
            }
        })
    }, [tripId, vehicle])

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
                        (stop) => isAtStop ? stop.stop_id === vehicle.trip.current_stop.id : stop.stop_id === vehicle.trip.next_stop.id
                    )?.arrival_time || 0
                )
                : "";
        return (
            <div className="space-y-3">
                <div>
                    {vehicle.off_course && (
                        <Card className="border-destructive bg-destructive/5 mb-4">
                            <CardContent className="flex items-center gap-2 p-3 sm:p-4">
                                <TriangleAlertIcon className="h-4 w-4 sm:h-5 sm:w-5 text-destructive flex-shrink-0" />
                                <p className="text-sm font-medium text-destructive">Vehicle location issue detected</p>
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
                            <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                                {vehicle.trip.headsign}
                            </h1>
                        </div>
                        {refreshing && (
                            <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                        )}
                    </div>

                    <div className="grid gap-3 sm:gap-4 mt-4">
                        <StopStatusCard
                            title={stopStatusTitle}
                            stopName={stopStatusName}
                            platform={stopStatusPlatform}
                            variant={stopStatusVariant}
                            arrivalTime={stopStatusArrivalTime}
                        />
                    </div>
                </div>

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
                                                (item) =>
                                                    ({
                                                        lat: item.lat,
                                                        lon: item.lon,
                                                        icon: vehicle.trip.next_stop.id === item.id
                                                            ? "next stop marker"
                                                            : currentStop?.name === item.name
                                                                ? "marked stop marker"
                                                                : vehicle.trip.final_stop.id === item.id
                                                                    ? "end marker"
                                                                    : vehicle.trip.next_stop.id === item.id
                                                                        ? "next stop marker"
                                                                        : item.id === vehicle.trip.current_stop.id
                                                                            ? "current stop marker"
                                                                            : vehicle.trip.current_stop.sequence > item.sequence
                                                                                ? "dot gray"
                                                                                : "dot",
                                                        id: item.name,
                                                        routeID: "",
                                                        description: {
                                                            text: `${item.name} ${item.platform ? `| Platform ${item.platform}` : ""}`,
                                                            alwaysShow: false,
                                                        },
                                                        type: "stop",
                                                        zIndex: 1,
                                                        onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                                    }) as MapItem,
                                            ),
                                            {
                                                lat: vehicle.position.lat,
                                                lon: vehicle.position.lon,
                                                icon: vehicle.type || "bus",
                                                id: vehicle.trip_id,
                                                routeID: vehicle.route.id,
                                                description: { text: "Vehicle you're tracking", alwaysShow: false },
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
                                                icon: vehicle.type || "bus",
                                                id: vehicle.trip_id,
                                                routeID: vehicle.route.id,
                                                description: { text: "Vehicle you're tracking", alwaysShow: false },
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
                        <StopsList tripId={tripId} stops={stops} vehicle={vehicle} stopTimes={stopTimes} />
                    </TabsContent>
                </Tabs>
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
    if (!has && previewData && stops) {
        const sortedStops = stops.sort((a, b) => a.sequence - b.sequence)
        const mapBounds = getBoundsFromStops(sortedStops);

        return (
            <div className="space-y-4 sm:space-y-6">
                <div>
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex-1 min-w-0">
                            <h2 className="text-xl sm:text-2xl font-bold mb-2">
                                {formatTextToNiceLookingWords(previewData.tripHeadsign)}
                            </h2>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <ClockIcon className="h-4 w-4" />
                                <span>Service Preview</span>
                                <span>•</span>
                                <span>{stops.length} stops</span>
                            </div>
                        </div>
                        {refreshing && <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-muted-foreground" />}
                    </div>

                    {/* Route Summary */}
                    <Card className="mb-4">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2 text-sm">
                                        <MapPinIcon className="h-4 w-4 text-green-600" />
                                        <span className="font-medium">From:</span>
                                        <span>{sortedStops[0].name}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2 text-sm">
                                        <FlagIcon className="h-4 w-4 text-red-600" />
                                        <span className="font-medium">To:</span>
                                        <span>{sortedStops[sortedStops.length - 1].name}</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

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
                                    (item, index) =>
                                        ({
                                            lat: item.lat,
                                            lon: item.lon,
                                            icon: index === stops.length - 1 ? "end marker" : "dot",
                                            id: item.name,
                                            routeID: "",
                                            description: {
                                                text: `${item.name} ${item.platform ? `| Platform ${item.platform}` : ""}`,
                                                alwaysShow: false,
                                            },
                                            zIndex: 1,
                                            type: "stop",
                                            onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                        }) as MapItem,
                                )}
                                map_id={"tracker preview" + Math.random()}
                                height={"300px"}
                            />
                        </Suspense>
                    </TabsContent>

                    <TabsContent value="stops">
                        <StopsList tripId={tripId} stops={stops} stopTimes={stopTimes} />
                    </TabsContent>
                </Tabs>
            </div>
        )
    }

    return null
})

export default ServiceTrackerContent


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
                            <p className="text-xs font-semibold text-foreground text-nowrap">@ {arrivalTime}</p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
})
