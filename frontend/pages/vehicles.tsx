import LoadingSpinner from "@/components/loading-spinner";
import { Suspense, useEffect, useState } from "react";
const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});
import ServiceTrackerModal, { VehiclesResponse } from "@/components/services/tracker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiFetch, useUrl } from "@/lib/url-context";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { useQueryParams } from "@/lib/url-params";
import dynamic from "next/dynamic";
import { MapItem } from "@/components/map/markers/create";

const MAPID = "vehicles-amazing-map"
const REFRESH_INTERVAL = 10; // Refresh interval in seconds
type VehicleFilters = "Train" | "Bus" | "Ferry" | "all"

export default function Vehicles() {
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>([])
    const [error, setError] = useState("")
    const [vehicleType, setVehicleType] = useState<VehicleFilters>("all")
    const { currentUrl } = useUrl()
    const { selectedVehicle } = useQueryParams({ selectedVehicle: { keys: ["tripId"], type: "string", default: "" } })

    useEffect(() => {
        async function getData() {
            const form = new FormData()
            form.set("vehicle_type", vehicleType)
            const req = await ApiFetch<VehiclesResponse[]>(`realtime/live`, {
                method: "POST",
                body: form
            })
            if (!req.ok) {
                setError(req.error)
                setVehicles([])
            } else {
                setVehicles(req.data)
                setError("")
            }
        }

        let intervalId: NodeJS.Timeout | null = null
        getData()
        if (selectedVehicle.value === "") {
            intervalId = setInterval(getData, REFRESH_INTERVAL * 1000);
        }

        if (intervalId) {
            return () => clearInterval(intervalId);
        }
    }, [vehicleType, selectedVehicle.value])

    if (error !== "") {
        return <ErrorScreen errorTitle="An error occurred while loading the vehicles" errorText={error} />
    }

    return (
        <>
            <Header title="Vehicle tracker" />
            <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4">
                <Select onValueChange={(newValue) => setVehicleType(newValue as VehicleFilters)}>
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

                {selectedVehicle.found && selectedVehicle.value !== "" ? (
                    <ServiceTrackerModal loaded defaultOpen onOpenChange={(v) => !v ? selectedVehicle.set("") : null} has={true} tripId={selectedVehicle.value} />
                ) : null}

                {error !== "" ? (
                    "Err: " + error
                ) : (
                    <Suspense fallback={<LoadingSpinner description="Loading vehicles..." height="100svh" />}>
                        <LeafletMap defaultZoom={["user", currentUrl.defaultMapCenter]} mapItems={[...(
                            vehicles.map((vehicle) => ({
                                lat: vehicle.position.lat,
                                lon: vehicle.position.lon,
                                icon: vehicle.type,
                                id: vehicle.trip_id,
                                routeID: vehicle.route.id,
                                description: { text: `${vehicle.route.name}`, alwaysShow: true },
                                zIndex: 1,
                                type: "vehicle",
                                onClick: () => {
                                    selectedVehicle.set(vehicle.trip_id)
                                },
                            }) as MapItem
                            ))]} map_id={MAPID} height={"calc(100svh - 2rem - 70px - 36px - 1rem)"} />
                    </Suspense>
                )}


            </div>
        </>
    )
}


