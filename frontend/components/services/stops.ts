import { ServicesStop } from "./tracker";
import { ApiFetch } from "@/lib/url-context";

export interface StopForTripsData {
    current_stop?: {
        lat: number;
        lon: number;
        name: string;
        stop_id: string;
        platformNumber: string;
        sequence: number;
    };
    next_stop?: {
        lat: number;
        lon: number;
        name: string;
        stop_id: string;
        platformNumber: string;
        sequence: number;
    };
    final_stop?: {
        lat: number;
        lon: number;
        name: string;
        stop_id: string;
        platformNumber: string;
        sequence: number;
    };
    stops: ServicesStop[];
}

export async function getStopsForTrip(tripId: string, currentStopId: string, nextStopId: string): Promise<StopForTripsData | null> {
    const response = await getStopsDataForTrip(tripId);
    if (response.error !== undefined) {
        return null
    }

    const stopsData = response.stops
    const stops = stopsData.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const totalNumberOfStops = stops.length;
    const finalStop = stops.find((item) => item.id === stops[totalNumberOfStops - 1].id);
    if (!finalStop) {
        return { stops: stops };
    }
    const [finalStopPlatformNumber, finalStopName] = getPlatformNumberOrLetterFromStopName(finalStop.name);
    const finalStopData = {
        lat: finalStop.lat,
        lon: finalStop.lon,
        name: finalStopName,
        stop_id: finalStop.id,
        platformNumber: finalStopPlatformNumber,
        sequence: finalStop.sequence
    };

    if (currentStopId !== "" && nextStopId !== "") {
        const currentStop = stops.find((item) => item.id === currentStopId)
        const nextStop = stops.find((item) => item.id === nextStopId)

        if (!nextStop || !finalStop || !currentStop) {
            console.warn("Missing next or final or current stop");
            return null
        }

        const [currentStopPlatformNumber, currentStopName] = getPlatformNumberOrLetterFromStopName(currentStop.name);
        const currentStopData = {
            lat: nextStop.lat,
            lon: nextStop.lon,
            name: currentStopName,
            stop_id: currentStop.id,
            platformNumber: currentStopPlatformNumber,
            sequence: nextStop.sequence
        };

        const [nextStopPlatformNumber, nextStopName] = getPlatformNumberOrLetterFromStopName(nextStop.name);
        const nextStopData = {
            lat: nextStop.lat,
            lon: nextStop.lon,
            name: nextStopName,
            stop_id: nextStop.id,
            platformNumber: nextStopPlatformNumber,
            sequence: nextStop.sequence
        };



        const modifiedStops = stops.map((stop) => {
            if (stop.sequence < nextStopData.sequence) {
                return { ...stop, passed: true }
            }
            return stop
        })
        return { next_stop: nextStopData, final_stop: finalStopData, stops: modifiedStops, current_stop: currentStopData };
    }

    return { stops: stops, final_stop: finalStopData };

}



type GetStopsForTripResult =
    | { error: string; stops: undefined }
    | { error: undefined; stops: ServicesStop[] };

async function getStopsDataForTrip(tripId: string): Promise<GetStopsForTripResult> {
    if (tripId == "") {
        console.warn("Missing trip id");
        return { error: "Missing trip id", stops: undefined };
    }

    try {
        const response = await ApiFetch<ServicesStop[]>(`stops/${tripId}`);

        // Check if the response is OK
        if (!response.ok) {
            return { error: response.error, stops: undefined };
        }

        // Parse the response JSON and return services
        return { error: undefined, stops: response.data.map((item, index) => ({ ...item, index })) };
    } catch (error) {
        // Handle unexpected errors
        return { error: (error as Error).message, stops: undefined };
    }
}

type PlatformInfo = [string, string];

export function getPlatformNumberOrLetterFromStopName(stopName: string = ""): PlatformInfo {
    if (!stopName) {
        return ["", ""];
    }

    // Regex for Train Station with number
    const trainStationRegex = /Train Station (\d+)$/;
    const trainStationMatch = stopName.match(trainStationRegex);

    // Regex for Stop with letter
    const stopRegex = /Stop ([A-Z])\s+(.*)/;
    const stopMatch = stopName.match(stopRegex);

    if (trainStationMatch) {
        const number = trainStationMatch[1]; // The captured number
        const nameWithoutNumber = stopName.replace(/ Train Station \d+$/, " Train Station"); // Remove the number
        return [number, nameWithoutNumber];
    } else if (stopMatch) {
        const letter = stopMatch[1]; // The captured letter
        const nameWithoutLetter = stopMatch[2]; // The rest of the stop name
        return [letter, nameWithoutLetter];
    } else {
        return ["", stopName]; // No matches, return original name
    }
}