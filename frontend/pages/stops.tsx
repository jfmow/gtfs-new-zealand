import LoadingSpinner from "@/components/loading-spinner";
import { Header } from "@/components/nav";
import ErrorScreen from "@/components/ui/error-screen";
import { ApiFetch, useUrl } from "@/lib/url-context";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
const LeafletMap = dynamic(() => import("../components/map/map"), {
    ssr: false,
});


export default function Stops() {
    return (
        <>
            <Header title="Stops map" />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col px-4 pb-4">
                    <StopsMap customTailwindHeight="calc(100svh - 60px - 2rem)" />
                </div>
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
export function StopsMap({ customTailwindHeight }: { customTailwindHeight?: string }) {
    const [stops, setStops] = useState<Stop[]>()
    const [error, setError] = useState("")
    const [parentHeight, setParentHeight] = useState<string>("auto")
    const containerRef = useRef<HTMLDivElement>(null)
    const { currentUrl } = useUrl()

    // --- Fetch Stops ---
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

    // --- Once loaded, crawl up the DOM tree to get parent's height ---
    useEffect(() => {
        const updateHeight = () => {
            if (!containerRef.current) return

            let parent: HTMLElement | null = containerRef.current.parentElement
            // Crawl up until we find a parent with measurable height
            while (parent && parent.offsetHeight === 0) {
                parent = parent.parentElement
            }

            if (parent) {
                const height = parent.getBoundingClientRect().height
                setParentHeight(`${height}px`)
            }
        }

        updateHeight()

        // React to resize or layout changes
        window.addEventListener("resize", updateHeight)
        const observer = new ResizeObserver(updateHeight)
        const observedParent: HTMLElement | null | undefined = containerRef.current?.parentElement
        if (observedParent) observer.observe(observedParent)

        return () => {
            window.removeEventListener("resize", updateHeight)
            observer.disconnect()
        }
    }, [])

    if (error !== "") {
        return (
            <ErrorScreen
                errorTitle="An error occurred while loading the stops"
                errorText={error}
            />
        )
    }

    const finalHeight =
        customTailwindHeight && customTailwindHeight !== ""
            ? customTailwindHeight
            : parentHeight !== "auto"
                ? parentHeight
                : "calc(100svh - 2rem - 70px)"

    return (
        <div ref={containerRef} className="flex-grow flex flex-col">
            <Suspense fallback={<LoadingSpinner description="Loading map..." height="100svh" />}>
                <LeafletMap
                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                    map_id={MAPID}
                    mapItems={
                        stops
                            ? stops.map((item) => ({
                                lat: item.stop_lat,
                                lon: item.stop_lon,
                                icon: "dot",
                                id: item.stop_name + " " + item.stop_code,
                                routeID: "",
                                description: {
                                    text: item.stop_name + " " + item.stop_code,
                                    alwaysShow: false,
                                },
                                zIndex: 1,
                                type: "stop",
                                onClick: () =>
                                (window.location.href = `/?s=${encodeURIComponent(
                                    item.stop_name + " " + item.stop_code
                                )}`),
                            }))
                            : []
                    }
                    height={finalHeight}
                />
            </Suspense>
        </div>
    )
}