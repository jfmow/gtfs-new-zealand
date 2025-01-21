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
        if (stopName === "") {
            return;
        }

        // Create EventSource instance
        const eventSource = new EventSource(`${process.env.NEXT_PUBLIC_TRAINS}/at/services/${stopName}`);

        // Handle incoming messages
        eventSource.onmessage = (event) => {
            try {
                const parsedData = JSON.parse(event.data);

                if (Object.keys(parsedData).length === 0) {
                    return;
                }

                // Identify the trip ID
                const tripId = parsedData.service_data.trip_id;

                if (tripId) {
                    setServices((prevServices) => {
                        // Create a new list of services
                        const updatedServices = [...prevServices];

                        // Check if the service is already in the list
                        const existingServiceIndex = updatedServices.findIndex(
                            (item) => item.service_data.trip_id === tripId
                        );

                        if (existingServiceIndex !== -1) {
                            // If service already exists, check if it's already marked as done
                            const existingService = updatedServices[existingServiceIndex];

                            if (existingService.service_data.trip_id === tripId && existingService.response_done) {
                                return prevServices; // No update needed
                            }

                            // Otherwise, update the existing service
                            updatedServices[existingServiceIndex] = parsedData;
                        } else {
                            // Add new service to the list
                            updatedServices.push(parsedData);
                        }

                        return updatedServices; // Return the updated list
                    });
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
    }, [stopName]); // Cleanup and re-initiate on stopName change


    return (
        <>
            {services.length >= 1 ? (
                <ul className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
                    {services.sort((a, b) => new Date(a.service_data.arrival_time).getTime() - new Date(b.service_data.arrival_time).getTime()).map(({ service_data, vehicle, trip_update, has }, index) => (
                        <li key={index}>
                            <Card>
                                <CardHeader>
                                    <CardTitle>
                                        <div className="flex items-center justify-between overflow-hidden">
                                            <div className="shrink flex-1 truncate">
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

                                        <ServiceTrackerModal currentStop={service_data} targetStopId={services[0].service_data.stop_id} tripUpdate={trip_update} vehicle={vehicle} has={has.vehicle} routeColor={service_data.route_color} />
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






function removeShortHands(name: string) {
    let newName = name;
    if (name.endsWith("/N")) { // Check if the name ends with "/N"
        newName = name.replace("/N", " via Newmarket"); // Replace "/N" with " via Newmarket"
    }
    return newName;
}