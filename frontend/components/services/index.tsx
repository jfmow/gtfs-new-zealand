import { useEffect, useState } from "react"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { TrainsApiResponse } from "./types"
import { convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival, timeTillArrivalString } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"
import { Toggle } from "../ui/toggle"
import { urlStore } from "@/lib/url-store"
import { ApiFetch } from "@/lib/url-context"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
}

interface Service {
    time: number;
    type: "service" | "trip update" | "vehicle"; // "initial" or "update"

    trip_id: string;
    headsign: string;
    arrival_time: string;
    platform: string;
    stops_away: number;
    occupancy: number;
    canceled: boolean;

    route: ServicesRoute;

    tracking: 0 | 1 | 2;

    stop: ServicesStop;
}

interface ServicesRoute {
    id: string;
    name: string;
    color: string;
}

interface ServicesStop {
    id: string;
    lat: number;
    lon: number;
    name: string;
}


export default function Services({ stopName, filterDate }: ServicesProps) {
    const { url } = urlStore.currentUrl
    const [services, setServices] = useState<Service[]>([]);
    const [errorMessage, setErrorMessage] = useState("");
    const [platformFilter, setPlatformFilter] = useState<string | number | undefined>(undefined)

    const getUniquePlatforms = (services: Service[]) => {
        const platforms = services.map(service => service.platform);
        return [...new Set(platforms)].filter((i) => i !== "" && i !== undefined && i !== "no platform").sort((a, b) => {
            if (!isNaN(Number(a)) && !isNaN(Number(b))) {
                return Number(a) - Number(b);
            }
            return a.localeCompare(b);
        });
    };


    useEffect(() => {
        if (stopName === "") {
            return;
        }

        setServices([])

        let eventSource: EventSource | null = null;

        const startEventSource = () => {
            if (!filterDate) {
                eventSource = new EventSource(
                    `${url}/services/${stopName}`
                );

                eventSource.onmessage = (event) => {
                    try {
                        const parsedData: Service = JSON.parse(event.data);

                        if (Object.keys(parsedData).length > 0) {
                            setServices((prev) => [...prev, parsedData]);
                            setErrorMessage("");
                        }
                    } catch (error) {
                        console.error("Error parsing SSE data:", error);
                    }
                };

                eventSource.onerror = () => {
                    console.error("SSE connection error.");
                    setErrorMessage("Failed to fetch data from the server.");
                    if (eventSource) {
                        eventSource.close();
                    }
                };
            } else {
                ApiFetch(
                    `services/${stopName}/schedule?date=${Math.floor(
                        filterDate.getTime() / 1000
                    )}`
                )
                    .then(async (res) => {
                        const data: TrainsApiResponse<Service[]> = await res.json();
                        if (res.ok) {
                            setServices(data.data);
                            setErrorMessage("");
                        } else {
                            console.error(data.message)
                            setErrorMessage("Failed to fetch data from the server.");
                        }
                    })
                    .catch((error) => {
                        console.error("Fetch error:", error);
                        setErrorMessage("Failed to fetch data from the server.");
                    });
            }
        };

        const stopEventSource = () => {
            if (eventSource) {
                eventSource.close();
            }
            eventSource = null;
            setErrorMessage("");
        };

        startEventSource();

        // Visibility change handling
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startEventSource();
            } else if (document.visibilityState === "hidden") {
                stopEventSource();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Cleanup on unmount, visibility change, or dependencies update
        return () => {
            stopEventSource();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [stopName, filterDate, url]);


    return (
        <>

            {errorMessage !== "" ? (
                <Alert className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Uh oh...</AlertTitle>
                    <AlertDescription>
                        {errorMessage}
                    </AlertDescription>
                </Alert>
            ) : null}
            {services.length >= 1 ? (
                <>
                    {getUniquePlatforms(services).length > 0 ? (
                        <div className="mb-2 grid">
                            <div className="flex  gap-2 items-center">
                                {getUniquePlatforms(services).map((platform) => (
                                    <Toggle key={platform} className="w-full" size={"sm"} variant={"outline"} pressed={platformFilter === platform} onPressedChange={(t) => setPlatformFilter(t ? platform : undefined)}>
                                        {platform}
                                    </Toggle>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    <ul className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-hidden">
                        {getService(services).filter((item) => item.platform === platformFilter || platformFilter === undefined).sort((a, b) => timeTillArrival(a.arrival_time) - timeTillArrival(b.arrival_time)).map((service) => (
                            <li key={service.trip_id} className={`overflow-hidden ${service.stops_away <= -1 || timeTillArrival(service.arrival_time) <= -3 ? "hidden" : ""}`}>
                                <Card>
                                    <CardHeader>
                                        <CardTitle>
                                            <div className="flex items-center justify-between overflow-hidden">
                                                <div className="shrink flex-1 truncate overflow-hidden">
                                                    {service.canceled ? (
                                                        <>
                                                            <span className="text-red-500">Canceled | </span>
                                                            <span className="opacity-50">{formatTextToNiceLookingWords(service.headsign)} </span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {service.stops_away <= 0 || (!service.stops_away && timeTillArrival(service.arrival_time) <= 0) ? (
                                                                <>
                                                                    <span className="text-orange-500">Departed | </span>
                                                                    <span className="opacity-50">{formatTextToNiceLookingWords(service.headsign)} </span>
                                                                </>
                                                            ) : (
                                                                <span className="">
                                                                    {formatTextToNiceLookingWords(service.headsign)}
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                                <span
                                                    className="shrink-0 px-2 py-1 rounded text-zinc-100 text-xs"
                                                    style={{ background: "#" + service.route.color }}
                                                >
                                                    {service.route.name}
                                                </span>
                                            </div>
                                        </CardTitle>

                                        <CardDescription>
                                            <div className="">
                                                <p className="">Arriving: {convert24hTo12h(service.arrival_time)}</p>
                                                {service.platform !== "" && service.platform !== "no platform" ? (
                                                    <p className="text-blue-400">Platform: <span className="font-medium">{service.platform}</span></p>
                                                ) : null}
                                                <p>Stops away: {service.stops_away}</p>
                                                <p>Occupancy: <OccupancyStatusIndicator type="message" value={service.occupancy} /></p>
                                            </div>
                                        </CardDescription>
                                    </CardHeader>
                                    {!filterDate ? (
                                        <CardContent>
                                            <div className="grid grid-cols-2 items-center justify-items-center gap-2">
                                                <ServiceTrackerModal currentStop={service.stop} loaded={service.tracking !== 2} has={service.tracking === 1} tripId={service.trip_id} />
                                                <span aria-label="Arriving in" className={`text-center rounded-md font-medium p-1 h-full w-full`}>
                                                    {timeTillArrivalString(service.arrival_time)}
                                                </span>
                                            </div>
                                        </CardContent>
                                    ) : null}
                                </Card>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </>
    )
}

function getService(serviceData: Service[]): Service[] {
    const services = serviceData.filter((item) => item.type === "service").sort((a, b) => b.time - a.time);
    if (services.length === 0) {
        return [];
    }

    const tripUpdates = serviceData.filter((item) => item.type === "trip update").sort((a, b) => b.time - a.time);
    const vehicleUpdates = serviceData.filter((item) => item.type === "vehicle").sort((a, b) => b.time - a.time);

    const seenTripIds = new Set<string>(); // Keep track of trip IDs already processed

    const result: Service[] = []

    services.map((service) => {
        if (!seenTripIds.has(service.trip_id)) {
            seenTripIds.add(service.trip_id)
            const latest_trip_update = tripUpdates.find((item) => item.trip_id === service.trip_id)
            const latest_vehicle_update = vehicleUpdates.find((item) => item.trip_id === service.trip_id)

            result.push({ ...service, ...latest_trip_update, ...latest_vehicle_update, type: "service" })
        }
    })


    return result
}
