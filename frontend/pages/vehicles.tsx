import LoadingSpinner from "@/components/loading-spinner";
import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { VehiclesResponse } from "@/components/services/tracker";
import ServiceTrackerView from "@/components/services/tracker/panel";
import { useRouteLine, useServiceTracker } from "@/components/services/tracker/use-service-tracker";
import VehicleList from "@/components/vehicles/vehicle-list";
import { ApiError, ApiFetch, useUrl } from "@/lib/url-context";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { useQueryParams } from "@/lib/url-params";
import { useIsMobile } from "@/lib/utils";
import { MapItem } from "@/components/map/markers/create";
import { Stop } from "./stops";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useUserLocation } from "@/lib/userLocation";

const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});

const MAPID = "vehicles-amazing-map";
const REFRESH_INTERVAL = 10;

type VehicleFilters = "Train" | "Bus" | "Ferry" | "all";

const VEHICLE_FILTER_OPTIONS: { value: VehicleFilters; label: string }[] = [
    { value: "all", label: "All" },
    { value: "Bus", label: "Bus" },
    { value: "Train", label: "Train" },
    { value: "Ferry", label: "Ferry" },
]

export default function Vehicles() {
    const [vehicles, setVehicles] = useState<VehiclesResponse[]>([]);
    const [stops, setStops] = useState<Stop[]>([]);
    const [error, setError] = useState<ApiError | null>();
    const [vehicleType, setVehicleType] = useState<VehicleFilters>("all");
    const { currentUrl } = useUrl();
    const isMobile = useIsMobile();
    const { selectedVehicle } = useQueryParams({
        selectedVehicle: { keys: ["tripId"], type: "string", default: "" },
    });
    const [showStops, setShowStops] = useState(false)
    const { location: userLocation, locationFound } = useUserLocation()

    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<VehiclesResponse[]>(`realtime/live?type=${vehicleType}`, { method: "GET" });
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
        if (intervalId) return () => clearInterval(intervalId);
    }, [vehicleType, selectedVehicle.value]);

    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<Stop[]>(`stops?children=false`, { method: "GET" })
            if (req.ok) {
                setStops(req.data)
            }
        }
        if (showStops) {
            getData()
        } else {
            setStops([])
        }
    }, [showStops])

    // Reuse the same hook the tracker panel/modal use - the vehicle list's own
    // entries can have an unresolved `trip`, but this fetches the single tracked
    // trip directly so `trip` (and its stops) are always fully populated.
    const { vehicle: trackedVehicle, stops: tripStops } = useServiceTracker(
        selectedVehicle.value,
        true,
        selectedVehicle.value !== ""
    )
    const routeLine = useRouteLine(selectedVehicle.value, trackedVehicle?.route.id)

    if (error) {
        return (
            <ErrorScreen
                errorTitle="Failed to load vehicles"
                errorText={error.error}
                traceId={error.trace_id}
            />
        );
    }

    return (
        <>
            <Header title="Vehicle tracker" />
            <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4 h-[calc(100svh-4rem)]">
                {/* Filter bar */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="flex flex-wrap gap-1.5">
                        {VEHICLE_FILTER_OPTIONS.map(({ value, label }) => (
                            <button
                                key={value}
                                onClick={() => setVehicleType(value)}
                                className={`px-3 py-1.5 rounded-md font-display text-xs font-semibold uppercase tracking-wide transition-all duration-150 ${vehicleType === value
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <Label htmlFor="show-stops" className="text-xs text-muted-foreground cursor-pointer">
                            Show stops
                        </Label>
                        <Switch
                            id="show-stops"
                            checked={showStops}
                            onCheckedChange={setShowStops}
                        />
                    </div>
                </div>

                {selectedVehicle.found && selectedVehicle.value !== "" && isMobile && (
                    <ServiceTrackerView
                        key={selectedVehicle.value}
                        variant="sheet"
                        hasOwnMap={false}
                        has={true}
                        tripId={selectedVehicle.value}
                        onClose={() => selectedVehicle.set("")}
                    />
                )}

                <div className="flex flex-row flex-grow h-full min-h-0 gap-3">
                    <div className="hidden lg:flex lg:flex-col w-56 shrink-0 border border-border rounded-md overflow-hidden min-h-0">
                        <VehicleList
                            vehicles={vehicles}
                            selectedTripId={selectedVehicle.value}
                            onSelect={(tripId) => selectedVehicle.set(tripId)}
                            userLocation={userLocation}
                            locationFound={locationFound}
                        />
                    </div>

                    <div className="flex flex-col flex-grow min-w-0">
                        <Suspense fallback={<LoadingSpinner description="Loading vehicles..." height="100svh" />}>
                            <LeafletMap
                                defaultZoom={["user", currentUrl.defaultMapCenter]}
                                followMarkerId={selectedVehicle.value || undefined}
                                clusterOptions={{ threshold: 50 }}
                                line={routeLine ? { GeoJson: routeLine.line, color: routeLine.color } : undefined}
                                mapItems={[
                                    ...vehicles.filter((v) => v.route.id !== "").map(
                                        (vehicle) => {
                                            const isSelected = selectedVehicle.value === vehicle.trip_id
                                            const isFocused = selectedVehicle.value !== ""
                                            return {
                                                lat: vehicle.position.lat,
                                                lon: vehicle.position.lon,
                                                icon: vehicle.type,
                                                bearing: vehicle.position.bearing,
                                                opacity: isFocused && !isSelected ? 0.35 : 1,
                                                id: vehicle.trip_id,
                                                routeID: vehicle.route.id,
                                                visibleLabel: `${vehicle.route.name}${vehicle.type ? " · " + vehicle.type : ""}${vehicle.license_plate ? " · " + vehicle.license_plate : ""}`,
                                                zIndex: isSelected ? 10 : 1,
                                                type: "vehicle",
                                                onClick: () => selectedVehicle.set(vehicle.trip_id),
                                            } as MapItem
                                        }
                                    ),
                                    ...stops.map((item) => {
                                        const stopId = item.stop_name + " " + item.stop_code
                                        return {
                                            lat: item.stop_lat,
                                            lon: item.stop_lon,
                                            icon: item.stop_type === "bus"
                                                ? "bus stop marker"
                                                : item.stop_type === "ferry"
                                                    ? "ferry stop marker"
                                                    : item.stop_type === "train"
                                                        ? "train stop marker"
                                                        : "dot",
                                            id: stopId,
                                            routeID: "",
                                            zIndex: 1,
                                            type: "stop",
                                            onClick: () => { },
                                            popup: {
                                                title: stopId,
                                                linkText: "View departures",
                                                linkHref: `/?s=${encodeURIComponent(stopId)}`,
                                            },
                                        } as MapItem
                                    }),
                                    ...(trackedVehicle && tripStops
                                        ? tripStops.map((stop) => {
                                            const trip = trackedVehicle.trip
                                            const icon =
                                                trip.final_stop.parent_stop_id === stop.parent_stop_id || trip.final_stop.child_stop_id === stop.child_stop_id
                                                    ? "end marker"
                                                    : trip.next_stop.parent_stop_id === stop.parent_stop_id || trip.next_stop.child_stop_id === stop.child_stop_id
                                                        ? "next stop marker"
                                                        : trip.current_stop.parent_stop_id === stop.parent_stop_id || trip.current_stop.child_stop_id === stop.child_stop_id
                                                            ? "current stop marker"
                                                            : trip.first_stop.parent_stop_id === stop.parent_stop_id
                                                                ? "start marker"
                                                                : trip.current_stop.sequence > stop.sequence
                                                                    ? "dot gray"
                                                                    : "dot"
                                            return {
                                                lat: stop.lat,
                                                lon: stop.lon,
                                                icon,
                                                id: "trip-stop-" + stop.name + stop.sequence,
                                                routeID: "",
                                                zIndex: 1,
                                                type: "stop",
                                                onClick: () => { },
                                                popup: {
                                                    title: `${stop.name}${stop.platform ? ` | Platform ${stop.platform}` : ""}`,
                                                    linkText: "View departures",
                                                    linkHref: `/?s=${encodeURIComponent(stop.name)}`,
                                                },
                                            } as MapItem
                                        })
                                        : []),
                                ]}
                                map_id={MAPID}
                                height="100%"
                            />
                        </Suspense>
                    </div>

                    {selectedVehicle.found && selectedVehicle.value !== "" && !isMobile && (
                        <ServiceTrackerView
                            variant="panel"
                            tripId={selectedVehicle.value}
                            onClose={() => selectedVehicle.set("")}
                        />
                    )}
                </div>
            </div>
        </>
    );
}
