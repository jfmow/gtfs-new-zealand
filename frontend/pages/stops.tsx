import LoadingSpinner from "@/components/loading-spinner";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { ApiFetch, useUrl } from "@/lib/url-context";
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

export type Stop = {
    stop_name: string;
    stop_code: string;
    stop_lat: number;
    stop_lon: number;
    location_type: number;
    parent_id: string
};


const MAPID = "stops-amazing-map"

export function StopsMap({
    customTailwindHeight,
    buttonPosition,
}: {
    customTailwindHeight?: string
    buttonPosition?: "top" | "bottom"
}) {
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState("")
    const { currentUrl } = useUrl()

    // --- Fetch Stops once ---
    useEffect(() => {
        async function getData() {
            const form = new FormData()
            form.set("children", "no")
            const req = await ApiFetch<Stop[]>(`stops`, { method: "POST", body: form })
            if (req.ok) setStops(req.data)
            else setError(req.error)
        }
        getData()
    }, [])

    if (error !== "") {
        return (
            <ErrorScreen
                errorTitle="An error occurred while loading the stops"
                errorText={error}
            />
        )
    }

    // --- Let CSS handle height ---
    const finalHeight =
        customTailwindHeight && customTailwindHeight !== ""
            ? customTailwindHeight
            : "h-full"

    return (
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
                            icon: "dot",
                            id: `${item.stop_name} ${item.stop_code}`,
                            routeID: "",
                            description: {
                                text: `${item.stop_name} ${item.stop_code}`,
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
    )
}
