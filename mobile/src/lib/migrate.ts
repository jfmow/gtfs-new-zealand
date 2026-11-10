import AsyncStorage from "@react-native-async-storage/async-storage"
import { Platform } from "react-native"
import { TransitNative } from "../../modules/transit-native/src"
import { savedPlacesStore, savedStopsStore, savedTripsStore, settingsStore, type PlaceKind } from "./saved"

const DONE_KEY = "migrated-from-swiftui"

/**
 * One-off: bring the SwiftUI app's saved stops, places and trips over when
 * this app replaces it as dev.suddsy.transit (decision 3). Reads its
 * SwiftData store natively; runs once, never overwrites anything saved here.
 */
export async function migrateFromSwiftUIApp(): Promise<number> {
    if (Platform.OS !== "ios") return 0
    if (await AsyncStorage.getItem(DONE_KEY)) return 0
    await Promise.all([savedStopsStore.ready, savedPlacesStore.ready, savedTripsStore.ready, settingsStore.ready])
    const legacy = TransitNative.readLegacyStore()
    await AsyncStorage.setItem(DONE_KEY, String(Date.now()))
    if (!legacy) return 0
    const region = legacy.region || "at"
    // Ids and addedAt come from the content, not the clock: two devices that
    // had the same iCloud-synced SwiftUI store migrate to the same items, and
    // addedAt is the "first seen" time iCloud sync uses (cloud-sync.ts), so a
    // migrated copy never brings back something deleted in this app since.
    const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-")

    savedStopsStore.set((prev) => [
        ...prev,
        ...legacy.stops
            .filter((s) => s.stopId && !prev.some((p) => p.region === region && p.stopId === s.stopId))
            .map((s, i) => ({ query: s.stopId, stopId: s.stopId, name: s.name || s.stopId, code: "", lat: 0, lon: 0, type: "other", region, color: s.color ? `#${s.color.replace("#", "")}` : undefined, addedAt: i })),
    ])
    savedPlacesStore.set((prev) => [
        ...prev,
        ...legacy.places.map((p) => {
            const kind: PlaceKind = /home|house/i.test(p.icon ?? p.name) ? "home" : /work|briefcase/i.test(p.icon ?? p.name) ? "work" : "other"
            return { id: kind === "other" ? `legacy-${slug(p.name)}` : kind, kind, label: p.name, lat: p.lat, lon: p.lon, region: p.region || region }
        }).filter((p) => !prev.some((q) => q.region === p.region && q.id === p.id)),
    ])
    savedTripsStore.set((prev) => [
        ...prev,
        ...legacy.trips.map((t, i) => ({
            id: `legacy-${slug(t.name)}-${[t.startLat, t.startLon, t.endLat, t.endLon].map((n) => n.toFixed(4)).join(",")}`, name: t.name || `${t.startLabel} to ${t.endLabel}`, region,
            from: { label: t.startLabel, lat: t.startLat, lon: t.startLon }, to: { label: t.endLabel, lat: t.endLat, lon: t.endLon },
            color: t.color ? `#${t.color.replace("#", "")}` : undefined, addedAt: i,
        })),
    ])
    // They've used the app before - no welcome screen, and keep their iCloud choice.
    settingsStore.set((s) => ({ ...s, onboarded: true, iCloudSync: legacy.cloudSyncEnabled ?? true }))
    return legacy.stops.length + legacy.places.length + legacy.trips.length
}
