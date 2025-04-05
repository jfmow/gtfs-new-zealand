import { lazy, Suspense, useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import { ChevronDown, TriangleAlert } from "lucide-react"
const LeafletMap = lazy(() => import('../map/index'));
import LoadingSpinner from "../loading-spinner"
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "../ui/drawer"
import { Button } from "../ui/button"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { GeoJSON } from "./geojson-types";
import { convertSecondsToTimeNoDecimal, formatDistance } from "@/lib/utils";
import { TrainsApiResponse } from "../services/types";
import { ApiFetch } from "@/lib/url-context";

interface NavigateProps {
    start: { lat: number, lon: number, name: string },
    end: { lat: number, lon: number, name: string }
}

export default function Navigate({ start, end }: NavigateProps) {
    const [data, setData] = useState<OSRMResponse | null>(null)

    async function getPoints() {

        if (start.lat === 0 || start.lon === 0) return
        if (end.lat === 0 || end.lon === 0) return

        const form = new FormData()

        form.set("startLat", `${start.lat}`)
        form.set("startLon", `${start.lon}`)
        form.set("endLat", `${end.lat}`)
        form.set("endLon", `${end.lon}`)

        form.set("method", "walking")

        try {
            const response = await ApiFetch(`map/nav`, { method: "POST", body: form });
            if (!response.ok) {
                openNavigation(end.lat, end.lon)
                return
            }
            const data: TrainsApiResponse<OSRMResponse> = await response.json();

            let filteredData = data.data;

            filteredData = { ...filteredData, travelTime: Math.floor(data.data.duration / 60) }

            setData(filteredData)
        } catch (e) {
            console.error(e)
            openNavigation(end.lat, end.lon)
        }
    }

    useEffect(() => {
        getPoints()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (start.lat === 0 || start.lon === 0) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Heads up!</AlertTitle>
                <AlertDescription>
                    Your location is disabled so we can&apos;t provide walking directions
                </AlertDescription>
            </Alert>

        )
    }

    return (
        <>
            <div className="mb-2 min-h-[400px]">
                <div className="my-2 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground ">Walking time: {convertSecondsToTimeNoDecimal(data?.duration || 0)}</p>
                    <p className="text-sm text-muted-foreground ">Distance: {formatDistance(data?.distance || 0)}</p>
                </div>
                {data && Object.keys(data).length >= 3 ? (
                    <>
                        <div className="w-full rounded-xl overflow-hidden">

                            <Suspense>
                                <LeafletMap mapID={"nav-map"} height={"400px"} variant={"userLocation"} navPoints={data as unknown as GeoJSON} mapItems={[{
                                    lat: end.lat, lon: end.lon, icon: "stop marker",
                                    id: "",
                                    routeID: "",
                                    zIndex: 0,
                                    description: ""
                                }]} />
                            </Suspense>
                        </div>
                    </>
                ) : (
                    <LoadingSpinner height={"400px"} description="Loading map..." />
                )}
            </div>
            <Drawer>
                <DrawerTrigger asChild>
                    <Button className="w-full">
                        Directions List
                    </Button>
                </DrawerTrigger>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle>Walking directions to {end.name}</DrawerTitle>
                    </DrawerHeader>
                    <div className='px-4 my-2 max-h-[30vh] overflow-y-scroll'>
                        <ol className='list-decimal'>
                            {data && Object.keys(data).length >= 3 && data.instructions.split(", ").map((item, index) => {
                                return (
                                    <>
                                        <li key={index} className={`flex flex-col items-center justify-center`}>
                                            <p >
                                                {formatTextToNiceLookingWords(item, true)}
                                            </p>
                                            {index < data.instructions.split(", ").length - 1 ? (
                                                <ChevronDown className='w-4 h-4' />
                                            ) : null}
                                        </li>
                                    </>
                                )
                            })}
                        </ol>
                    </div>
                    <DrawerFooter>
                        <DrawerClose>
                            <Button className="w-full" variant="outline">Close</Button>
                        </DrawerClose>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
            <p className="text-xs font-medium leading-none p-2 my-2 text-center text-red-400">DIRECTIONS MAY NOT BE 100% ACCURATE OR SAFE. Always take care when around roads and in unfamiliar places</p>

        </>
    )
}



export function openNavigation(lat: number, lon: number) {
    // Check if the user is on iOS (Apple Maps)
    if (
        (navigator.platform.indexOf("iPhone") !== -1) ||
        (navigator.platform.indexOf("iPad") !== -1) ||
        (navigator.platform.indexOf("iPod") !== -1)
    ) {
        window.open(`http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`, '_blank');
    }
    // Check if the user has Google Maps (use for Android or web browsers)
    else if (navigator.userAgent.toLowerCase().indexOf('android') > -1 || window.navigator.userAgent.indexOf('Chrome') > -1) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
    }
    // Default to Google Maps for desktop
    else {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
    }
}

export interface OSRMResponse {
    type: string;
    features: Feature[];
    instructions: string;
    duration: number;
    travelTime: number;
    distance: number;
}

export interface Feature {
    type: string;
    geometry: Geometry;
    properties: null;
}

export interface Geometry {
    type: string;
    coordinates: Array<number[]>;
}
