import LoadingSpinner from "@/components/loading-spinner";
import { MapItem } from "@/components/map/map";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { ApiFetch, useUrl } from "@/lib/url-context";
import { useUserLocation } from "@/lib/userLocation";
import { lazy, Suspense, useEffect, useState } from "react";
const LeafletMap = lazy(() => import("@/components/map/map"));

const MAPID = "stops-amazing-map"

export default function Stops() {
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState("")
    const { location, loading, locationFound } = useUserLocation()
    const { currentUrl } = useUrl()

    useEffect(() => {
        async function getData() {
            const data = await getStops()
            if (data.error !== undefined) {
                setError(data.error)
            }
            if (data.stops !== null) {
                setStops(data.stops)
            }
        }
        getData()

    }, [loading])


    if (error !== "") {
        return <ErrorScreen errorTitle="An error occurred while loading the stops" errorText={error} />
    }

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <Header title="Stops map" />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    <Suspense fallback={<LoadingSpinner description="Loading map..." height="100svh" />}>
                        <LeafletMap defaultCenter={currentUrl.defaultMapCenter} userLocation={{ found: locationFound, lat: location[0], lon: location[1] }} map_id={MAPID} stops={[...(stops ? (
                            stops.map((item) => ({
                                lat: item.stop_lat,
                                lon: item.stop_lon,
                                icon: "dot",
                                id: item.stop_name + " " + item.stop_code,
                                routeID: "",
                                description: { text: item.stop_name + " " + item.stop_code, alwaysShow: false },
                                zIndex: 1,
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

type GetStopsResult =
    | { error: string; stops: null }
    | { error: undefined; stops: Stop[] };

async function getStops(): Promise<GetStopsResult> {
    const form = new FormData()
    form.set("children", "no")
    const req = await ApiFetch<Stop[]>(`stops`, { method: "POST", body: form })
    if (!req.ok) {
        return { error: req.error, stops: null };
    }
    return { error: undefined, stops: req.data }
}
