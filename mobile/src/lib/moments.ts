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
let scheduled = ""
/** Bumped by resetMoments: a schedule still in flight when the journey ends must not put its reminders back. */
let generation = 0

export async function scheduleMoments(legs: Leg[], progressLegIndex: number, onboard: boolean, setOff: boolean, tz: string): Promise<void> {
    const moments = upcomingMoments(legs, progressLegIndex, onboard, new Date(), tz, setOff)
        // Rounded to the minute so second-by-second feed wobble doesn't reschedule.
        .map((m) => ({ ...m, date: new Date(Math.round(m.date.getTime() / 60_000) * 60_000) }))
    const signature = moments.map((m) => `${m.key}@${m.date.getTime()}`).join("|")
    if (signature === scheduled) return
    scheduled = signature
    const gen = generation
    await cancelMoments()
    for (const m of moments) {
        if (gen !== generation) return
        await scheduleOne(m)
    }
    // Ended while the last one was being scheduled: take them all back out.
    if (gen !== generation) await cancelMoments()
}

async function scheduleOne(m: JourneyMoment) {
    if (m.date.getTime() <= Date.now() + 5_000) return
    await Notifications.scheduleNotificationAsync({
        identifier: PREFIX + m.key,
        content: { title: m.title, body: m.body, data: { kind: "journey" }, sound: "default", interruptionLevel: "timeSensitive" },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: m.date, ...(Platform.OS === "android" ? { channelId: "journey" } : {}) },
    }).catch(() => {})
}

export async function cancelMoments() {
    const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
    await Promise.all(all.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})))
}

export function resetMoments() {
    scheduled = ""
    generation += 1
    return cancelMoments()
}
