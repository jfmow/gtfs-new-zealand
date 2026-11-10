import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core"
import { Platform } from "react-native"

/**
 * Live Activities (iOS), the live journey notification (Android) and the
 * widgets' shared store. Optional: Expo Go and the web have none of it, so
 * every call is a no-op there.
 */
type Events = {
    onActivityPushToken: (e: { id: string; planId: string; token: string }) => void
    onPushToStartToken: (e: { token: string }) => void
    onActivityStarted: (e: { id: string; planId: string }) => void
    onActivityEnded: (e: { id: string; planId: string }) => void
    onTripActivityPushToken: (e: { id: string; tripId: string; token: string }) => void
    onTripActivityEnded: (e: { id: string; tripId: string }) => void
}

interface Native {
    setSharedString(key: string, value: string | null): void
    setSharedJSON(key: string, json: string): void
    reloadWidgets(): void
    liveActivitiesEnabled(): boolean
    activeActivities(): { id: string; planId: string }[]
    startActivity?(planId: string, destinationLabel: string, regionSlug: string, contentJSON: string): Promise<string>
    updateActivity?(id: string, contentJSON: string, alertTitle: string | null, alertBody: string | null): Promise<void>
    endActivity?(id: string | null): Promise<void>
    activeTripActivities?(): { id: string; tripId: string; stopId: string }[]
    startTripActivity?(attributesJSON: string, contentJSON: string): Promise<string>
    updateTripActivity?(id: string, contentJSON: string, alertTitle: string | null, alertBody: string | null): Promise<void>
    endTripActivity?(id: string | null): Promise<void>
    showLiveNotification?(contentJSON: string, planId: string, alert: boolean): void
    cancelLiveNotification?(): void
    readLegacyStore?(): LegacyStore | null
    addListener<K extends keyof Events>(name: K, listener: Events[K]): EventSubscription
}

/** What the SwiftUI app had saved (iOS only). */
export interface LegacyStore {
    region: string
    stops: { stopId: string; name: string; color?: string; sortOrder?: number }[]
    places: { name: string; lat: number; lon: number; icon?: string; region?: string }[]
    trips: { name: string; startLabel: string; startLat: number; startLon: number; endLabel: string; endLat: number; endLon: number; color?: string }[]
}

const native = requireOptionalNativeModule<Native>("TransitNative")

export const TransitNative = {
    available: !!native,
    setSharedString: (key: string, value: string | null) => native?.setSharedString(key, value),
    setSharedJSON: (key: string, value: unknown) => native?.setSharedJSON(key, JSON.stringify(value)),
    reloadWidgets: () => native?.reloadWidgets(),
    liveActivitiesEnabled: () => (Platform.OS === "ios" ? native?.liveActivitiesEnabled() ?? false : false),
    activeActivities: () => native?.activeActivities() ?? [],
    startActivity: (planId: string, destinationLabel: string, regionSlug: string, content: unknown) => native?.startActivity?.(planId, destinationLabel, regionSlug, JSON.stringify(content)) ?? Promise.resolve(null),
    updateActivity: (id: string, content: unknown, alert?: { title: string; body: string }) => native?.updateActivity?.(id, JSON.stringify(content), alert?.title ?? null, alert?.body ?? null) ?? Promise.resolve(),
    endActivity: (id?: string) => native?.endActivity?.(id ?? null) ?? Promise.resolve(),
    activeTripActivities: () => native?.activeTripActivities?.() ?? [],
    startTripActivity: (attributes: unknown, content: unknown) => native?.startTripActivity?.(JSON.stringify(attributes), JSON.stringify(content)) ?? Promise.resolve(null),
    updateTripActivity: (id: string, content: unknown, alert?: { title: string; body: string }) => native?.updateTripActivity?.(id, JSON.stringify(content), alert?.title ?? null, alert?.body ?? null) ?? Promise.resolve(),
    endTripActivity: (id?: string) => native?.endTripActivity?.(id ?? null) ?? Promise.resolve(),
    showLiveNotification: (content: unknown, planId: string, alert = false) => native?.showLiveNotification?.(JSON.stringify(content), planId, alert),
    cancelLiveNotification: () => native?.cancelLiveNotification?.(),
    readLegacyStore: (): LegacyStore | null => native?.readLegacyStore?.() ?? null,
    addListener<K extends keyof Events>(name: K, listener: Events[K]): EventSubscription | null {
        return native ? native.addListener(name, listener) : null
    },
}
