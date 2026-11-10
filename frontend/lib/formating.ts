import moment from "moment-timezone"
import { convert24hTo12h } from "@transit/shared/formatting"
import { regionTimeZone } from "./url-store"

// The platform-free helpers live in the shared package (packages/shared/src/formatting.ts).
// The moment-based countdowns and browser geolocation stay here for now.
export {
    secondsToMinSec,
    addSecondsToTime,
    convert24hTo12h,
    formatTextToNiceLookingWords,
    headsignDisplay,
    cleanStopName,
} from "@transit/shared/formatting"

export function timeTillArrival(arrivalTime: string): number {
    // Now on the region's clock - GTFS times are in its timezone
    const nowInRegion = moment().tz(regionTimeZone());

    // Parse the arrival time string on that same clock
    const [hours, minutes, seconds] = arrivalTime.split(':').map(Number);
    const target = moment.tz(nowInRegion.format('YYYY-MM-DD'), regionTimeZone())
        .set({ hour: hours, minute: minutes, second: seconds });

    // Calculate the difference in minutes
    const diffInMinutes = target.diff(nowInRegion, 'minutes');

    return diffInMinutes;
}

export function timeTillArrivalString(arrivalTime: string): string {
    // Now on the region's clock - GTFS times are in its timezone
    const nowInRegion = moment().tz(regionTimeZone());

    // Parse the arrival time string on that same clock
    const [hours, minutes, seconds] = arrivalTime.split(':').map(Number);
    const target = moment.tz(nowInRegion.format('YYYY-MM-DD'), regionTimeZone())
        .set({ hour: hours, minute: minutes, second: seconds });

    // Calculate the difference
    const diffInMinutes = target.diff(nowInRegion, 'minutes');
    const diffInHours = target.diff(nowInRegion, 'hours');
    const diffInDays = target.diff(nowInRegion, 'days');

    if (diffInMinutes < 0) {
        return "Departed"; // Handles past times
    }
    if (diffInMinutes === 0) {
        return "Now"; // Handles past times
    }

    if (diffInMinutes < 60) {
        return `${diffInMinutes} min`;
    } else if (diffInHours < 24) {
        const hours = Math.floor(diffInMinutes / 60);
        const minutes = diffInMinutes % 60;
        return `${hours} hr${hours > 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} min` : ''}`;
    } else {
        return `${diffInDays} day${diffInDays > 1 ? 's' : ''}`;
    }
}



/** Like `timeTillArrivalString`, but for an arrival time already expressed as epoch ms. */
export function timeTillArrivalMsString(arrivalMs: number): string {
    const nowInRegion = moment().tz(regionTimeZone());
    const target = moment.tz(arrivalMs, regionTimeZone());

    const diffInMinutes = target.diff(nowInRegion, 'minutes');
    const diffInHours = target.diff(nowInRegion, 'hours');
    const diffInDays = target.diff(nowInRegion, 'days');

    if (diffInMinutes < 0) {
        return "Departed";
    }
    if (diffInMinutes === 0) {
        return "Now";
    }
    if (diffInMinutes < 60) {
        return `${diffInMinutes} min`;
    } else if (diffInHours < 24) {
        const hours = Math.floor(diffInMinutes / 60);
        const minutes = diffInMinutes % 60;
        return `${hours} hr${hours > 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} min` : ''}`;
    } else {
        return `${diffInDays} day${diffInDays > 1 ? 's' : ''}`;
    }
}

export const formatUnixTime = (unixTime: number | null | undefined) => {
    if (!unixTime) return "00:00 AM";

    const timeString = new Date(unixTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: regionTimeZone() }).replace(':', ':') + ':00';
    const arrivalTime = convert24hTo12h(timeString);

    const minutesTillArrival = timeTillArrival(timeString);
    const formattedTime = minutesTillArrival < 60 ? `${minutesTillArrival} min` :
        minutesTillArrival < 1440 ? `${Math.floor(minutesTillArrival / 60)} hr${minutesTillArrival / 60 > 1 ? 's' : ''}` :
            `${Math.floor(minutesTillArrival / 1440)} day${Math.floor(minutesTillArrival / 1440) > 1 ? 's' : ''}`;

    return minutesTillArrival < 0 ? arrivalTime : `${arrivalTime} (${formattedTime})`;
};

export async function getUserLocation(): Promise<number[]> {
    if (!navigator.geolocation) {
        console.error('Geolocation is not supported by this browser.');
        return [0, 0];
    }

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            console.warn('Geolocation request timed out after 5s.');
            resolve([0, 0]);
        }, 5000);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(timeoutId);
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                resolve([userLat, userLon]);
            },
            (error) => {
                clearTimeout(timeoutId);
                console.error('Error getting location:', error);
                resolve([0, 0]);
            }
        );
    });
}
