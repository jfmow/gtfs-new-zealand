import { useUserLocation } from "@/lib/userLocation";
const LeafletMap = lazy(() => import("../map"));
import { lazy, Suspense, useEffect, useState } from "react";
import { ServiceData, TripUpdate, TripUpdateVehicle } from "./types";
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
import { ChevronDown, Navigation } from "lucide-react";
import { getStopsForTrip, StopForTripsData } from "./stops";
import { formatTextToNiceLookingWords } from "@/lib/formating";
import { ScrollArea } from "../ui/scroll-area";
import LoadingSpinner from "../loading-spinner";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Navigate from "../map/navigate";


interface ServiceTrackerModalProps {
    vehicle: TripUpdateVehicle
    tripUpdate: TripUpdate
    has: boolean
    routeColor: string
    targetStopId?: string
    defaultOpen?: boolean
    onOpenChange?: (v: boolean) => void
    onlyVehicle?: boolean
    currentStop?: ServiceData
}

export default function ServiceTrackerModal({ vehicle, tripUpdate, has, routeColor, defaultOpen, onOpenChange, onlyVehicle, targetStopId, currentStop }: ServiceTrackerModalProps) {
    const { location } = useUserLocation()
    const [stops, setStops] = useState<StopForTripsData | null>(null)
    const [open, setOpen] = useState(defaultOpen)

    useEffect(() => {
        async function getData() {
            if (!has) return
            const data = await getStopsForTrip(vehicle.trip.trip_id, tripUpdate.stop_time_update.stop_sequence, false)
            setStops(data)
        }
        if (open) {
            getData()
        }
    }, [has, tripUpdate, vehicle, open])


    return (
        <>
            <Dialog open={open} onOpenChange={(v) => {
                setOpen(v)
                if (onOpenChange) onOpenChange(v)
            }}>
                {!defaultOpen ? (
                    <DialogTrigger asChild>
                        <Button aria-label="Track service on map" disabled={!has} className="w-full" variant="default">
                            <Navigation />
                        </Button>
                    </DialogTrigger>
                ) : null}
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Service tracker</DialogTitle>
                        <DialogDescription>
                            <p className="text-green-500">Next stop: {stops?.next_stop.name} (Platform {stops?.next_stop.platformNumber})</p>
                            <p className="">Final stop: {stops?.final_stop.name} (Platform {stops?.final_stop.platformNumber})</p>
                            <Separator className="my-1" />
                            <p>Speed: {Math.round(vehicle.position.speed)}km/h</p>
                        </DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="track" className="w-full">
                        <TabsList className="w-full">
                            <TabsTrigger className="w-full" value="track">Track</TabsTrigger>
                            <TabsTrigger disabled={!currentStop || currentStop.trip_id === ""} className="w-full" value="navigate">Navigate</TabsTrigger>
                        </TabsList>
                        <TabsContent value="track">
                            <>
                                <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                                    <LeafletMap
                                        routeLine={{
                                            routeId: vehicle.trip.route_id,
                                            routeColor: routeColor,
                                            tripId: vehicle.trip.trip_id,
                                            vehicleType: vehicle.vehicle.type.toLowerCase()
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
                                                icon: targetStopId === item.stop_id
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
                                        variant={onlyVehicle || location[0] === 0 ? "firstItem" : "userAndFirstPoint"}
                                    />
                                </Suspense>

                                <Drawer>
                                    <DrawerTrigger asChild>
                                        <Button>
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
                                                        <p className={`${index < stops.next_stop.index ? `text-zinc-400` : ``} ${index === stops.next_stop.index ? `text-blue-600 font-bold` : ``}`}>{formatTextToNiceLookingWords(item.stop_name)}</p>
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
                        {currentStop && currentStop.trip_id !== "" ? (
                            <>
                                <TabsContent value="navigate">
                                    <Navigate start={{
                                        lat: location[0],
                                        lon: location[1],
                                        name: "Your location"
                                    }} end={{
                                        lat: currentStop.stop_data.stop_lat,
                                        lon: currentStop.stop_data.stop_lon,
                                        name: currentStop.stop_data.stop_name
                                    }} />
                                </TabsContent>
                            </>
                        ) : null}

                    </Tabs>


                </DialogContent>
            </Dialog>


        </>
    )
}
