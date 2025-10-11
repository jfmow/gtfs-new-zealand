export function secondsToMinSec(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    // Pad seconds with leading zero if necessary
    const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds;

    return `${minutes}min ${formattedSeconds}sec`;
}

export function addSecondsToTime(timeStr: string, secondsToAdd: number): string {
    let [hours, minutes, seconds] = timeStr.split(':').map(Number);
    let totalSeconds = hours * 3600 + minutes * 60 + seconds;

    totalSeconds += secondsToAdd;

    hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    minutes = Math.floor(totalSeconds / 60);
    seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export const formatUnixTime = (unixTime: number | null | undefined) => {
    if (!unixTime) return "00:00 AM";

    const dateObj = new Date(unixTime);
    const timeString = dateObj
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const arrivalTime = convert24hTo12h(timeString);

    const minutesTillArrival = timeTillArrival(timeString);
    const formattedTime = minutesTillArrival < 60 ? `${minutesTillArrival} min` :
        minutesTillArrival < 1440 ? `${Math.floor(minutesTillArrival / 60)} hr${minutesTillArrival / 60 > 1 ? 's' : ''}` :
            `${Math.floor(minutesTillArrival / 1440)} day${Math.floor(minutesTillArrival / 1440) > 1 ? 's' : ''}`;

    return minutesTillArrival < 0 ? arrivalTime : `${arrivalTime} (${formattedTime})`;
};

export function convert24hTo12h(time24: string): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [hours, minutes, seconds] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    const formattedMinutes = minutes.toString().padStart(2, '0');
    //const formattedSeconds = seconds.toString().padStart(2, '0');

    return `${hours12}:${formattedMinutes} ${period}`;
}

import moment from 'moment-timezone';

export function timeTillArrival(arrivalTime: string): number {
    // Get current time in NZ time
    const nowInNZ = moment().tz('Pacific/Auckland');

    // Parse the arrival time string into a moment object in NZ time
    const [hours, minutes, seconds] = arrivalTime.split(':').map(Number);
    const target = moment.tz(nowInNZ.format('YYYY-MM-DD'), 'Pacific/Auckland')
        .set({ hour: hours, minute: minutes, second: seconds });

    // Calculate the difference in minutes
    const diffInMinutes = target.diff(nowInNZ, 'minutes');

    return diffInMinutes;
}

export function timeTillArrivalString(arrivalTime: string): string {
    // Get current time in NZ time
    const nowInNZ = moment().tz('Pacific/Auckland');

    // Parse the arrival time string into a moment object in NZ time
    const [hours, minutes, seconds] = arrivalTime.split(':').map(Number);
    const target = moment.tz(nowInNZ.format('YYYY-MM-DD'), 'Pacific/Auckland')
        .set({ hour: hours, minute: minutes, second: seconds });

    // Calculate the difference
    const diffInMinutes = target.diff(nowInNZ, 'minutes');
    const diffInHours = target.diff(nowInNZ, 'hours');
    const diffInDays = target.diff(nowInNZ, 'days');

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



export function formatTextToNiceLookingWords(words: string, retainDigits: boolean = false): string {
    if (!retainDigits) {
        try {
            words = words.replace(/\d+/g, ''); // Remove any digits if retainDigits is false
        } catch { }
    }
    try {
        return words
            .replace(/\s{2,}/g, ' ') // Remove extra spaces
            .trim() // Trim spaces
            .toLowerCase() // Convert to lowercase
            .replace(/\b\w/g, char => char.toUpperCase()); // Capitalize the first letter of each word
    } catch {
        return words
    }
}

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
