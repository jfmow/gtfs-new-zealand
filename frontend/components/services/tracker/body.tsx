import { lazy, memo, Suspense, useRef, useEffect, useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LoadingSpinner from "../../loading-spinner"
import Navigate from "../../map/navigate"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import type { VehiclesResponse, PreviewData, ServicesStop, StopTimes } from "."
import StopsList from "./stops-list"
import { MapItem } from "@/components/map/markers/create"
import { LatLng } from "../../map/map"
import { ShapesResponse, GeoJSON } from "@/components/map/geojson-types"
import { ApiFetch } from "@/lib/url-context"
import { TriangleAlertIcon } from "lucide-react"

const LeafletMap = lazy(() => import("../../map/map"))

const VehicleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bus-front-icon lucide-bus-front"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>`

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
    location: [number, number]
    locationFound: boolean
    loading: boolean
}

const ServiceTrackerContent = memo(function ServiceTrackerContent({
    vehicle,
    stops,
    previewData,
    has,
    tripId,
    currentStop,
    location,
    loading,
    stopTimes,
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
                const form = new FormData()
                form.set("tripId", tripId)
                if (vehicle) {
                    form.set("routeId", vehicle.route.id)
                }
                const response = await ApiFetch<ShapesResponse>(`map/geojson/shapes`, {
                    method: "POST",
                    body: form
                });

                if (!response.ok) {
                    console.error(response.error)
                    return
                }
                return { color: response.data.color ? `#${response.data.color}` : '#393939', line: response.data.geojson }
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
        return (
            <div className="space-y-4">
                <div>
                    {vehicle.off_course ? (<>
                        <div className="flex items-center gap-1 text-destructive">
                            <TriangleAlertIcon className="w-4 h-4" />
                            <p className="text-sm font-medium">Location issue</p>
                        </div>
                    </>) : null}
                    <h2 className="text-lg font-semibold">{vehicle.trip.headsign}</h2>
                    <div className="space-y-1 text-sm">
                        <Separator className="my-1" />
                        <p className="text-orange-400">
                            {vehicle.state === "Arrived" ? "Current" : "Previous"} stop: {vehicle.trip.current_stop.name}{" "}
                            {vehicle.trip.current_stop.platform !== "" ? `(Platform ${vehicle.trip.current_stop.platform})` : ""}
                        </p>
                        <p className="text-blue-400">
                            Next stop: {vehicle.trip.next_stop.name}{" "}
                            {vehicle.trip.next_stop.platform !== "" ? `(Platform ${vehicle.trip.next_stop.platform})` : ""}
                        </p>
                        <p className="text-red-400">
                            Final stop: {vehicle.trip.final_stop.name}{" "}
                            {vehicle.trip.final_stop.platform !== "" ? `(Platform ${vehicle.trip.final_stop.platform})` : ""}
                        </p>
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
                        <TabsTrigger disabled={!currentStop || tripId === ""} className="w-full" value="navigate">
                            Directions
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="track">
                        {!loading && (
                            <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                <LeafletMap
                                    defaultZoom={currentStop ? [[vehicle.position.lat, vehicle.position.lon], [currentStop.lat, currentStop.lon]] : [[vehicle.position.lat, vehicle.position.lon]]}
                                    line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                                    mapItems={
                                        stops
                                            ? [
                                                ...stops.map(
                                                    (item) =>
                                                        ({
                                                            lat: item.lat,
                                                            lon: item.lon,
                                                            icon:
                                                                currentStop?.name === item.name
                                                                    ? "marked stop marker"
                                                                    : vehicle.trip.final_stop.id === item.id
                                                                        ? "end marker"
                                                                        : vehicle.trip.next_stop.id === item.id
                                                                            ? "stop marker"
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
                                                            type: "stop", // ✅ This makes it a valid MapItem
                                                            zIndex: 1,
                                                            onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                                        }) as MapItem
                                                ),
                                                {
                                                    lat: vehicle.position.lat,
                                                    lon: vehicle.position.lon,
                                                    icon: vehicle.type || "bus",
                                                    id: vehicle.trip_id,
                                                    routeID: vehicle.route.id,
                                                    description: { text: "Vehicle you're tracking", alwaysShow: false },
                                                    zIndex: 1,
                                                    type: "vehicle", // ✅ Add this line
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
                                                    type: "vehicle", // ✅ Add this line
                                                    onClick: () => { },
                                                    zoomButton: VehicleIcon,
                                                },
                                            ]
                                    }

                                    map_id={"tracker" + Math.random()}
                                    height={"300px"}
                                />
                            </Suspense>
                        )}
                    </TabsContent>

                    <TabsContent value="stops">
                        <StopsList tripId={tripId} stops={stops} vehicle={vehicle} stopTimes={stopTimes} />
                    </TabsContent>

                    {currentStop && tripId !== "" && (
                        <TabsContent value="navigate">
                            <Navigate
                                start={{
                                    lat: location[0],
                                    lon: location[1],
                                    name: "Your location",
                                }}
                                end={{
                                    lat: currentStop.lat,
                                    lon: currentStop.lon,
                                    name: currentStop.name,
                                }}
                            />
                        </TabsContent>
                    )}
                </Tabs>
            </div>
        )
    }

    // Preview mode
    if (!has && previewData && stops) {
        const sortedStops = stops.sort((a, b) => a.sequence - b.sequence)
        const mapBounds: [LatLng, LatLng] = [
            [sortedStops[0].lat, sortedStops[0].lon],
            [sortedStops[sortedStops.length - 1].lat, sortedStops[sortedStops.length - 1].lon]
        ]
        return (
            <div className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold">{formatTextToNiceLookingWords(previewData.tripHeadsign)}</h2>
                    <p className="text-sm text-muted-foreground">Preview the stops for this service</p>
                </div>

                <Tabs defaultValue="track" className="w-full">
                    <TabsList className="w-full">
                        <TabsTrigger className="w-full" value="stops">
                            Stops
                        </TabsTrigger>
                        <TabsTrigger className="w-full" value="track">
                            Track
                        </TabsTrigger>
                        <TabsTrigger disabled={!currentStop || tripId === ""} className="w-full" value="navigate">
                            Directions
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

                    {currentStop && tripId !== "" && (
                        <TabsContent value="navigate">
                            <Navigate
                                start={{
                                    lat: location[0],
                                    lon: location[1],
                                    name: "Your location",
                                }}
                                end={{
                                    lat: currentStop.lat,
                                    lon: currentStop.lon,
                                    name: currentStop.name,
                                }}
                            />
                        </TabsContent>
                    )}
                </Tabs>
            </div>
        )
    }

    return null
})

export default ServiceTrackerContent
