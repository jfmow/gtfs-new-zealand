import LoadingSpinner from "@/components/loading-spinner";
import { TrainsApiResponse } from "@/components/services/types";
import { ApiFetch } from "@/lib/url-context";
import Head from "next/head";
import { lazy, Suspense, useEffect, useState } from "react";

const LeafletMap = lazy(() => import("@/components/map"));
export default function Stops() {
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

    if (!stops) {
        return <LoadingSpinner height="100svh" />
    }

    return (
        <>
            <Header />
            <div className="w-full">
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
                            ) : [])]} zoom={17} mapID={"abcd"} height={"calc(100svh - 2rem - 70px)"} variant={"userLocation"} />
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
    const req = await ApiFetch(`stops?noChildren=1`)
    const data: TrainsApiResponse<Stop[]> = await req.json()
    if (!req.ok) {
        console.error(data.message)
        return { error: data.message, stops: null };
    }
    return { error: undefined, stops: data.data }
}



function Header() {
    return (
        <Head>
            <title>Stops</title>

            <link rel="manifest" href="manifest.json" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="application-name" content="Trains" />
            <meta name="apple-mobile-web-app-title" content="Trains" />
            <meta name="theme-color" content="#ffffff" />
            <meta name="msapplication-navbutton-color" content="#ffffff" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="msapplication-starturl" content="/" />
            <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
            <link rel='icon' type='image/png' href={`/Favicon.png`} />
            <link rel="apple-touch-icon" href={`/Favicon.png`} />
            <link rel="shortcut icon" href={`/Favicon.png`} />

            <meta name="description" content="Find your stop" />
            <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
            <link rel="canonical" href="https://trains.suddsy.dev/"></link>
            <meta property="og:title" content="Find your closest stop" />
            <meta property="og:url" content="https://trains.suddsy.dev/" />
            <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
            <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
        </Head>
    )
}