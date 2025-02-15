import { useUserLocation } from "@/lib/userLocation";
const LeafletMap = lazy(() => import("../map"));
import { lazy, Suspense, useEffect, useState } from "react";
import { TrainsApiResponse, TripUpdate, TripUpdateVehicle } from "./types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer"

import { Button } from "../ui/button";
import { ChevronDown, Loader2, Navigation } from "lucide-react";
import { getStopsForTrip, StopForTripsData } from "./stops";
import { formatTextToNiceLookingWords } from "@/lib/formating";
import { ScrollArea } from "../ui/scroll-area";
import LoadingSpinner from "../loading-spinner";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Navigate from "../map/navigate";
import { ApiFetch } from "@/lib/url-context";


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
}

export default function ServiceTrackerModal({ loaded, tripId, currentStop, has, defaultOpen, onOpenChange }: ServiceTrackerModalProps) {
    const { location } = useUserLocation()
    const [stops, setStops] = useState<StopForTripsData | null>(null)
    const [open, setOpen] = useState(defaultOpen)

    const [vehicle, setVehicle] = useState<TripUpdateVehicle>()

    useEffect(() => {
        async function getData() {
            if (!has) return
            const form = new FormData()
            form.set("tripId", tripId)
            ApiFetch(`realtime/live`, {
                method: "POST",
                body: form
            }).then(async res => {
                const data: TrainsApiResponse<VehiclesResponse[]> = await res.json()
                if (!res.ok) {
                    console.error(data.message)
                    return
                } else {
                    setVehicle(data.data[0].vehicle)
                    const stopsData = await getStopsForTrip(tripId, data.data[0].trip_update.stop_time_update, false)
                    setStops(stopsData)
                }
            })

        }

        if (open) {
            getData()
        }

        const intervalId = setInterval(() => {
            if (open) {
                getData()
            }
        }, 15000);

        // Clean up the interval when the component unmounts or stopName changes
        return () => clearInterval(intervalId);
    }, [has, open, tripId])

    return (
        <>
            <Dialog open={open} onOpenChange={(v) => {
                setOpen(v)
                if (onOpenChange) onOpenChange(v)
            }}>
                {!defaultOpen ? (
                    <DialogTrigger asChild>
                        <Button aria-label="Track service on map" disabled={!has || !loaded} className="w-full" variant={"default"}>
                            {!loaded ? (
                                <Loader2 className="h-4 w-4 animate-spin text-secondary" />
                            ) : (
                                <Navigation />
                            )}
                        </Button>
                    </DialogTrigger>
                ) : null}
                {!open || !vehicle ? null : (
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Service tracker</DialogTitle>
                            <DialogDescription>
                                <Separator className="my-1" />
                                <p className="text-green-400">Next stop: {stops?.next_stop.name} (Platform {stops?.next_stop.platformNumber})</p>
                                <p className="text-red-400">Final stop: {stops?.final_stop.name} (Platform {stops?.final_stop.platformNumber})</p>
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
                                            routeLine={{
                                                routeId: vehicle.trip.route_id,
                                                tripId: vehicle.trip.trip_id,
                                            }}
                                            userLocation={location}
                                            mapItems={[
                                                {
                                                    lat: vehicle.position.latitude,
                                                    lon: vehicle.position.longitude,
                                                    icon: vehicle.vehicle.type || "bus",
                                                    id: vehicle.trip.trip_id,
                                                    routeID: vehicle.trip.route_id,
                                                    description: "Vehicle you're tracking",
                                                    zIndex: 1
                                                },
                                                ...(stops ? stops.stops.map((item) => ({
                                                    lat: item.stop_lat,
                                                    lon: item.stop_lon,
                                                    icon: currentStop?.id === item.stop_id
                                                        ? "marked stop marker"
                                                        : (stops?.final_stop.stop_id === item.stop_id ? "end marker" : (stops.next_stop.stop_id === item.stop_id ? "stop marker" : "dot")),
                                                    id: item.stop_name + " " + item.stop_code,
                                                    routeID: "",
                                                    description: item.stop_name + " " + item.stop_code,
                                                    zIndex: 1,
                                                    onClick: () => window.location.href = `/?s=${encodeURIComponent(item.stop_name + " " + item.stop_code)}`
                                                })) : [])
                                            ]}
                                            navPoints={undefined}
                                            mapID={"tracker" + Math.random()}
                                            height={"300px"}
                                            variant={"userAndFirstPoint"}
                                        />
                                    </Suspense>

                                    <Drawer>
                                        <DrawerTrigger asChild>
                                            <Button className="w-full mt-2">
                                                List of stops
                                            </Button>
                                        </DrawerTrigger>
                                        <DrawerContent>
                                            <DrawerHeader>
                                                <DrawerTitle>{vehicle.trip.route_id} stops</DrawerTitle>
                                                <DrawerDescription>Click on a stop to view service departing from that stop.</DrawerDescription>
                                            </DrawerHeader>
                                            <ScrollArea className="h-[50vh] w-full">
                                                <ol className="flex items-center justify-center flex-col gap-1">
                                                    {stops?.stops.map((item, index) => (
                                                        <li key={item.stop_code} className="flex items-center justify-center flex-col gap-1">
                                                            <p className={`${index < stops.next_stop.index ? `text-zinc-400` : ``} ${index === stops.next_stop.index ? `text-blue-600 font-bold` : ``}`}>{formatTextToNiceLookingWords(item.stop_name, true)}</p>
                                                            {index < stops.stops.length - 1 ? (
                                                                <ChevronDown className={`${index < stops.next_stop.index ? `text-zinc-400` : ``} w-4 h-4`} />
                                                            ) : null}
                                                        </li>
                                                    ))}
                                                </ol>
                                            </ScrollArea>

                                            <DrawerFooter>
                                                <DrawerClose asChild>
                                                    <Button variant="outline" className="w-full">Close</Button>
                                                </DrawerClose>
                                            </DrawerFooter>
                                        </DrawerContent>
                                    </Drawer>
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
                )}
            </Dialog>


        </>
    )
}


export interface VehiclesResponse {
    vehicle: TripUpdateVehicle;
    trip_update: TripUpdate;
}