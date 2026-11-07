import * as Notifications from "expo-notifications"
import { SchedulableTriggerInputTypes } from "expo-notifications"
import { Platform } from "react-native"
import { upcomingMoments, type JourneyMoment } from "@transit/shared/logic/offline"
import type { Leg } from "@transit/shared/types/journey"

/**
 * The journey's key moments as scheduled local notifications - iOS
 * `JourneyOfflineNotifications`. Rescheduled from the latest live times on
 * every tick, so they fire with the app in the background or offline (the
 * server's pushes cover the rest when there's a connection).
 */

const PREFIX = "journey-moment:"
let appliedSignature = ""
let desiredMoments: JourneyMoment[] | null = null
/** Bumped by resetMoments: a schedule still in flight when the journey ends must not put its reminders back. */
let generation = 0
let reconciliation = Promise.resolve()

export async function scheduleMoments(legs: Leg[], progressLegIndex: number, onboard: boolean, setOff: boolean, tz: string, planId: string, region: string): Promise<void> {
    const moments = upcomingMoments(legs, progressLegIndex, onboard, new Date(), tz, setOff)
        // Rounded to the minute so second-by-second feed wobble doesn't reschedule.
        .map((m) => ({ ...m, date: new Date(Math.round(m.date.getTime() / 60_000) * 60_000) }))
    desiredMoments = moments
    const gen = generation
    reconciliation = reconciliation.catch(() => {}).then(async () => {
        if (gen !== generation || desiredMoments === null || signatureOf(desiredMoments) === appliedSignature) return
        await reconcileMoments(desiredMoments, gen, planId, region)
    })
    await reconciliation
}

function signatureOf(moments: JourneyMoment[]) {
    return moments.map((m) => `${m.key}@${m.date.getTime()}`).join("|")
}

async function reconcileMoments(moments: JourneyMoment[], gen: number, planId: string, region: string) {
    const signature = signatureOf(moments)
    const { granted } = await Notifications.getPermissionsAsync()
    if (!granted || gen !== generation) return
    await cancelMoments()
    for (const m of moments) {
        if (gen !== generation || signatureOf(desiredMoments ?? []) !== signature) return
        await scheduleOne(m, planId, region)
    }
    appliedSignature = signature
}

async function scheduleOne(m: JourneyMoment, planId: string, region: string) {
    if (m.date.getTime() <= Date.now() + 5_000) return
    await Notifications.scheduleNotificationAsync({
        identifier: PREFIX + m.key,
        content: {
            title: m.title,
            body: m.body,
            data: { kind: "journey", url: `/journey?id=${encodeURIComponent(planId)}&region=${encodeURIComponent(region)}&track=1` },
            sound: "default",
            interruptionLevel: "timeSensitive",
        },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: m.date, ...(Platform.OS === "android" ? { channelId: "journey" } : {}) },
    })
}

export async function cancelMoments() {
    const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
    await Promise.all(all.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})))
}

export function resetMoments() {
    generation += 1
    desiredMoments = null
    appliedSignature = ""
    reconciliation = reconciliation.catch(() => {}).then(cancelMoments)
    return reconciliation
}
