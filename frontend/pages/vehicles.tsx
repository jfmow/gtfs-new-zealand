import LoadingSpinner from "@/components/loading-spinner";
import NavBar from "@/components/nav";
import { useUserLocation } from "@/lib/userLocation";
import { lazy, Suspense, useEffect, useState } from "react";
const LeafletMap = lazy(() => import("@/components/map"));
import ServiceTrackerModal from "@/components/services/tracker";
import Head from "next/head";


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

        const intervalId = setInterval(getData, 15000);

        // Clean up the interval when the component unmounts or stopName changes
        return () => clearInterval(intervalId);
    }, [])

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <Header />
            <NavBar />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    {selectedVehicle !== null ? (
                        <ServiceTrackerModal loaded onlyVehicle defaultOpen onOpenChange={(v) => !v ? setSelectedVehicle(null) : null} has={true} vehicle={selectedVehicle.vehicle} tripUpdate={selectedVehicle.trip_update} routeColor="" />
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
                                    description: `${vehicle.trip.route_id} | ${Math.round(vehicle.position.speed)}km/h`,
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




function Header() {
    return (
        <Head>
            <title>Vehicles</title>

            <link rel="manifest" href="manifest.json" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="application-name" content="Trains" />
            <meta name="apple-mobile-web-app-title" content="Trains" />
            <meta name="theme-color" content="#ffffff" />
            <meta name="msapplication-navbutton-color" content="#ffffff" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="msapplication-starturl" content="/" />
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
            <link rel='icon' type='image/png' href={`/Favicon.png`} />
            <link rel="apple-touch-icon" href={`/Favicon.png`} />
            <link rel="shortcut icon" href={`/Favicon.png`} />

            <meta name="description" content="Track public transport vehicles live!" />
            <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
            <link rel="canonical" href="https://trains.suddsy.dev/"></link>
            <meta property="og:title" content="Live vehicle locations!" />
            <meta property="og:url" content="https://trains.suddsy.dev/" />
            <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
            <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
        </Head>
    )
}