import { useUserLocation } from "@/lib/userLocation";
const LeafletMap = lazy(() => import("../map"));
import { lazy, Suspense, useEffect, useState } from "react";
import { TripUpdate, TripUpdateVehicle } from "./types";
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


interface ServiceTrackerModalProps {
    vehicle: TripUpdateVehicle
    tripUpdate: TripUpdate
    has: boolean
    routeColor: string
    targetStopName?: string
    defaultOpen?: boolean
    onOpenChange?: (v: boolean) => void
    onlyVehicle?: boolean
}

export default function ServiceTrackerModal({ vehicle, tripUpdate, has, routeColor, defaultOpen, onOpenChange, onlyVehicle, targetStopName }: ServiceTrackerModalProps) {
    const { loading, location } = useUserLocation()
    const [stops, setStops] = useState<StopForTripsData | null>(null)

    useEffect(() => {
        async function getData() {
            if (!has) return
            const data = await getStopsForTrip(vehicle.trip.trip_id, tripUpdate.stop_time_update.stop_sequence, false)
            setStops(data)
        }
        getData()
    }, [has, tripUpdate, vehicle])

    if (loading) {
        return "Finding you..."
    }
    return (
        <>
            <Dialog defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
                {!defaultOpen ? (
                    <DialogTrigger asChild>
                        <Button disabled={!has} className="w-full" variant="default">
                            <Navigation />
                        </Button>
                    </DialogTrigger>
                ) : null}
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Service tracker</DialogTitle>
                        <DialogDescription>
                            Track your services current location and see any past and future stops.
                        </DialogDescription>
                    </DialogHeader>
                    <Suspense fallback={<LoadingSpinner description="Loading map..." height="300px" />}>
                        <LeafletMap
                            routeLine={{
                                routeId: vehicle.trip.route_id,
                                routeColor: routeColor,
                                tripId: vehicle.trip.trip_id,
                                vehicleType: vehicle.vehicle.type
                            }}
                            userLocation={location}
                            mapItems={[
                                {
                                    lat: vehicle.position.latitude,
                                    lon: vehicle.position.longitude,
                                    icon: vehicle.vehicle.type,
                                    id: vehicle.trip.trip_id,
                                    routeID: vehicle.trip.route_id,
                                    description: "Vehicle you're tracking",
                                    zIndex: 1
                                },
                                ...(stops ? stops.stops.map((item) => ({
                                    lat: item.stop_lat,
                                    lon: item.stop_lon,
                                    icon: targetStopName && item.stop_name.toLowerCase().includes(targetStopName.toLowerCase()) ? "stop marker" : "dot",
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


                </DialogContent>
            </Dialog>


        </>
    )
}
