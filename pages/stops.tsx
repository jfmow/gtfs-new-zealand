import LoadingSpinner from "@/components/loading-spinner";
import NavBar from "@/components/nav";
import { useUserLocation } from "@/lib/userLocation";
import { lazy, Suspense, useEffect, useState } from "react";

const LeafletMap = lazy(() => import("@/components/map"));
export default function Stops() {
    const { loading, location } = useUserLocation()
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState("")

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
    }, [])

    if (loading) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <NavBar />
            <div className="w-full bg-zinc-50 text-zinc-800">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">

                    {error !== "" ? (
                        "Err: " + error
                    ) : (
                        <Suspense fallback={<LoadingSpinner description="Loading map..." height="100svh" />}>
                            <LeafletMap mapItems={[...(stops ? (
                                stops.map((item) => ({
                                    lat: item.stop_lat,
                                    lon: item.stop_lon,
                                    icon: "dot",
                                    id: item.stop_name + " " + item.stop_code,
                                    routeID: "",
                                    description: item.stop_name + " " + item.stop_code,
                                    zIndex: 1,
                                    onClick: () => window.location.href = `/?s=${encodeURIComponent(item.stop_name + " " + item.stop_code)}`
                                }))
                            ) : [])]} zoom={17} mapID={"abcd"} height={"calc(100svh - 2rem - 70px)"} userLocation={location[0] === 0 ? [-36.85971694520651, 174.76042890091796] : location} variant={"userLocation"} />
                        </Suspense>
                    )}
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
    const req = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/stops?noChildren=1`)
    if (!req.ok) {
        const errorMessage = await req.text()
        return { error: errorMessage, stops: null };
    }
    const res: Stop[] = await req.json()
    return { error: undefined, stops: res }
}