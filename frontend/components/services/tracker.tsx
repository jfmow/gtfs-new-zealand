import { useUserLocation } from "@/lib/userLocation";
const LeafletMap = lazy(() => import("../map/map"));
import { lazy, memo, Suspense, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, } from "@/components/ui/dialog"
import { Button } from "../ui/button";
import { ChevronDown, Loader2, MapIcon, Navigation } from "lucide-react";
import { getStopsForTrip, StopForTripsData } from "./stops";
import { formatTextToNiceLookingWords } from "@/lib/formating";
import { ScrollArea } from "../ui/scroll-area";
import LoadingSpinner from "../loading-spinner";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Navigate from "../map/navigate";
import { ApiFetch, useUrl } from "@/lib/url-context";
import { MapItem } from "../map/map";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"



interface ServiceTrackerModalProps {
    tripId: string
    currentStop?: {
        id: string;
        lat: number;
        lon: number;
        name: string;
    }
    defaultOpen?: boolean
    onOpenChange?: (v: boolean) => void
    loaded: boolean
    has: boolean
    previewData?: PreviewData
}
interface PreviewData {
    tripHeadsign: string
    route_id: string
    route_name: string
    trip_id: string
}

const REFRESH_INTERVAL = 5; // Refresh interval in seconds

const ServiceTrackerModal = memo(function ServiceTrackerModal({ loaded, tripId, currentStop, has, defaultOpen, onOpenChange, previewData }: ServiceTrackerModalProps) {
    const { location, locationFound, loading } = useUserLocation()
    const [stops, setStops] = useState<StopForTripsData | null>(null)
    const [open, setOpen] = useState(defaultOpen)

    const [vehicle, setVehicle] = useState<VehiclesResponse>()
    const [initialLoading, setInitialLoading] = useState(false)
    const { currentUrl } = useUrl()
    // const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

    useEffect(() => {
        async function getData() {
            if (!has) {
                const stopsData = await getStopsForTrip(tripId, "", "")
                if (stopsData) {
                    setStops(stopsData)
                }
                return
            }
            const form = new FormData()
            form.set("tripId", tripId)
            const res = await ApiFetch<VehiclesResponse[]>(`realtime/live`, {
                method: "POST",
                body: form
            })
            if (!res.ok) {
                console.error(res.error)
                return
            } else {
                if (res.data && res.data.length >= 1) {
                    const vehicle = res.data[0]
                    setVehicle(vehicle)
                    const stopsData = await getStopsForTrip(tripId, vehicle.trip.current_stop.id, vehicle.trip.next_stop.id)
                    if (stopsData) {
                        setStops(stopsData)
                    }
                } else {
                    const stopsData = await getStopsForTrip(tripId, "", "")
                    if (stopsData) {
                        setStops(stopsData)
                    }
                }
            }

        }


        let intervalId: NodeJS.Timeout | null

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                getData()
                intervalId = setInterval(getData, REFRESH_INTERVAL * 1000);
            } else if (document.visibilityState === "hidden") {
                if (intervalId) {
                    clearInterval(intervalId);
                }
            }
        };

        if (open) {
            setInitialLoading(true)
            getData().then(() => setInitialLoading(false))
            handleVisibilityChange()
            document.addEventListener("visibilitychange", handleVisibilityChange)
        }

        // Cleanup on unmount, visibility change, or dependencies update
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalId) {
                clearInterval(intervalId);
            }
        }
    }, [has, open, tripId])

    return (
        <>
            <Dialog open={open} onOpenChange={(v) => {
                setOpen(v)
                if (onOpenChange) onOpenChange(v)
            }}>
                {!defaultOpen ? (
                    <DialogTrigger asChild>
                        <Button aria-label="Track service on map" disabled={!loaded || initialLoading} className="w-full" variant={!loaded ? "default" : !has ? "secondary" : "default"}>
                            {!loaded || initialLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-secondary" />
                            ) : (
                                <>
                                    {has ? (
                                        <>
                                            <Navigation className="w-4 h-4" />
                                            Track
                                        </>
                                    ) : (
                                        <>
                                            <MapIcon className="w-4 h-4" />
                                            Preview
                                        </>
                                    )}
                                </>
                            )}
                        </Button>
                    </DialogTrigger>
                ) : null}
                {open && vehicle ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                <div className="flex items-center justify-between w-full">
                                    <span>{vehicle.trip.headsign}</span>
                                </div>
                            </DialogTitle>
                            <DialogDescription>
                                <Separator className="my-1" />
                                <p className="text-orange-400">Previous stop: {vehicle.trip.current_stop.name} {vehicle.trip.current_stop.platform !== "" ? `(Platform ${vehicle.trip.current_stop.platform})` : ""}</p>
                                <p className="text-green-400">Next stop: {vehicle.trip.next_stop.name} {vehicle.trip.current_stop.platform !== "" ? `(Platform ${vehicle.trip.next_stop.platform})` : ""}</p>
                                <p className="text-red-400">Final stop: {vehicle.trip.final_stop.name} {vehicle.trip.current_stop.platform !== "" ? `(Platform ${vehicle.trip.final_stop.platform})` : ""}</p>
                                <details>
                                    <summary>
                                        Departure/Arrival Info
                                    </summary>
                                    <p>
                                        {vehicle.state}
                                    </p>
                                </details>
                            </DialogDescription>
                        </DialogHeader>
                        <Tabs defaultValue="track" className="w-full">
                            <TabsList className="w-full">
                                <TabsTrigger className="w-full" value="track">Track</TabsTrigger>
                                <TabsTrigger disabled={!currentStop || tripId === ""} className="w-full" value="navigate">Navigate</TabsTrigger>
                            </TabsList>
                            <TabsContent value="track">
                                {loading ? null : (
                                    <>
                                        <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                            <LeafletMap
                                                defaultCenter={currentUrl.defaultMapCenter}
                                                userLocation={{ found: locationFound, lat: location[0], lon: location[1] }}
                                                trip={{
                                                    routeId: vehicle.route.id,
                                                    tripId: vehicle.trip_id,
                                                }}
                                                vehicles={[{
                                                    lat: vehicle.position.lat,
                                                    lon: vehicle.position.lon,
                                                    icon: vehicle.type || "bus",
                                                    id: vehicle.trip_id,
                                                    routeID: vehicle.route.id,
                                                    description: { text: "Vehicle you're tracking", alwaysShow: false },
                                                    zIndex: 1,
                                                    onClick: () => { }
                                                }]}
                                                stops={[
                                                    ...(stops ? stops.stops.map((item) =>
                                                        ({
                                                            lat: item.lat,
                                                            lon: item.lon,
                                                            icon: currentStop?.name === item.name
                                                                ? "marked stop marker"
                                                                : (stops.final_stop && stops.final_stop.stop_id === item.id ? "end marker" : (stops.next_stop && stops.next_stop.stop_id === item.id ? "stop marker" : stops.current_stop && item.id === stops.current_stop.stop_id ? "current stop marker" : item.passed ? "dot gray" : "dot")),
                                                            id: item.name,
                                                            routeID: "",
                                                            description: {
                                                                text: `${item.name} ${item.platform ? `| Platform ${item.platform}` : ""}`,
                                                                alwaysShow: false
                                                            },
                                                            zIndex: 1,
                                                            onClick: () => window.location.href = `/?s=${encodeURIComponent(item.name)}`
                                                        }) as MapItem
                                                    ) : [])
                                                ]}
                                                map_id={"tracker" + Math.random()}
                                                height={"300px"}
                                            />
                                        </Suspense>
                                    </>
                                )}
                                <Sheet>
                                    <SheetTrigger asChild>
                                        <Button className="w-full mt-2">List of stops</Button>
                                    </SheetTrigger>
                                    <SheetContent side={"right"} className="flex flex-col">
                                        <SheetHeader>
                                            <SheetTitle>
                                                Stops for: {vehicle.route.name} - {vehicle.trip.headsign}
                                            </SheetTitle>
                                        </SheetHeader>

                                        {/* ScrollArea with fixed height to enable scrolling */}
                                        <ScrollArea className="flex-1 my-4">
                                            <ol className="flex items-center justify-center flex-col gap-1 px-1">
                                                {stops?.stops.map((item, index) => (
                                                    <li key={item.id} className="flex items-center justify-center flex-col gap-1 text-xs sm:text-sm">
                                                        <p
                                                            className={`${item.passed ? `text-zinc-400` : ``} ${stops.next_stop && item.sequence === stops.next_stop.sequence ? `text-blue-600 font-bold` : ``}`}
                                                        >
                                                            {formatTextToNiceLookingWords(item.name, true)} {item.platform ? `| Platform ${item.platform}` : ""}
                                                        </p>
                                                        {index < stops.stops.length - 1 ? (
                                                            <ChevronDown className={`${item.passed ? `text-zinc-400` : ``} w-4 h-4`} />
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ol>
                                        </ScrollArea>

                                        <SheetClose asChild>
                                            <Button className="w-full mt-auto" variant={"default"}>
                                                Close
                                            </Button>
                                        </SheetClose>
                                    </SheetContent>
                                </Sheet>
                            </TabsContent>
                            {currentStop && tripId !== "" ? (
                                <>
                                    <TabsContent value="navigate">
                                        <Navigate start={{
                                            lat: location[0],
                                            lon: location[1],
                                            name: "Your location"
                                        }} end={{
                                            lat: currentStop.lat,
                                            lon: currentStop.lon,
                                            name: currentStop.name
                                        }} />
                                    </TabsContent>
                                </>
                            ) : null}

                        </Tabs>


                    </DialogContent>
                ) : null}
                {open && !has && !vehicle && previewData && stops ? (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                <div className="flex items-center justify-between w-full">
                                    <span>{formatTextToNiceLookingWords(previewData.tripHeadsign)}</span>
                                </div>
                            </DialogTitle>
                            <DialogDescription>
                                <p>Preview the stops for this service</p>
                            </DialogDescription>
                        </DialogHeader>
                        <Tabs defaultValue="track" className="w-full">
                            <TabsList className="w-full">
                                <TabsTrigger className="w-full" value="track">Track</TabsTrigger>
                                <TabsTrigger disabled={!currentStop || tripId === ""} className="w-full" value="navigate">Navigate</TabsTrigger>
                            </TabsList>
                            <TabsContent value="track">
                                <>
                                    <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                        <LeafletMap
                                            defaultCenter={currentUrl.defaultMapCenter}
                                            alwaysFitBoundsWithoutUser={true}
                                            userLocation={{ found: false, lat: 0, lon: 0 }}
                                            trip={{
                                                routeId: previewData.route_id,
                                                tripId: previewData.trip_id,
                                            }}
                                            stops={[
                                                ...(stops ? stops.stops.map((item) =>
                                                    ({
                                                        lat: item.lat,
                                                        lon: item.lon,
                                                        icon: stops.final_stop && stops.final_stop.stop_id === item.id ? "end marker" : "dot",
                                                        id: item.name,
                                                        routeID: "",
                                                        description: {
                                                            text: `${item.name} ${item.platform ? `| Platform ${item.platform}` : ""}`,
                                                            alwaysShow: false
                                                        },
                                                        zIndex: 1,
                                                        onClick: () => window.location.href = `/?s=${encodeURIComponent(item.name)}`
                                                    }) as MapItem
                                                ) : [])
                                            ]}
                                            map_id={"tracker preview" + Math.random()}
                                            height={"300px"}
                                        />
                                    </Suspense>

                                    <Sheet>
                                        <SheetTrigger asChild>
                                            <Button className="w-full mt-2">List of stops</Button>
                                        </SheetTrigger>
                                        <SheetContent side={"right"} className="flex flex-col">
                                            <SheetHeader>
                                                <SheetTitle>
                                                    Stops for: {previewData.route_name} - {previewData.tripHeadsign}
                                                </SheetTitle>
                                            </SheetHeader>

                                            {/* ScrollArea with fixed height to enable scrolling */}
                                            <ScrollArea className="flex-1 my-4">
                                                <ol className="flex items-center justify-center flex-col gap-1 px-1">
                                                    {stops?.stops.map((item, index) => (
                                                        <li key={item.id} className="flex items-center justify-center flex-col gap-1 text-xs sm:text-sm">
                                                            <p
                                                                className={`${item.passed ? `text-zinc-400` : ``} ${stops.next_stop && item.sequence === stops.next_stop.sequence ? `text-blue-600 font-bold` : ``}`}
                                                            >
                                                                {formatTextToNiceLookingWords(item.name, true)} {item.platform ? `| Platform ${item.platform}` : ""}
                                                            </p>
                                                            {index < stops.stops.length - 1 ? (
                                                                <ChevronDown className={`${item.passed ? `text-zinc-400` : ``} w-4 h-4`} />
                                                            ) : null}
                                                        </li>
                                                    ))}
                                                </ol>
                                            </ScrollArea>

                                            <SheetClose asChild>
                                                <Button className="w-full mt-auto" variant={"default"}>
                                                    Close
                                                </Button>
                                            </SheetClose>
                                        </SheetContent>
                                    </Sheet>
                                </>
                            </TabsContent>
                            {currentStop && tripId !== "" ? (
                                <>
                                    <TabsContent value="navigate">
                                        <Navigate start={{
                                            lat: location[0],
                                            lon: location[1],
                                            name: "Your location"
                                        }} end={{
                                            lat: currentStop.lat,
                                            lon: currentStop.lon,
                                            name: currentStop.name
                                        }} />
                                    </TabsContent>
                                </>
                            ) : null}

                        </Tabs>


                    </DialogContent>
                ) : null}
            </Dialog>


        </>
    )
})

export default ServiceTrackerModal

export interface VehiclesResponse {
    trip_id: string;
    route: Route;
    trip: Trip;
    occupancy: number;
    license_plate: string;
    position: Position;
    type: string;
    state: string;
}

export interface Position {
    lat: number;
    lon: number;
}

export interface Route {
    id: string;
    name: string;
    color: string;
}

export interface Trip {
    first_stop: ServicesStop;
    next_stop: ServicesStop;
    final_stop: ServicesStop;
    current_stop: ServicesStop;
    headsign: string;
}

export interface ServicesStop {
    lat: number;
    lon: number;
    id: string;
    name: string;
    platform: string;
    sequence: number;
    passed?: boolean
}
