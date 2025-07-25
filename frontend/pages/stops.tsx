import LoadingSpinner from "@/components/loading-spinner";
import { MapItem } from "@/components/map/markers/create";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { ApiFetch, useUrl } from "@/lib/url-context";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});

const MAPID = "stops-amazing-map"

export default function Stops() {
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState("")
    const { currentUrl } = useUrl()

    useEffect(() => {
        async function getData() {
            const form = new FormData()
            form.set("children", "no")
            const req = await ApiFetch<Stop[]>(`stops`, { method: "POST", body: form })
            if (req.ok) {
                setStops(req.data)
            } else {
                setError(req.error)
            }
        }
        getData()
    }, [])

    if (error !== "") {
        return <ErrorScreen errorTitle="An error occurred while loading the stops" errorText={error} />
    }

    return (
        <>
            <Header title="Stops map" />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col px-4 pb-4">
                    <Suspense fallback={<LoadingSpinner description="Loading map..." height="100svh" />}>
                        <LeafletMap defaultZoom={["user", currentUrl.defaultMapCenter]} map_id={MAPID} mapItems={[...(stops ? (
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
                        ) : [])]} height={"calc(100svh - 2rem - 70px)"} />
                    </Suspense>
                </div>
            </div>

        </>
    )
}

type Stop = {
    stop_name: string;
    stop_code: string;
    stop_lat: number;
    stop_lon: number;
    location_type: number;
    parent_id: string
};
