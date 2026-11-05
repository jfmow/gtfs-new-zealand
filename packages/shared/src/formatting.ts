/**
 * Text and time formatting with no platform or timezone-library needs.
 * (The web's moment-based countdowns stay in `frontend/lib/formating.ts`
 * until they're ported.)
 */

export function secondsToMinSec(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds
    return `${minutes}min ${formattedSeconds}sec`
}

export function addSecondsToTime(timeStr: string, secondsToAdd: number): string {
    let [hours, minutes, seconds] = timeStr.split(":").map(Number)
    let totalSeconds = hours * 3600 + minutes * 60 + seconds

    totalSeconds += secondsToAdd

    hours = Math.floor(totalSeconds / 3600)
    totalSeconds %= 3600
    minutes = Math.floor(totalSeconds / 60)
    seconds = totalSeconds % 60

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

export function convert24hTo12h(time24: string): string {
    const [rawHours, minutes] = time24.split(":").map(Number)
    // GTFS times can be >= 24:00:00 for service that runs past midnight
    // (still "today" in GTFS terms) - wrap back into 0-23 so e.g. "24:06:00"
    // reads as 12:06 AM (tomorrow's clock time) instead of 12:06 PM.
    const hours = rawHours % 24
    const period = hours >= 12 ? "PM" : "AM"
    const hours12 = hours % 12 || 12
    const formattedMinutes = minutes.toString().padStart(2, "0")
    return `${hours12}:${formattedMinutes} ${period}`
}

export function formatTextToNiceLookingWords(words: string, retainDigits: boolean = false): string {
    if (!retainDigits) {
        try {
            words = words.replace(/\d+/g, "") // Remove any digits if retainDigits is false
        } catch { /* not a string */ }
    }
    try {
        return words
            .replace(/\s{2,}/g, " ")
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, (char) => char.toUpperCase())
    } catch {
        return words
    }
}

const SMALL_WORDS = new Set(["via", "to", "and", "of", "the", "at"])

/**
 * A headsign as riders read it - feeds shout ("HILLSBORO") or title-case
 * every word ("Pukekohe Via Grafton"), and AT trains carry bare numbers
 * ("Swanson 1 To Manukau 1"). Title case, small joining words lower case,
 * short codes like "NX1" kept. Same as iOS `Headsign.display`.
 */
export function headsignDisplay(text: string): string {
    return text
        .replace(/\s{2,}/g, " ")
        .trim()
        .split(" ")
        .filter((w) => w && !/^\d+$/.test(w))
        .map((word, i) => {
            const lower = word.toLowerCase()
            if (i > 0 && SMALL_WORDS.has(lower)) return lower
            if (word.length <= 3 && /\d/.test(word)) return word
            return lower.charAt(0).toUpperCase() + lower.slice(1)
        })
        .join(" ")
}

/** "Avondale Train Station 105" -> "Avondale Train Station": the code is for search. */
export function cleanStopName(name: string): string {
    return name.replace(/\s+\d{3,6}$/, "")
}
