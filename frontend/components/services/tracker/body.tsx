import { lazy, memo, Suspense, useRef, useEffect, useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LoadingSpinner from "../../loading-spinner"
import Navigate from "../../map/navigate"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { useUrl } from "@/lib/url-context"
import type { MapItem } from "../../map/map"
import type { VehiclesResponse, PreviewData, ServicesStop, StopTimes } from "."
import StopsList from "./stops-list"

const LeafletMap = lazy(() => import("../../map/map"))

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
    locationFound,
    loading,
    stopTimes,
}: ServiceTrackerContentProps) {
    const { currentUrl } = useUrl()
    const nextStopRef = useRef<HTMLLIElement>(null)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const [tabValue, setTabValue] = useState("track")

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

    // Vehicle tracking mode
    if (vehicle) {
        return (
            <div className="space-y-4">
                <div>
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
                                    defaultCenter={currentUrl.defaultMapCenter}
                                    userLocation={{ found: locationFound, lat: location[0], lon: location[1] }}
                                    trip={{
                                        routeId: vehicle.route.id,
                                        tripId: vehicle.trip_id,
                                    }}
                                    vehicles={[
                                        {
                                            lat: vehicle.position.lat,
                                            lon: vehicle.position.lon,
                                            icon: vehicle.type || "bus",
                                            id: vehicle.trip_id,
                                            routeID: vehicle.route.id,
                                            description: { text: "Vehicle you're tracking", alwaysShow: false },
                                            zIndex: 1,
                                            onClick: () => { },
                                        },
                                    ]}
                                    stops={
                                        stops
                                            ? stops.map(
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
                                                        zIndex: 1,
                                                        onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                                    }) as MapItem,
                                            )
                                            : []
                                    }
                                    map_id={"tracker" + Math.random()}
                                    height={"300px"}
                                />
                            </Suspense>
                        )}
                    </TabsContent>

                    <TabsContent value="stops">
                        <StopsList stops={stops} vehicle={vehicle} stopTimes={stopTimes} />
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
                                defaultCenter={currentUrl.defaultMapCenter}
                                alwaysFitBoundsWithoutUser={true}
                                userLocation={{ found: false, lat: 0, lon: 0 }}
                                trip={{
                                    routeId: previewData.route_id,
                                    tripId: previewData.trip_id,
                                }}
                                stops={stops.map(
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
                                            onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                        }) as MapItem,
                                )}
                                map_id={"tracker preview" + Math.random()}
                                height={"300px"}
                            />
                        </Suspense>
                    </TabsContent>

                    <TabsContent value="stops">
                        <StopsList stops={stops} stopTimes={stopTimes} />
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
