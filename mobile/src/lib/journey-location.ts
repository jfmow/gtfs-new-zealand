import * as Location from "expo-location"
import * as TaskManager from "expo-task-manager"
import type { GPSMode } from "@transit/shared/logic/tracking"
import type { Coordinate } from "@transit/shared/models"

/**
 * GPS for a tracked journey, kept running with the screen off - iOS
 * `LocationProvider.setJourneyBackgroundUpdates` + `setGPSMode`. Started
 * from the foreground with "While Using" permission (no "Always" prompt,
 * same as the SwiftUI app); iOS shows the blue location pill while it runs,
 * Android a foreground-service notification.
 *
 * The task must be defined at startup (module scope), before iOS relaunches
 * the app in the background to deliver a fix - this file is imported by the
 * root layout.
 */
export const JOURNEY_LOCATION_TASK = "journey-location"

export interface JourneyFix {
    coordinate: Coordinate
    accuracy: number | null
    speed: number | null
    timestamp: number
}

let latest: JourneyFix | null = null
const listeners = new Set<(f: JourneyFix) => void>()

/** The newest journey fix (null before the first). */
export const getJourneyFix = () => latest

/** Called with every fix, foreground or background. */
export function onJourneyFix(listener: (f: JourneyFix) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(JOURNEY_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return
    const loc = data.locations[data.locations.length - 1]
    latest = {
        coordinate: { lat: loc.coords.latitude, lon: loc.coords.longitude },
        accuracy: loc.coords.accuracy ?? null,
        speed: loc.coords.speed ?? null,
        timestamp: loc.timestamp,
    }
    listeners.forEach((l) => l(latest!))
})

/** How much GPS each mode uses - the SwiftUI app's `setGPSMode` table. */
const MODES: Record<GPSMode, { accuracy: Location.Accuracy; distanceInterval: number }> = {
    // Riding a live-tracked vehicle far from your stop: the feed says where you are.
    resting: { accuracy: Location.Accuracy.Lowest, distanceInterval: 500 },
    coarse: { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
    pedestrian: { accuracy: Location.Accuracy.High, distanceInterval: 10 },
    precise: { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0 },
}

let current: GPSMode | null = null

/** Start journey GPS, or change its mode. Safe to call repeatedly. */
export async function setJourneyLocationMode(mode: GPSMode) {
    if (mode === current) return
    const { granted } = await Location.getForegroundPermissionsAsync()
    if (!granted) return
    const m = MODES[mode]
    try {
        await Location.startLocationUpdatesAsync(JOURNEY_LOCATION_TASK, {
            accuracy: m.accuracy,
            distanceInterval: m.distanceInterval,
            timeInterval: mode === "precise" ? 2_000 : 5_000,
            // On foot vs riding, so Core Location filters and paces fixes for it.
            activityType: mode === "pedestrian" ? Location.ActivityType.Fitness : Location.ActivityType.OtherNavigation,
            // Let the OS suspend stationary low-power fixes while preserving
            // updates in motion. Precise navigation stays uninterrupted.
            pausesUpdatesAutomatically: mode !== "precise",
            showsBackgroundLocationIndicator: true,
            foregroundService: {
                notificationTitle: "Following your journey",
                notificationBody: "Transit uses your location to tell you when to get off.",
                notificationColor: "#173A2A",
                killServiceOnDestroy: true,
            },
        })
        current = mode
    } catch {
        current = null
    }
}

/** The journey's over: stop the GPS. */
export async function stopJourneyLocation() {
    current = null
    latest = null
    try {
        if (await Location.hasStartedLocationUpdatesAsync(JOURNEY_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(JOURNEY_LOCATION_TASK)
    } catch {
        /* not running */
    }
}
