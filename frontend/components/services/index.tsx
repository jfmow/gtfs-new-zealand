import { useEffect, useState } from "react"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, Loader2 } from "lucide-react"
import { Service } from "./types"
import { addSecondsToTime, convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival, timeTillArrivalString } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
}

interface SSEData {
    type: "service_data" | "vehicle" | "trip_update"
    data: Service
    time: number
}

export default function Services({ stopName, filterDate }: ServicesProps) {
    const [services, setServices] = useState<SSEData[]>([]);
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        if (stopName === "") {
            return;
        }

        // Check if filterDate is null
        if (!filterDate) {
            // Use EventSource instance
            const eventSource = new EventSource(`${process.env.NEXT_PUBLIC_TRAINS}/at/services/${stopName}`);

            // Handle incoming messages
            eventSource.onmessage = (event) => {
                try {
                    const parsedData: SSEData = JSON.parse(event.data);

                    if (Object.keys(parsedData).length > 0) {
                        setServices((prev) => [...prev, parsedData]);
                        setErrorMessage("")
                    }
                } catch (error) {
                    console.error("Error parsing SSE data:", error);
                }
            };

            // Handle errors
            eventSource.onerror = () => {
                console.error("SSE connection error.");
                setErrorMessage("Failed to fetch data from the server.");
                eventSource.close();
            };

            // Cleanup function on unmount or stopName change
            return () => {
                eventSource.close();
            };
        } else {
            // Log the filterDate instead of using EventSource
            fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/services/${stopName}/schedule?date=${Math.floor(filterDate.getTime() / 1000)}`).then(async (res) => {
                if (res.ok) {
                    const data = await res.json()
                    setServices(data)
                    setErrorMessage("")
                } else {
                    setErrorMessage("Failed to fetch data from the server.");
                }
            })
        }
        return () => {
            setServices([]);
            setErrorMessage("")
        }
    }, [stopName, filterDate]);




    return (
        <>
            {services.length >= 1 && errorMessage === "" ? (
                <ul className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
                    {getService(services).filter((item) => (item.service_data.stop_sequence - item.trip_update.stop_time_update.stop_sequence - 1) >= 0).sort((a, b) => timeTillArrival(addSecondsToTime(a.service_data.arrival_time, a.trip_update.delay)) - timeTillArrival(addSecondsToTime(b.service_data.arrival_time, b.trip_update.delay))).map(({ service_data, vehicle, trip_update, has, done }, index) => (
                        <li key={index}>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        <div className="flex items-center justify-between overflow-hidden">
                                            <div className="shrink flex-1 truncate">
                                                {trip_update.trip.schedule_relationship === 3 ? (
                                                    <>
                                                        <span className="text-red-500">Cancled | </span>
                                                        <span className="opacity-50">{formatTextToNiceLookingWords(removeShortHands(service_data.stop_headsign || service_data.trip_data.trip_headsign))} </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {service_data.stop_sequence - trip_update.stop_time_update.stop_sequence <= 0 && timeTillArrival(addSecondsToTime(service_data.arrival_time, trip_update.delay)) <= 2 ? (
                                                            <>
                                                                <span className="text-orange-500">Departed | </span>
                                                                <span className="opacity-50">{formatTextToNiceLookingWords(removeShortHands(service_data.stop_headsign || service_data.trip_data.trip_headsign))} </span>
                                                            </>
                                                        ) : (
                                                            <span className="truncate">
                                                                {formatTextToNiceLookingWords(removeShortHands(service_data.stop_headsign || service_data.trip_data.trip_headsign))}
                                                            </span>
                                                        )}
                                                    </>
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
                                    {!filterDate ? (
                                        <div className="grid grid-cols-2 items-center justify-items-center">
                                            <ServiceTrackerModal loaded={done.vehicle} currentStop={service_data} targetStopId={getService(services)[0].service_data.stop_id} tripUpdate={trip_update} vehicle={vehicle} has={has.vehicle} routeColor={service_data.route_color} />
                                            <span aria-label="Arriving in">
                                                {!done.trip_update ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                                ) : (
                                                    <>
                                                        {timeTillArrivalString(addSecondsToTime(service_data.arrival_time, trip_update.delay))}
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                    ) : null}
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

function getService(serviceData: SSEData[]): Service[] {
    const services = serviceData.filter((item) => item.type === "service_data");
    if (services.length === 0) {
        return [];
    }

    const tripUpdates = serviceData.filter((item) => item.type === "trip_update").sort((a, b) => b.time - a.time);
    const vehicleUpdates = serviceData.filter((item) => item.type === "vehicle").sort((a, b) => b.time - a.time);

    const seenTripIds = new Set<string>(); // Keep track of trip IDs already processed

    return services.reduce((result, service) => {
        const tripId = service.data.trip_id;
        if (seenTripIds.has(tripId)) {
            return result; // Skip duplicate trip IDs
        }
        seenTripIds.add(tripId); // Mark trip ID as processed

        const trip = tripUpdates.find((item) => item.data.trip_id === tripId)?.data;
        const vehicle = vehicleUpdates.find((item) => item.data.trip_id === tripId)?.data;

        if (trip && trip.done.trip_update) {
            service.data.done.trip_update = true;
            if (trip.has.trip_update) {
                service.data.trip_update = trip.trip_update;
                service.data.has.trip_update = true;
            }
        }

        if (vehicle && vehicle.done.vehicle) {
            service.data.done.vehicle = true;
            if (vehicle.has.vehicle) {
                service.data.vehicle = vehicle.vehicle;
                service.data.has.vehicle = true;
            }
        }

        result.push(service.data);
        return result;
    }, [] as Service[]);
}





function removeShortHands(name: string) {
    let newName = name;
    if (name.endsWith("/N")) { // Check if the name ends with "/N"
        newName = name.replace("/N", " via Newmarket"); // Replace "/N" with " via Newmarket"
    }
    return newName;
}