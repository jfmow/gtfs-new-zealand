import LoadingSpinner from "@/components/loading-spinner";
import { MapItem } from "@/components/map/markers/create";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { formatTextToNiceLookingWords } from "@/lib/formating";
import { ApiError, ApiFetch, useUrl } from "@/lib/url-context";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";

const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});

export default function Stops() {
    return (
        <>
            <Header title="Stops map" />
            <div className="mx-auto max-w-[1400px] flex flex-col px-4 pb-4 flex-grow h-full w-full">
                <StopsMap customTailwindHeight="calc(100svh - 60px - 2rem)" />
            </div>
        </>
    )
}

export interface Stop {
    location_type: number;
    parent_station: string;
    stop_code: string;
    stop_id: string;
    stop_lat: number;
    stop_lon: number;
    stop_name: string;
    stop_headsign: string;
    wheelchair_boarding: number;
    platform_number: string;
    stop_type: string;
    stop_sequence: number;
    is_child_stop: boolean;
}

const MAPID = "stops-amazing-map"

type StopFilters = "bus" | "train" | "ferry" | "all";

const STOP_FILTER_OPTIONS: { value: StopFilters; label: string }[] = [
    { value: "all", label: "All Stops" },
    { value: "bus", label: "Bus" },
    { value: "train", label: "Train" },
    { value: "ferry", label: "Ferry" },
]

export function StopsMap({
    customTailwindHeight,
    buttonPosition,
}: {
    customTailwindHeight?: string
    buttonPosition?: "top" | "bottom"
}) {
    const [stopType, setStopType] = useState<StopFilters>("all");
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState<ApiError | null>()
    const { currentUrl } = useUrl()

    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<Stop[]>(`stops?children=false&stop_type=${stopType}`, { method: "GET" })
            if (req.ok) {
                setStops(req.data)
            } else {
                setError(req)
            }
        }
        getData()
    }, [stopType])

    if (error) {
        return (
            <ErrorScreen
                errorTitle="Failed to load stops"
                errorText={error.error}
                traceId={error.trace_id}
            />
        )
    }

    const finalHeight = customTailwindHeight && customTailwindHeight !== "" ? customTailwindHeight : "h-full"

    return (
        <>
            <div className="flex flex-wrap gap-1.5 mb-3">
                {STOP_FILTER_OPTIONS.map(({ value, label }) => (
                    <button
                        key={value}
                        onClick={() => setStopType(value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${stopType === value
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className={`flex-grow flex flex-col ${finalHeight}`}>
                <Suspense fallback={<LoadingSpinner description="Loading map..." height="100svh" />}>
                    <LeafletMap
                        options={{ buttonPosition: buttonPosition ?? "top" }}
                        defaultZoom={["user", currentUrl.defaultMapCenter]}
                        map_id={MAPID}
                        mapItems={
                            stops?.map((item) => ({
                                lat: item.stop_lat,
                                lon: item.stop_lon,
                                icon: item.stop_type === "bus"
                                    ? "bus stop marker"
                                    : item.stop_type === "ferry"
                                        ? "ferry stop marker"
                                        : item.stop_type === "train"
                                            ? "train stop marker"
                                            : "dot",
                                id: `${item.stop_name} ${item.stop_code}`,
                                routeID: "",
                                popup: {
                                    title: `${item.stop_name} ${item.stop_code} | ${formatTextToNiceLookingWords(item.stop_type)}`,
                                    linkText: "View stop schedule",
                                    linkHref: `/?s=${encodeURIComponent(`${item.stop_name} ${item.stop_code}`)}`,
                                },
                                zIndex: 1,
                                type: "stop",
                            } as MapItem)) ?? []
                        }
                        height="100%"
                    />
                </Suspense>
            </div>
        </>
    )
}
