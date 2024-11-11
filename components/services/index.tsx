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
import { Service } from "./types"
import { addSecondsToTime, convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"

interface ServicesProps {
    stopName: string
}

export default function Services({ stopName }: ServicesProps) {
    const [services, setServices] = useState<Service[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    useEffect(() => {

        async function getData() {
            const result = await getServicesAtStop(stopName);
            if (result.error !== undefined) {
                setErrorMessage(result.error);
            } else {
                setServices(result.services);
                setErrorMessage("");
            }
        }

        getData(); // Initial fetch

        // Set up an interval to refresh the data every 15 seconds
        const intervalId = setInterval(getData, 15000);

        // Clean up the interval when the component unmounts or stopName changes
        return () => clearInterval(intervalId);
    }, [stopName]);

    return (
        <>
            {services.length >= 1 ? (
                <ul className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
                    {services.map(({ service_data, vehicle, trip_update, has }, index) => (
                        <li key={index}>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        <div className="flex items-center justify-between overflow-hidden">
                                            <div className="shrink flex-1 truncate">
                                                {service_data.stop_sequence - trip_update.stop_time_update.stop_sequence <= 0 && timeTillArrival(addSecondsToTime(service_data.arrival_time, trip_update.delay)) <= 2 ? (
                                                    <>
                                                        <span className="text-orange-500">Departed | </span>
                                                        <span className="opacity-50">{formatTextToNiceLookingWords(removeShortHands(service_data.stop_headsign))} </span>
                                                    </>
                                                ) : (
                                                    <span className="truncate">
                                                        {formatTextToNiceLookingWords(removeShortHands(service_data.stop_headsign))}
                                                    </span>
                                                )}
                                            </div>
                                            <span
                                                className="shrink-0 bg-zinc-400 p-2 rounded text-zinc-100"
                                                style={service_data.route_color !== "" ? { background: "#" + service_data.route_color } : {}}
                                            >
                                                {service_data.trip_data.route_id}
                                            </span>
                                        </div>
                                    </CardTitle>

                                    <CardDescription>
                                        <p>Scheduled: {convert24hTo12h(service_data.arrival_time)}</p>
                                        <p className="underline text-blue-400">Predicted: {convert24hTo12h(addSecondsToTime(service_data.arrival_time, trip_update.delay))}</p>
                                        <p className="text-pink-400 underline">Platform: {service_data.platform}</p>
                                        <p>Stops away: {timeTillArrival(trip_update.trip.start_time) > 0 ? ("Not in service yet") : (service_data.stop_sequence - trip_update.stop_time_update.stop_sequence - 1)}</p>
                                        <p>Occupancy: <OccupancyStatusIndicator type="message" value={vehicle.occupancy_status} /></p>

                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 items-center justify-items-center">

                                        <ServiceTrackerModal targetStopName={stopName} tripUpdate={trip_update} vehicle={vehicle} has={has.vehicle} routeColor={service_data.route_color} />
                                        <span aria-label="Arriving in">
                                            {timeTillArrival(addSecondsToTime(service_data.arrival_time, trip_update.delay))}min
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        </li>
                    ))}
                </ul>
            ) : null}

            {errorMessage !== "" ? (
                <Alert className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Uh oh...</AlertTitle>
                    <AlertDescription>
                        {errorMessage}
                    </AlertDescription>
                </Alert>
            ) : null}
        </>
    )
}



type GetServicesAtStopResult =
    | { error: string; services: undefined }
    | { error: undefined; services: Service[] };

async function getServicesAtStop(stopName: string): Promise<GetServicesAtStopResult> {
    // Ensure the stop name length is valid
    if (stopName.length <= 3) {
        console.warn("Stop name must be >3 char");
        return { error: "", services: undefined };
    }


    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/services/${stopName}`);

        // Check if the response is OK
        if (!response.ok) {
            const errorMessage = await response.text();
            return { error: errorMessage, services: undefined };
        }

        // Parse the response JSON and return services
        const services: Service[] = await response.json();
        return { error: undefined, services: services.filter((item) => (timeTillArrival(addSecondsToTime(item.service_data.arrival_time, item.trip_update.delay)) >= 0) && (!item.service_data.stop_headsign.toLowerCase().includes("non stopping"))).sort((a, b) => timeTillArrival(addSecondsToTime(a.service_data.arrival_time, a.trip_update.delay)) - timeTillArrival(addSecondsToTime(b.service_data.arrival_time, b.trip_update.delay))) };
    } catch (error) {
        // Handle unexpected errors
        return { error: (error as Error).message, services: undefined };
    }
}



function removeShortHands(name: string) {
    let newName = name;
    if (name.endsWith("/N")) { // Check if the name ends with "/N"
        newName = name.replace("/N", " via Newmarket"); // Replace "/N" with " via Newmarket"
    }
    return newName;
}