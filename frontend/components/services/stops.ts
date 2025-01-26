import { StopTimeUpdate } from "./types";

export interface StopForTripsData {
    next_stop: {
        lat: number;
        lon: number;
        name: string;
        stop_id: string;
        platformNumber: string;
        index: number;
    };
    final_stop: {
        lat: number;
        lon: number;
        name: string;
        stop_id: string;
        platformNumber: string;
        index: number;
    };
    stops: Stop[];
}

export async function getStopsForTrip(tripId: string, stopTimeUpdate: StopTimeUpdate, filterPassedStops: boolean): Promise<StopForTripsData | null> {
    const response = await getStopsDataForTrip(tripId);
    if (response.error !== undefined) {
        return null
    }

    const currentStopNumber = stopTimeUpdate.stop_sequence
    //const currentStopId = stopTimeUpdate.stop_id

    const stopsData = response.stops
    const stops = stopsData.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const totalNumberOfStops = stops.length;

    const nextStopIndex = Math.min(currentStopNumber, totalNumberOfStops - 1);
    const nextStop = stops[nextStopIndex];
    const finalStop = stops[totalNumberOfStops - 1];

    const [nextStopPlatformNumber, nextStopName] = getPlatformNumberOrLetterFromStopName(nextStop.stop_name);
    const nextStopData = {
        lat: nextStop.stop_lat,
        lon: nextStop.stop_lon,
        name: nextStopName,
        stop_id: nextStop.stop_id,
        platformNumber: nextStopPlatformNumber,
        index: nextStop.stop_sequence - 1,
    };

    const [finalStopPlatformNumber, finalStopName] = getPlatformNumberOrLetterFromStopName(finalStop.stop_name);
    const finalStopData = {
        lat: finalStop.stop_lat,
        lon: finalStop.stop_lon,
        name: finalStopName,
        stop_id: finalStop.stop_id,
        platformNumber: finalStopPlatformNumber,
        index: finalStop.stop_sequence - 1,
    };

    return { next_stop: nextStopData, final_stop: finalStopData, stops: stops.filter((item) => filterPassedStops ? item.stop_sequence > currentStopNumber + 1 : true) };
}

interface Stop {
    stop_lat: number;
    stop_lon: number;
    stop_name: string;
    stop_sequence: number;
    stop_code: string;
    stop_id: string;
}

type GetStopsForTripResult =
    | { error: string; stops: undefined }
    | { error: undefined; stops: Stop[] };

async function getStopsDataForTrip(tripId: string): Promise<GetStopsForTripResult> {
    if (tripId == "") {
        console.warn("Missing trip id");
        return { error: "Missing trip id", stops: undefined };
    }

    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/stops/${tripId}`);

        // Check if the response is OK
        if (!response.ok) {
            const errorMessage = await response.text();
            return { error: errorMessage, stops: undefined };
        }

        // Parse the response JSON and return services
        const stops: Stop[] = await response.json();
        return { error: undefined, stops: stops.map((item, index) => ({ ...item, index })) };
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