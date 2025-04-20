import LoadingSpinner from "@/components/loading-spinner";
import { lazy, Suspense, useEffect, useState } from "react";
const LeafletMap = lazy(() => import("@/components/map/map"));
import ServiceTrackerModal, { VehiclesResponse } from "@/components/services/tracker";
import Head from "next/head";
import { TrainsApiResponse } from "@/components/services/types";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ApiFetch, useUrl } from "@/lib/url-context";
import { useUserLocation } from "@/lib/userLocation";
import { Bounds, MapItem } from "@/components/map/map";
import { HeaderMeta } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";

const MAPID = "vehicles-amazing-map"
const REFRESH_INTERVAL = 10; // Refresh interval in seconds

export default function Vehicles() {
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>()
    const [error, setError] = useState("")
    const [selectedVehicle, setSelectedVehicle] = useState<VehiclesResponse | null>(null)
    const [vehicleType, setVehicleType] = useState<"Train" | "Bus" | "Ferry" | "">("")
    const { location, loading, locationFound } = useUserLocation()
    const [bounds, setBounds] = useState<Bounds>(null)
    const { currentUrl } = useUrl()

    useEffect(() => {
        async function getData() {
            const data = await getVehicles(vehicleType, bounds)
            if (data.error !== undefined) {
                setError(data.error)
            }
            if (data.vehicles !== null) {
                setVehicles(data.vehicles)
            }
        }

        let intervalId: NodeJS.Timeout | null = null
        if (bounds) {
            getData()
            if (!selectedVehicle) {
                intervalId = setInterval(getData, REFRESH_INTERVAL * 1000);
            }
        }
        if (intervalId) {
            return () => clearInterval(intervalId);
        }
    }, [vehicleType, selectedVehicle, bounds])

    useEffect(() => {
        const handleMapBoundsUpdate = (event: Event) => {
            const customEvent = event as CustomEvent<{ bounds: Bounds }>;
            setBounds(customEvent.detail.bounds);
        };

        document.addEventListener(`mapBoundsUpdate-${MAPID}`, handleMapBoundsUpdate);

        return () => {
            document.removeEventListener(`mapBoundsUpdate-${MAPID}`, handleMapBoundsUpdate);
        };
    }, []);

    if (error !== "") {
        return <ErrorScreen errorTitle="An error occurred while loading the vehicles" errorText={error} />
    }

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <Header />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    <Select onValueChange={(newValue) => setVehicleType(newValue as "" | "Bus" | "Train" | "Ferry")}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Vehicle type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Vehicles</SelectItem>
                            <SelectItem value="Bus">Bus</SelectItem>
                            <SelectItem value="Train">Train</SelectItem>
                            <SelectItem value="Ferry">Ferry</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="mb-4" />

                    {selectedVehicle !== null ? (
                        <ServiceTrackerModal loaded defaultOpen onOpenChange={(v) => !v ? setSelectedVehicle(null) : null} has={true} tripId={selectedVehicle.trip_id} />
                    ) : null}

                    {error !== "" ? (
                        "Err: " + error
                    ) : (
                        <Suspense fallback={<LoadingSpinner description="Loading vehicles..." height="100svh" />}>
                            <LeafletMap defaultCenter={currentUrl.defaultMapCenter} vehicles={[...(vehicles ? (
                                vehicles.map((vehicle) => ({
                                    lat: vehicle.position.lat,
                                    lon: vehicle.position.lon,
                                    icon: vehicle.type,
                                    id: vehicle.trip_id,
                                    routeID: vehicle.route.id,
                                    description: { text: `${vehicle.route.name}`, alwaysShow: true },
                                    zIndex: 1,
                                    onClick: () => {
                                        setSelectedVehicle(vehicle)
                                    },
                                }) as MapItem)
                            ) : [])]} map_id={MAPID} userLocation={{ found: locationFound, lat: location[0], lon: location[1] }} height={"calc(100svh - 2rem - 70px)"} />
                        </Suspense>
                    )}


                </div>
            </div >
        </>
    )
}

type GetVehiclesResult =
    | { error: string; vehicles: null }
    | { error: undefined; vehicles: VehiclesResponse[] };

async function getVehicles(vehicleType: "Train" | "Bus" | "Ferry" | "", bounds: Bounds): Promise<GetVehiclesResult> {
    const form = new FormData()
    form.set("vehicle_type", vehicleType)
    form.set("bounds", bounds === null ? "" : JSON.stringify(bounds))
    const req = await ApiFetch(`realtime/live`, {
        method: "POST",
        body: form
    })
    const data: TrainsApiResponse<VehiclesResponse[]> = await req.json()
    if (!req.ok) {
        console.log(data.message)
        return { error: data.message, vehicles: null };
    }
    return { error: undefined, vehicles: data.data }
}


function Header() {
    return (
        <Head>
            <title>Vehicles</title>

            <HeaderMeta />

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