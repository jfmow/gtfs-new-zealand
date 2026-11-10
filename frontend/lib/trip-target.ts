import { useEffect, useState } from "react"
import notification from "@/lib/notifications"

/**
 * "Your stop" on a tracked trip - the app's trip-live.ts. The rider picks a
 * stop in the trip tracker (tapping it sets an arrival reminder there; the
 * bell's reminders pick it too). It's kept per trip in this browser, so the
 * tracker shows it again when reopened, and clearing it cancels its reminders.
 */

export type TripReminderType = "get_off" | "arrival" | "n_stops_away"

export interface TripTarget {
    stopSeq: number
    parentStopId: string
    childStopId: string
    name: string
    lat: number
    lon: number
    reminders: TripReminderType[]
    at: number
}

const KEY = "tripTargets"
const EVENT = "tripTargetsUpdated"
const DAY_MS = 24 * 60 * 60_000

function readAll(): Record<string, TripTarget> {
    if (typeof window === "undefined") return {}
    try {
        const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, TripTarget>
        // A trip id is only good for its service day.
        return Object.fromEntries(Object.entries(all).filter(([, t]) => Date.now() - t.at < DAY_MS))
    } catch {
        return {}
    }
}

function writeAll(all: Record<string, TripTarget>) {
    try {
        localStorage.setItem(KEY, JSON.stringify(all))
    } catch { /* storage unavailable - the pick lasts until reload */ }
    window.dispatchEvent(new CustomEvent(EVENT))
}

export function useTripTarget(tripId: string | undefined): TripTarget | null {
    const [all, setAll] = useState<Record<string, TripTarget>>({})
    useEffect(() => {
        setAll(readAll())
        const handler = () => setAll(readAll())
        window.addEventListener(EVENT, handler)
        return () => window.removeEventListener(EVENT, handler)
    }, [])
    return tripId ? all[tripId] ?? null : null
}

type TargetStop = Omit<TripTarget, "reminders" | "at">

/**
 * Makes `stop` the trip's stop with a `type` reminder. Moving to another stop
 * cancels the old stop's other reminders. Returns false when the reminder
 * couldn't be set (notifications off or blocked) - the stop isn't picked then.
 */
export async function setTripReminder(tripId: string, stop: TargetStop, type: TripReminderType, offset?: number): Promise<boolean> {
    const ok = await notification.addReminder(stop.parentStopId || stop.childStopId, tripId, type, offset)
    if (!ok) return false
    markTripTarget(tripId, stop, type)
    return true
}

/** Records the trip's stop after a reminder was set elsewhere (the bell's dialog). */
export function markTripTarget(tripId: string, stop: TargetStop, type: TripReminderType) {
    const all = readAll()
    const prev = all[tripId]
    const sameStop = prev && prev.stopSeq === stop.stopSeq
    if (prev && !sameStop) {
        // Reminders are one per type per device - the new one replaced its own type already.
        for (const r of prev.reminders) if (r !== type) notification.removeReminder(r).catch(() => { })
    }
    const reminders = sameStop ? Array.from(new Set([...prev.reminders, type])) : [type]
    writeAll({ ...all, [tripId]: { ...stop, reminders, at: Date.now() } })
}

/** Clears the trip's stop and cancels its reminders. */
export function clearTripTarget(tripId: string) {
    const all = readAll()
    const prev = all[tripId]
    if (!prev) return
    delete all[tripId]
    writeAll(all)
    for (const r of prev.reminders) notification.removeReminder(r).catch(() => { })
}
