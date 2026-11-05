import { Platform } from "react-native"
import type { LiveActivityContent } from "@transit/shared/logic/live-content"
import type { JourneyProgressSnapshot } from "@transit/shared/logic/tracking"
import { getRegionSlug, type Region } from "@transit/shared/regions"
import { TransitNative } from "../../modules/transit-native/src"
import { api } from "./api"
import { activeJourneyStore } from "./journey-session"
import { savedStopsStore } from "./saved"

/**
 * The journey on the Lock Screen - iOS `LiveActivityCoordinator`. iOS: one
 * Live Activity per journey, its push token registered with the server (so
 * the 20 s cron keeps it current while the app is suspended) and the leg
 * reported on every change. Android: the ongoing live notification.
 */

let activityId: string | null = null
let activityPlan: string | null = null
let lastReported = ""
let lastAlertKey = ""
let starting = false
/** The journey just ended - late updates for it must not start a new Live Activity (and re-register it with the server). */
let endedPlan: string | null = null
const warned = new Set<string>()
/** One console warning per distinct problem - a silent failure here is what hid missing Live Activities. */
function warnOnce(key: string, message: string) {
    if (warned.has(key)) return
    warned.add(key)
    console.warn(`[live-activity] ${message}`)
}

let tokenSub: ReturnType<typeof TransitNative.addListener> = null
function listenForTokens(region: string) {
    if (tokenSub) return
    tokenSub = TransitNative.addListener("onActivityPushToken", (e) => {
        api.startLiveActivity(e.planId, e.id, e.token, region, __DEV__ ? "sandbox" : "production").catch(() => {})
    })
    TransitNative.addListener("onPushToStartToken", (e) => {
        import("./api").then(async ({ deviceIdentity }) => api.updateIOSDeviceToken(await deviceIdentity, "", "", e.token)).catch(() => {})
    })
}

/** Called on every tracker tick with the latest content. */
export async function updateLiveSurface(planId: string, destination: string, region: Region, content: LiveActivityContent, snapshot: JourneyProgressSnapshot) {
    if (planId === endedPlan) {
        // The same journey started again (from the planner or a link) - let it through.
        if (startedAgain(planId)) endedPlan = null
        else return
    }
    const slug = getRegionSlug(region)
    // A moment worth expanding the Dynamic Island / alerting for, once each.
    const alertKey = `${snapshot.progressLegIndex}:${snapshot.phase}:${snapshot.trackedStopsAway === 0}`
    const alert = alertKey !== lastAlertKey && (content.urgent || snapshot.phase === "boarding" || (snapshot.phase === "onboard" && snapshot.trackedStopsAway === 0))
        ? { title: content.primaryText, body: content.secondaryText }
        : undefined
    lastAlertKey = alertKey

    if (Platform.OS === "android") {
        TransitNative.showLiveNotification(content, planId, !!alert)
        return
    }
    // Ask regardless: `areActivitiesEnabled` can read false before the system
    // has ever seen a request from this app, and a request that's really
    // refused just throws (caught below).
    if (!TransitNative.liveActivitiesEnabled()) warnOnce("off", "areActivitiesEnabled is false - requesting anyway")
    listenForTokens(slug)
    if (activityPlan !== planId || !activityId) {
        if (starting) return
        starting = true
        try {
            const id = await TransitNative.startActivity(planId, destination, slug, content)
            // Ended while it was starting: don't leave it (or its server registration) behind.
            if (planId === endedPlan) {
                if (id) { api.endLiveActivity(id).catch(() => {}); TransitNative.endActivity(id).catch(() => {}) }
                return
            }
            activityId = id
            activityPlan = planId
        } catch (e) {
            warnOnce(`start:${String(e)}`, `Couldn't start the Live Activity: ${String(e)}`)
            activityId = null
        } finally {
            starting = false
        }
        return
    }
    await TransitNative.updateActivity(activityId, content, alert).catch(() => {})

    // The server's floor: it never moves its own state behind what the phone reports.
    const report = `${content.legIndex}:${content.phase}`
    if (report !== lastReported) {
        lastReported = report
        api.reportLiveActivityLeg(activityId, content.legIndex, content.phase).catch(() => {})
    }
}

export async function endLiveSurface(planId?: string) {
    if (planId) { endedPlan = planId; endedAt = Date.now() }
    if (Platform.OS === "android") {
        TransitNative.cancelLiveNotification()
    } else {
        // Every activity iOS still has, not just the one this launch started - after a
        // relaunch the server would otherwise keep pushing to the old one.
        const ids = new Set([...(activityId ? [activityId] : []), ...TransitNative.activeActivities().map((a) => a.id)])
        for (const id of ids) api.endLiveActivity(id).catch(() => {})
        await TransitNative.endActivity().catch(() => {})
    }
    activityId = null
    activityPlan = null
    lastReported = ""
    lastAlertKey = ""
}

/** The rider started this journey again after ending it. */
function startedAgain(planId: string) {
    const active = activeJourneyStore.get()
    return active?.planId === planId && active.startedAt > endedAt
}
let endedAt = 0

/** Mirrors the region and saved stops into the app group for the widgets and Siri (SharedStore keys). */
export function syncWidgetData(region: Region) {
    const slug = getRegionSlug(region)
    TransitNative.setSharedString("regionSlug", slug)
    const stops = savedStopsStore.get().filter((s) => s.region === slug).map((s) => ({ query: s.query, title: s.name, colorHex: (s.color ?? "").replace("#", "") }))
    TransitNative.setSharedJSON("savedStops", stops)
    TransitNative.reloadWidgets()
}
