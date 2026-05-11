import LoadingSpinner from "@/components/loading-spinner";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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


type StopFilters = "Bus" | "Train" | "Ferry" | "all";

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

    // --- Fetch Stops once ---
    useEffect(() => {
        async function getData() {
            const req = await ApiFetch<Stop[]>(`stops?children=false&stop_type=${stopType}`, { method: "GET" })
            if (req.ok) {
                setStops(req.data)
            }
            else {
                setError(req)
            }
        }
        getData()
    }, [stopType])

    if (error) {
        return (
            <ErrorScreen
                errorTitle="An error has occurred"
                errorText={error.error}
                traceId={error.trace_id}
            />
        )
    }

    const finalHeight =
        customTailwindHeight && customTailwindHeight !== ""
            ? customTailwindHeight
            : "h-full"

    return (
        <>
            <div className="flex items-center justify-between w-full mb-4">
                <div className="flex flex-col items-start justify-center gap-2">
                    <Label htmlFor="stopType">Filter stops by type:</Label>
                    <Select
                        value={stopType}
                        onValueChange={(newValue) =>
                            setStopType(newValue as StopFilters)
                        }
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Stop type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Stops</SelectItem>
                            <SelectItem value="bus">Bus</SelectItem>
                            <SelectItem value="train">Train</SelectItem>
                            <SelectItem value="ferry">Ferry</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
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
                                icon: item.stop_type === "bus" ? "bus stop marker" : item.stop_type === "ferry" ? "ferry stop marker" : item.stop_type === "train" ? "train stop marker" : "dot",
                                id: `${item.stop_name} ${item.stop_code}`,
                                routeID: "",
                                description: {
                                    text: `${item.stop_name} ${item.stop_code} | ${formatTextToNiceLookingWords(item.stop_type)}`,
                                    alwaysShow: false,
                                },
                                zIndex: 1,
                                type: "stop",
                                onClick: () =>
                                (window.location.href = `/?s=${encodeURIComponent(
                                    `${item.stop_name} ${item.stop_code}`
                                )}`),
                            })) ?? []
                        }
                        height="100%"
                    />
                </Suspense>
            </div>
        </>
    )
}
