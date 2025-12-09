import LoadingSpinner from "@/components/loading-spinner";
import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";
import ServiceTrackerModal, {
    VehiclesResponse,
} from "@/components/services/tracker";
import { ApiError, ApiFetch, useUrl } from "@/lib/url-context";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { useQueryParams } from "@/lib/url-params";
import { MapItem } from "@/components/map/markers/create";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Stop } from "./stops";

const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});

const MAPID = "vehicles-amazing-map";
const REFRESH_INTERVAL = 10; // Refresh interval in seconds
type VehicleFilters = "Train" | "Bus" | "Ferry" | "all";

export default function Vehicles() {
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>([]);
    const [stops, setStops] = useState<Stop[]>([]);
    const [error, setError] = useState<ApiError | null>();
    const [vehicleType, setVehicleType] = useState<VehicleFilters>("all");
    const [fullscreen, setFullscreen] = useState(false); // ⬅️ NEW
    const { currentUrl } = useUrl();
    const { selectedVehicle } = useQueryParams({
        selectedVehicle: { keys: ["tripId"], type: "string", default: "" },
    });
    const [showStops, setShowStops] = useState(false)

    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<VehiclesResponse[]>(`realtime/live?type=${vehicleType}`, {
                method: "GET"
            });
            if (!req.ok) {
                setError(req);
                setVehicles([]);
            } else {
                setVehicles(req.data);
                setError(null);
            }
        }

        let intervalId: NodeJS.Timeout | null = null;
        getData();
        if (selectedVehicle.value === "") {
            intervalId = setInterval(getData, REFRESH_INTERVAL * 1000);
        }

        if (intervalId) {
            return () => clearInterval(intervalId);
        }
    }, [vehicleType, selectedVehicle.value]);

    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<Stop[]>(`stops?children=false`, { method: "GET" })
            if (req.ok) {
                setStops(req.data)
            } else {
                setError(req)
            }
        }
        if (showStops) {
            getData()
        } else {
            setStops([])
        }
    }, [showStops])

    if (error) {
        return (
            <ErrorScreen
                errorTitle="An error has occurred"
                errorText={error.error}
                traceId={error.trace_id}
            />
        );
    }

    return (
        <>
            <Header title="Vehicle tracker" />
            <div
                className={`mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4 transition-all duration-300 h-full flex-grow ${fullscreen
                    ? "fixed inset-0 z-50 bg-background p-0 max-w-none"
                    : ""
                    }`}
            >
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <Select
                            onValueChange={(newValue) =>
                                setVehicleType(newValue as VehicleFilters)
                            }
                        >
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

                        <div className="flex items-center gap-3">
                            <Checkbox onCheckedChange={() => setShowStops(p => !p)} checked={showStops} id="stops" />
                            <Label htmlFor="stops">Show Stops</Label>
                        </div>
                    </div>

                    <Button variant="outline" size="icon" onClick={() => setFullscreen(!fullscreen)}>
                        {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </Button>
                </div>

                <div className="mb-4" />

                {selectedVehicle.found && selectedVehicle.value !== "" ? (
                    <ServiceTrackerModal
                        loaded
                        defaultOpen
                        onOpenChange={(v) => (!v ? selectedVehicle.set("") : null)}
                        has={true}
                        tripId={selectedVehicle.value}
                    />
                ) : null}

                <div className="flex flex-col flex-grow h-full">
                    <Suspense
                        fallback={
                            <LoadingSpinner
                                description="Loading vehicles..."
                                height="100svh"
                            />
                        }
                    >
                        <LeafletMap
                            defaultZoom={["user", currentUrl.defaultMapCenter]}
                            mapItems={[
                                ...vehicles.filter((v) => v.route.id !== "").map(
                                    (vehicle) =>
                                        ({
                                            lat: vehicle.position.lat,
                                            lon: vehicle.position.lon,
                                            icon: vehicle.type,
                                            id: vehicle.trip_id,
                                            routeID: vehicle.route.id,
                                            description: {
                                                text: `${vehicle.route.name}`,
                                                alwaysShow: true,
                                            },
                                            zIndex: 1,
                                            type: "vehicle",
                                            onClick: () => {
                                                selectedVehicle.set(vehicle.trip_id);
                                            },
                                        }) as MapItem
                                ),
                                ...(stops ? (
                                    stops.map((item) => ({
                                        lat: item.stop_lat,
                                        lon: item.stop_lon,
                                        icon: "dot",
                                        id: item.stop_name + " " + item.stop_code,
                                        routeID: "",
                                        description: { text: item.stop_name + " " + item.stop_code, alwaysShow: false },
                                        zIndex: 1,
                                        type: "stop",
                                        onClick: () => window.location.href = `/?s=${encodeURIComponent(item.stop_name + " " + item.stop_code)}`
                                    } as MapItem))
                                ) : [])
                            ]}
                            map_id={MAPID}
                            height={"100%"}
                        />
                    </Suspense>
                </div>
            </div>
        </>
    );
}
