import AsyncStorage from "@react-native-async-storage/async-storage"
import { AppState } from "react-native"
import { docFromList, listFromDoc, mergeDocs, parseDoc, type SyncDoc } from "@transit/shared/sync-merge"
import { TransitNative } from "../../modules/transit-native/src"
import { driveStore } from "./drive-store"
import { savedPlacesStore, savedStopsStore, savedTripsStore, settingsStore } from "./saved"
import { stored, useStored, type Stored } from "./storage"

/**
 * Sync of saved stops, places and trips: iCloud on iOS - what SwiftData +
 * CloudKit did for the SwiftUI app (`CloudSyncMonitor`) - and Google Drive's
 * hidden app folder on Android (drive-store.ts). Each list is one JSON doc in
 * the store, merged item by item (`@transit/shared/sync-merge`).
 *
 * Runs after a local change (debounced), when iCloud says another device
 * changed something, and when the app comes to the front. The switch is
 * Settings > iCloud sync (`settings.iCloudSync`, on by default) or Google
 * Drive sync (`settings.driveSync`, off until the rider connects Drive).
 */

/** Where the docs live. */
interface Backend {
    enabled(): boolean
    signedIn(): Promise<boolean>
    get(key: string): Promise<string | null>
    set(key: string, json: string): Promise<void>
}

const icloud: Backend = {
    enabled: () => settingsStore.get().iCloudSync,
    signedIn: async () => TransitNative.cloudSignedIn(),
    get: async (key) => TransitNative.cloudGet(key),
    set: async (key, json) => TransitNative.cloudSet(key, json),
}

const drive: Backend = {
    enabled: () => settingsStore.get().driveSync,
    signedIn: () => driveStore.connected(),
    get: (key) => driveStore.get(key),
    set: (key, json) => driveStore.set(key, json),
}

const backend: Backend | null = TransitNative.cloudAvailable ? icloud : TransitNative.driveAvailable ? drive : null

/** Which sync this build has: "icloud" (iOS), "drive" (Android) or none. */
export const cloudSyncKind: "icloud" | "drive" | null = backend === icloud ? "icloud" : backend === drive ? "drive" : null

interface Collection {
    /** The iCloud key-value store key. */
    cloudKey: string
    store: Stored<any[]>
    key(item: any): string
}

const COLLECTIONS: Collection[] = [
    { cloudKey: "saved-stops", store: savedStopsStore, key: (s) => `${s.region}/${s.stopId}` },
    { cloudKey: "saved-places", store: savedPlacesStore, key: (p) => `${p.region}/${p.id}` },
    { cloudKey: "saved-trips", store: savedTripsStore, key: (t) => t.id },
]

/** Each list as of its last sync - what local changes are measured against. */
const META_KEY = "cloud-sync-meta"
type Meta = { docs: Record<string, SyncDoc<unknown>>; lastSynced?: number }

export type CloudSyncState =
    /** No iCloud on this platform/build. */
    | "unsupported"
    /** The rider turned it off. */
    | "disabled"
    | "signedOut"
    | "syncing"
    /** iCloud storage for Transit is full. */
    | "quota"

export interface CloudSyncStatus {
    state: CloudSyncState
    lastSynced?: number
}

export const cloudSyncStatus = stored<CloudSyncStatus>("cloud-sync-status", { state: backend ? "syncing" : "unsupported" })

export function useCloudSyncStatus() {
    return useStored(cloudSyncStatus)[0]
}

let meta: Meta = { docs: {} }
let started = false
let applying = false
let running: Promise<void> | null = null
let again = false
let quotaHit = false
let timer: ReturnType<typeof setTimeout> | null = null

/** Starts syncing (once). Call after the stores have loaded and the SwiftUI-app migration has run. */
export async function startCloudSync() {
    if (!backend || started) return
    started = true
    await Promise.all([...COLLECTIONS.map((c) => c.store.ready), settingsStore.ready])
    try {
        meta = { docs: {}, ...(JSON.parse((await AsyncStorage.getItem(META_KEY)) ?? "{}") as Partial<Meta>) }
    } catch {
        /* start afresh - docFromList treats it as a first sync */
    }
    for (const c of COLLECTIONS) {
        c.store.subscribe(() => {
            if (!applying) schedule(1000)
        })
    }
    let enabled = backend.enabled()
    settingsStore.subscribe(() => {
        const now = backend.enabled()
        if (now === enabled) return
        enabled = now
        syncCloudNow()
    })
    if (backend === icloud) {
        TransitNative.addListener("onCloudChange", ({ reason }) => {
            quotaHit = reason === 2
            syncCloudNow()
        })
    }
    AppState.addEventListener("change", (state) => {
        if (state === "active") {
            TransitNative.cloudSynchronize()
            syncCloudNow()
        }
    })
    TransitNative.cloudSynchronize()
    await syncCloudNow()
}

function schedule(delay: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = null
        syncCloudNow()
    }, delay)
}

/** Android: connects Google Drive (Google's consent screen) and turns sync on. False if the rider didn't allow it. */
export async function connectDriveSync(): Promise<boolean> {
    if (backend !== drive) return false
    const ok = await driveStore.connect()
    settingsStore.set((prev) => ({ ...prev, driveSync: ok }))
    if (ok) await syncCloudNow()
    return ok
}

/** Syncs now; overlapping calls run once more after the current one. */
export function syncCloudNow(): Promise<void> {
    if (running) {
        again = true
        return running
    }
    running = (async () => {
        do {
            again = false
            try {
                await syncOnce()
            } catch (e) {
                if (backend === drive && driveStore.isAuthError(e)) setStatus({ state: "signedOut" })
                else console.warn("Cloud sync failed", e)
            }
        } while (again)
    })().finally(() => {
        running = null
    })
    return running
}

async function syncOnce() {
    if (!backend) return
    if (!backend.enabled()) return setStatus({ state: "disabled" })
    if (!(await backend.signedIn())) return setStatus({ state: "signedOut" })
    const now = Date.now()
    for (const c of COLLECTIONS) {
        const local = c.store.get()
        const base = meta.docs[c.cloudKey] ?? null
        // Never synced: date items by when they were saved, so a delete made on another device since still wins.
        const mine = docFromList(local, c.key, base, now, (item) => item.addedAt ?? 0)
        const remoteJSON = await backend.get(c.cloudKey)
        const remote = parseDoc<unknown>(remoteJSON)
        const merged = remote ? mergeDocs(mine, remote, now) : mine
        const list = listFromDoc(merged)
        if (JSON.stringify(list) !== JSON.stringify(local)) {
            applying = true
            try {
                c.store.set(list)
            } finally {
                applying = false
            }
        }
        const mergedJSON = JSON.stringify(merged)
        if (mergedJSON !== remoteJSON) await backend.set(c.cloudKey, mergedJSON)
        meta.docs[c.cloudKey] = merged
    }
    meta.lastSynced = now
    AsyncStorage.setItem(META_KEY, JSON.stringify(meta)).catch(() => {})
    setStatus({ state: quotaHit ? "quota" : "syncing", lastSynced: now })
}

function setStatus(next: CloudSyncStatus) {
    const prev = cloudSyncStatus.get()
    const merged = { ...next, lastSynced: next.lastSynced ?? meta.lastSynced }
    if (prev.state !== merged.state || prev.lastSynced !== merged.lastSynced) cloudSyncStatus.set(merged)
}
