import LoadingSpinner from "@/components/loading-spinner";
import NavBar from "@/components/nav";
import { useUserLocation } from "@/lib/userLocation";
import { lazy, Suspense, useEffect, useState } from "react";
const LeafletMap = lazy(() => import("@/components/map"));
import ServiceTrackerModal from "@/components/services/tracker";


export default function Vehicles() {
    const { loading, location } = useUserLocation()
    const [vehicles, setVehicles] = useState<Vehicle[]>()
    const [error, setError] = useState("")

    const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

    useEffect(() => {
        async function getData() {
            const data = await getVehicles()
            if (data.error !== undefined) {
                setError(data.error)
            }
            if (data.vehicles !== null) {
                setVehicles(data.vehicles)
            }
        }
        getData()
    }, [])

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <NavBar />
            <div className="w-full bg-zinc-50 text-zinc-800">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    {selectedVehicle !== null ? (
                        <ServiceTrackerModal onlyVehicle defaultOpen onOpenChange={(v) => !v ? setSelectedVehicle(null) : null} has={true} vehicle={selectedVehicle.vehicle} tripUpdate={selectedVehicle.trip_update} routeColor="" />
                    ) : null}
                    {error !== "" ? (
                        "Err: " + error
                    ) : (
                        <Suspense fallback={<LoadingSpinner description="Loading vehicles..." height="100svh" />}>
                            <LeafletMap mapItems={[...(vehicles ? (
                                vehicles.map(({ vehicle, trip_update }) => ({
                                    lat: vehicle.position.latitude,
                                    lon: vehicle.position.longitude,
                                    icon: vehicle.vehicle.type,
                                    id: vehicle.trip.trip_id,
                                    routeID: vehicle.trip.route_id,
                                    description: vehicle.vehicle.license_plate + vehicle.vehicle.label,
                                    zIndex: 1,
                                    onClick: () => {
                                        setSelectedVehicle({ vehicle, trip_update })
                                    }
                                }))
                            ) : [])]} zoom={17} mapID={"abcdefg"} height={"calc(100svh - 2rem - 70px)"} userLocation={location[0] === 0 ? [-36.85971694520651, 174.76042890091796] : location} variant={"userLocation"} />
                        </Suspense>
                    )}


                </div>
            </div>
        </>
    )
}

type GetVehiclesResult =
    | { error: string; vehicles: null }
    | { error: undefined; vehicles: Vehicle[] };

async function getVehicles(): Promise<GetVehiclesResult> {
    const req = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/vehicles/locations`)
    if (!req.ok) {
        const errorMessage = await req.text()
        return { error: errorMessage, vehicles: null };
    }
    const res: Vehicle[] = await req.json()
    return { error: undefined, vehicles: res }
}

export interface Vehicle {
    vehicle: TripUpdateVehicle;
    trip_update: TripUpdate;
}

export interface TripUpdate {
    trip: Trip;
    stop_time_update: StopTimeUpdate;
    vehicle: TripUpdateVehicle;
    timestamp: number;
    delay: number;
}

export interface StopTimeUpdate {
    stop_sequence: number;
    arrival: Arrival;
    departure: Arrival;
    stop_id: string;
    schedule_relationship: number;
}

export interface Arrival {
    delay: number;
    time: number;
}

export interface Trip {
    trip_id: string;
    start_time: string;
    start_date: string;
    schedule_relationship: number;
    route_id: string;
    direction_id?: number;
}

export interface TripUpdateVehicle {
    trip: Trip;
    position: Position;
    timestamp: number;
    vehicle: VehicleVehicle;
    occupancy_status: number;
}

export interface Position {
    latitude: number;
    longitude: number;
    speed: number;
}

export interface VehicleVehicle {
    id: string;
    label: string;
    license_plate: string;
    type: Type;
}

export enum Type {
    Bus = "bus",
    Empty = "",
    Ferry = "ferry",
    Train = "train",
}
