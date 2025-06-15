import LoadingSpinner from "@/components/loading-spinner";
import { lazy, Suspense, useEffect, useState } from "react";
const LeafletMap = lazy(() => import("@/components/map/map"));
import ServiceTrackerModal, { VehiclesResponse } from "@/components/services/tracker";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ApiFetch, useUrl } from "@/lib/url-context";
import { useUserLocation } from "@/lib/userLocation";
import { MapItem } from "@/components/map/map";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";

const MAPID = "vehicles-amazing-map"
const REFRESH_INTERVAL = 10; // Refresh interval in seconds

export default function Vehicles() {
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>()
    const [error, setError] = useState("")
    const [selectedVehicle, setSelectedVehicle] = useState<VehiclesResponse | null>(null)
    const [vehicleType, setVehicleType] = useState<"Train" | "Bus" | "Ferry" | "">("")
    const { location, loading, locationFound } = useUserLocation()
    const { currentUrl } = useUrl()

    useEffect(() => {
        async function getData() {
            const data = await getVehicles(vehicleType)
            if (data.error !== undefined) {
                setError(data.error)
            }
            if (data.vehicles !== null) {
                setVehicles(data.vehicles)
            }
        }

        let intervalId: NodeJS.Timeout | null = null
        getData()
        if (!selectedVehicle) {
            intervalId = setInterval(getData, REFRESH_INTERVAL * 1000);
        }

        if (intervalId) {
            return () => clearInterval(intervalId);
        }
    }, [vehicleType, selectedVehicle])

    if (error !== "") {
        return <ErrorScreen errorTitle="An error occurred while loading the vehicles" errorText={error} />
    }

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <Header title="Vehicle tracker" />
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

async function getVehicles(vehicleType: "Train" | "Bus" | "Ferry" | ""): Promise<GetVehiclesResult> {
    const form = new FormData()
    form.set("vehicle_type", vehicleType)
    const req = await ApiFetch<VehiclesResponse[]>(`realtime/live`, {
        method: "POST",
        body: form
    })
    if (!req.ok) {
        return { error: req.error, vehicles: null };
    }
    return { error: undefined, vehicles: req.data }
}


