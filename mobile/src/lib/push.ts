import * as Notifications from "expo-notifications"
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications"
import { router } from "expo-router"
import { Platform } from "react-native"
import { parseDeepLink } from "@transit/shared/logic/deeplink"
import { api, deviceIdentity } from "./api"
import { openDeepLink } from "./links"
import { currentRegion } from "./region"
import { activeJourneyStore } from "./journey-session"

/**
 * Push setup - iOS `PushRegistrationService`. The device registers its id +
 * secret, then sends this launch's raw push token: APNs on iOS (the backend
 * already speaks APNs), FCM on Android (backend phase 1). Not Expo's push
 * service - the backend sends directly.
 */

Notifications.setNotificationHandler({
    handleNotification: async (n) => {
        // Journey moments are shown in-app while the tracker is open (it shows the same alert).
        const kind = (n.request.content.data as Record<string, unknown> | undefined)?.kind
        const quiet = kind === "journey" && journeyTrackerOpen
        return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false }
    },
})

let journeyTrackerOpen = false
export function setJourneyTrackerOpen(open: boolean) {
    journeyTrackerOpen = open
}

/** Android channels the backend's FCM messages target (`fcmAndroidChannel`). */
async function ensureAndroidChannels() {
    if (Platform.OS !== "android") return
    await Notifications.setNotificationChannelAsync("journey", {
        name: "Journey moments",
        description: "Time to leave, get on now, get off next",
        importance: AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
    })
    await Notifications.setNotificationChannelAsync("alerts", {
        name: "Service alerts and reminders",
        importance: AndroidImportance.DEFAULT,
    })
}

export async function notificationsAllowed(): Promise<boolean> {
    const s = await Notifications.getPermissionsAsync()
    return s.granted || s.ios?.status === IosAuthorizationStatus.PROVISIONAL
}

/** Asks for permission (only when the rider turns on something that needs it). */
export async function requestNotifications(): Promise<boolean> {
    await ensureAndroidChannels()
    if (await notificationsAllowed()) return true
    const s = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: false } })
    const ok = s.granted
    if (ok) registerForPush().catch(() => {})
    return ok
}

/** The last registration sent (region + token), so nothing is re-sent that the server already has. */
let lastSent = ""
let inFlight: Promise<void> | null = null

async function upload(token: string) {
    const identity = await deviceIdentity
    const key = `${currentRegion().url}|${token}`
    if (key === lastSent) return
    lastSent = key
    const res = Platform.OS === "android"
        ? await api.registerAndroidDevice(identity, token)
        // A dev build talks to the APNs sandbox; TestFlight/App Store to production.
        // The backend retries the other environment on BadDeviceToken anyway.
        : await api.registerIOSDevice(identity, token, __DEV__ ? "sandbox" : "production")
    if (!res.ok) lastSent = "" // try again next launch / region change
}

/**
 * Registers the device and uploads its push token - once per launch and
 * region, however often it's called. (Never call this from the push-token
 * listener: getDevicePushTokenAsync fires that listener, which looped
 * ~1,000 registrations a second and hit the rate limit.)
 */
export function registerForPush(): Promise<void> {
    inFlight ??= (async () => {
        await ensureAndroidChannels()
        // Without permission there's no token, but register anyway: subscriptions and reminders hang off the device row.
        const token = (await notificationsAllowed()) ? String((await Notifications.getDevicePushTokenAsync()).data) : ""
        await upload(token)
    })().finally(() => {
        inFlight = null
    })
    return inFlight
}

/** Routes notification taps (the payload's `url`, as the backend sends it). */
export function listenForNotificationTaps(): () => void {
    const handle = (response: Notifications.NotificationResponse | null) => {
        const url = (response?.notification.request.content.data as Record<string, unknown> | undefined)?.url
        if (typeof url === "string" && parseDeepLink(url)) openDeepLink(url)
        else if (response) {
            const data = response.notification.request.content.data as Record<string, unknown>
            const active = activeJourneyStore.get()
            if (data.kind === "journey" && active) router.push({ pathname: "/journey/track/[id]", params: { id: active.planId } })
            else router.push("/(tabs)/updates")
        }
    }
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(handle)
    // A rotated token: upload the one we're given (no new token request - see registerForPush).
    const tokenSub = Notifications.addPushTokenListener((t) => {
        upload(String(t.data)).catch(() => {})
    })
    return () => {
        sub.remove()
        tokenSub.remove()
    }
}
