import AsyncStorage from "@react-native-async-storage/async-storage"
import { AppState } from "react-native"
import { docFromList, listFromDoc, mergeDocs, parseDoc, type SyncDoc } from "@transit/shared/sync-merge"
import { TransitNative } from "../../modules/transit-native/src"
import { savedPlacesStore, savedStopsStore, savedTripsStore, settingsStore } from "./saved"
import { stored, useStored, type Stored } from "./storage"

/**
 * iCloud sync of saved stops, places and trips (iOS) - what SwiftData +
 * CloudKit did for the SwiftUI app (`CloudSyncMonitor`). Each list is one
 * JSON doc in the iCloud key-value store, merged item by item
 * (`@transit/shared/sync-merge`). Android has no sync yet.
 *
 * Runs after a local change (debounced), when iCloud says another device
 * changed something, and when the app comes to the front. The switch is
 * Settings > iCloud sync (`settings.iCloudSync`).
 */

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

export const cloudSyncStatus = stored<CloudSyncStatus>("cloud-sync-status", { state: TransitNative.cloudAvailable ? "syncing" : "unsupported" })

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
    if (!TransitNative.cloudAvailable || started) return
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
    let enabled = settingsStore.get().iCloudSync
    settingsStore.subscribe(() => {
        const now = settingsStore.get().iCloudSync
        if (now === enabled) return
        enabled = now
        syncCloudNow()
    })
    TransitNative.addListener("onCloudChange", ({ reason }) => {
        quotaHit = reason === 2
        syncCloudNow()
    })
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
                syncOnce()
            } catch (e) {
                console.warn("iCloud sync failed", e)
            }
        } while (again)
    })().finally(() => {
        running = null
    })
    return running
}

function syncOnce() {
    if (!settingsStore.get().iCloudSync) return setStatus({ state: "disabled" })
    if (!TransitNative.cloudSignedIn()) return setStatus({ state: "signedOut" })
    const now = Date.now()
    for (const c of COLLECTIONS) {
        const local = c.store.get()
        const base = meta.docs[c.cloudKey] ?? null
        // Never synced: date items by when they were saved, so a delete made on another device since still wins.
        const mine = docFromList(local, c.key, base, now, (item) => item.addedAt ?? 0)
        const remoteJSON = TransitNative.cloudGet(c.cloudKey)
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
        if (mergedJSON !== remoteJSON) TransitNative.cloudSet(c.cloudKey, mergedJSON)
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
