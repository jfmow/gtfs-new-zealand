import { Platform } from "react-native"
import { TransitNative } from "../../modules/transit-native/src"
import { api } from "./api"
import { stored, useStored } from "./storage"

/**
 * "Your stop" on a tracked trip (not a journey) and its Live Activity.
 *
 * The rider picks a stop in the trip tracker - tapping it (an arrival
 * reminder) or through the bell's reminder sheet (get off / arriving / N
 * stops before). That stop is kept here per trip, so the tracker shows it
 * again when reopened (and from the Live Activity's link). On iOS a trip
 * Live Activity counts the vehicle down to it: the tracker writes it while
 * it's open, and the server (trip_activity.go) pushes it while it isn't,
 * sending the reminder itself as the activity's alert.
 */

export type TripReminderType = "get_off" | "arrival" | "n_stops_away"

export interface TripTarget {
    stopSeq: number
    /** Parent station when there is one - what reminders are set against. */
    stopId: string
    stopName: string
    /** The reminders set for this stop, so clearing it cancels them. */
    reminders: TripReminderType[]
    at: number
}

/** TripActivityAttributes - static for the activity's life. */
export interface TripActivityAttributes {
    tripID: string
    regionSlug: string
    stopID: string
    stopName: string
    routeShortName: string
    routeColorHex: string
    headsign: string
    vehicleMode: string
    kind: "get_off" | "arrival"
}

/** TripActivityAttributes.ContentState (and the server's tripActivityState). */
export interface TripActivityContent {
    version: number
    phase: "coming" | "next" | "gone" | "cancelled"
    targetUnix: number
    delayMinutes: number
    stopsAway?: number
    nextStopName?: string
    hasVehicle: boolean
    isRealtime: boolean
    skipped: boolean
    occupancy?: number
    updatedUnix: number
}

const DAY_MS = 24 * 60 * 60_000
const tripTargetsStore = stored<Record<string, TripTarget>>("trip-targets", {}, (raw) => {
    // Drop old trips - a trip id is only good for its service day.
    const all = (raw ?? {}) as Record<string, TripTarget>
    return Object.fromEntries(Object.entries(all).filter(([, t]) => Date.now() - t.at < DAY_MS))
})

export function useTripTarget(tripId: string | undefined): TripTarget | null {
    const [all] = useStored(tripTargetsStore)
    return tripId ? all[tripId] ?? null : null
}

/** The activity's kind follows the reminders: get off if one says so. */
export function activityKind(t: TripTarget): "get_off" | "arrival" {
    return t.reminders.includes("get_off") ? "get_off" : "arrival"
}

/**
 * Sets a reminder for `stop` on this trip and makes it the trip's target.
 * Moving to a different stop cancels the reminders set for the old one.
 * Returns the server's error, or null.
 */
export async function setTripReminder(tripId: string, stop: { seq: number; stopId: string; name: string }, type: TripReminderType, offset?: number): Promise<string | null> {
    const res = await api.addTripReminder(tripId, stop.stopId, type, offset)
    if (!res.ok) return res.error
    const prev = tripTargetsStore.get()[tripId]
    const sameStop = prev && prev.stopSeq === stop.seq
    if (prev && !sameStop) {
        // Reminders are one per type per device - the new one replaced its own type already.
        for (const r of prev.reminders) if (r !== type) api.removeTripReminder(r).catch(() => {})
    }
    const reminders = sameStop ? Array.from(new Set([...prev.reminders, type])) : [type]
    tripTargetsStore.set((all) => ({ ...all, [tripId]: { stopSeq: stop.seq, stopId: stop.stopId, stopName: stop.name, reminders, at: Date.now() } }))
    return null
}

/** Clears the trip's stop: its reminders, and its Live Activity. */
export async function clearTripTarget(tripId: string) {
    const prev = tripTargetsStore.get()[tripId]
    if (!prev) return
    tripTargetsStore.set((all) => {
        const { [tripId]: _, ...rest } = all
        return rest
    })
    for (const r of prev.reminders) api.removeTripReminder(r).catch(() => {})
    await endTripLive(tripId)
}

// ─── Live Activity (iOS) ───

interface Running {
    id: string
    tripId: string
    key: string
    /** What the server needs to keep it current - sent once its push token arrives. */
    register: { region: string; stopId: string; stopSequence: number; scheduledUnix: number; kind: string }
}

let running: Running | null = null
let starting = false
let lastSent: { comparable: string; key: string; at: number } | null = null
let lastReport = 0
const tokens = new Map<string, string>()
let listening = false

/** Changes the rider wouldn't notice go at most this often; phase and stop count changes at once. */
const MINOR_UPDATE_MS = 15_000
const RESEND_UNCHANGED_MS = 3 * 60_000
/** The server leaves the activity alone while it's heard from the app in the last 100 s. */
const REPORT_EVERY_MS = 25_000
const GONE_SHOWN_MS = 2 * 60_000
let goneAt: number | null = null

function listen() {
    if (listening) return
    listening = true
    TransitNative.addListener("onTripActivityPushToken", (e) => {
        tokens.set(e.id, e.token)
        if (running?.id === e.id) registerWithServer(running, e.token)
    })
    TransitNative.addListener("onTripActivityEnded", (e) => {
        api.endTripLiveActivity(e.id).catch(() => {})
        if (running?.id === e.id) running = null
    })
}

function registerWithServer(r: Running, token: string) {
    api.startTripLiveActivity({
        activityId: r.id,
        pushToken: token,
        region: r.register.region,
        env: __DEV__ ? "sandbox" : "production",
        tripId: r.tripId,
        stopId: r.register.stopId,
        stopSequence: r.register.stopSequence,
        scheduledUnix: r.register.scheduledUnix,
        kind: r.register.kind,
    }).catch(() => {})
}

/**
 * Called on every tracker refresh while the trip has a target with a
 * reminder: starts the Live Activity the first time (or when the stop
 * changes), then keeps it current.
 */
export async function updateTripLive(attributes: TripActivityAttributes, content: TripActivityContent, scheduledUnix: number, stopSeq: number) {
    if (Platform.OS !== "ios" || !TransitNative.available) return
    listen()
    const key = `${attributes.tripID}|${attributes.stopID}|${stopSeq}|${attributes.kind}`
    if (!running || running.key !== key) {
        // Never start one for a vehicle that's already been to the stop.
        if (starting || content.phase === "gone") return
        starting = true
        try {
            const id = await TransitNative.startTripActivity(attributes, content)
            if (!id) return
            if (running && running.id !== id) api.endTripLiveActivity(running.id).catch(() => {})
            running = {
                id,
                tripId: attributes.tripID,
                key,
                register: { region: attributes.regionSlug, stopId: attributes.stopID, stopSequence: stopSeq, scheduledUnix, kind: attributes.kind },
            }
            lastSent = { comparable: comparable(content), key: stageKey(content), at: Date.now() }
            lastReport = Date.now()
            const token = tokens.get(id)
            if (token) registerWithServer(running, token)
        } catch (e) {
            console.warn(`[trip-live-activity] Couldn't start: ${String(e)}`)
        } finally {
            starting = false
        }
        return
    }
    const now = Date.now()
    // Been and gone: leave "Arrived" up a couple of minutes, then end it
    // (the server does the same, this covers it not hearing of the activity).
    if (content.phase === "gone") {
        goneAt ??= now
        if (now - goneAt > GONE_SHOWN_MS) {
            await endTripLive(attributes.tripID)
            return
        }
    } else goneAt = null
    const c = comparable(content)
    const stage = stageKey(content)
    const due = !lastSent
        || (c === lastSent.comparable ? now - lastSent.at >= RESEND_UNCHANGED_MS : stage !== lastSent.key || now - lastSent.at >= MINOR_UPDATE_MS)
    if (due) {
        lastSent = { comparable: c, key: stage, at: now }
        await TransitNative.updateTripActivity(running.id, content).catch(() => {})
    }
    if (now - lastReport >= REPORT_EVERY_MS) {
        lastReport = now
        api.reportTripLiveActivity(running.id).catch(() => {})
    }
}

/** Ends the trip's Live Activity (every one, without a trip id). */
export async function endTripLive(tripId?: string) {
    if (Platform.OS !== "ios") return
    const ids = TransitNative.activeTripActivities().filter((a) => !tripId || a.tripId === tripId).map((a) => a.id)
    if (running && (!tripId || running.tripId === tripId)) ids.push(running.id)
    for (const id of new Set(ids)) {
        api.endTripLiveActivity(id).catch(() => {})
        await TransitNative.endTripActivity(id).catch(() => {})
    }
    if (!tripId || running?.tripId === tripId) {
        running = null
        lastSent = null
    }
}

function comparable(c: TripActivityContent): string {
    const { updatedUnix: _, ...rest } = c
    // The countdown wobbling by under 30 s isn't worth an update.
    return JSON.stringify({ ...rest, targetUnix: Math.round(rest.targetUnix / 30) })
}

const stageKey = (c: TripActivityContent) => `${c.phase}|${c.stopsAway ?? ""}|${c.skipped ? 1 : 0}`
