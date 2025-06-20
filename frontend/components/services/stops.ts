import { ServicesStop } from "./tracker";
import { ApiFetch } from "@/lib/url-context";


export async function getStopsForTrip(tripId: string): Promise<ServicesStop[] | null> {
    const response = await getStopsDataForTrip(tripId);
    if (!response.ok) {
        console.warn("Failed to fetch stops for trip:", response.error);
        return null
    }

    const stopsData = response.stops
    const stops = stopsData.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    return stops;

}



type GetStopsForTripResult =
    | { error: string, ok: false }
    | { stops: ServicesStop[], ok: true };

async function getStopsDataForTrip(tripId: string): Promise<GetStopsForTripResult> {
    if (tripId == "") {
        console.warn("Missing trip id");
        return { error: "Missing trip id", ok: false };
    }

    try {
        const response = await ApiFetch<ServicesStop[]>(`stops/${tripId}`);

        // Check if the response is OK
        if (!response.ok) {
            return { error: response.error, ok: false };
        }

        // Parse the response JSON and return services
        return { ok: true, stops: response.data.map((item, index) => ({ ...item, index })) };
    } catch (error) {
        // Handle unexpected errors
        return { error: (error as Error).message, ok: false };
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