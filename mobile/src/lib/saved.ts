import type { FareType } from "@transit/shared/fares"
import { SWATCH_COLORS } from "@transit/shared/colors"
import { DEFAULT_WALK_SPEED } from "@transit/shared/walk-speed"
import { stored, useStored } from "./storage"

/**
 * Saved stops, places and trips, plus settings - per region where the iOS
 * SwiftData models were (`PersistenceModels.swift`). Stops, places and trips
 * sync through iCloud on iOS (`cloud-sync.ts`); settings stay on the device.
 */

export interface SavedStop {
    /** The board query ("name code") the departures endpoint takes. */
    query: string
    stopId: string
    name: string
    code: string
    lat: number
    lon: number
    /** "bus" | "train" | "ferry" | "other" */
    type: string
    region: string
    /** Swatch colour (shared `SWATCH_COLORS`), optional. */
    color?: string
    addedAt: number
}

export type PlaceKind = "home" | "work" | "other"

export interface SavedPlace {
    id: string
    kind: PlaceKind
    label: string
    lat: number
    lon: number
    region: string
}

export interface SavedTrip {
    id: string
    name: string
    from: { label: string; lat: number; lon: number }
    to: { label: string; lat: number; lon: number }
    region: string
    color?: string
    addedAt: number
}

export const savedStopsStore = stored<SavedStop[]>("saved-stops", [])
export const savedPlacesStore = stored<SavedPlace[]>("saved-places", [])
export const savedTripsStore = stored<SavedTrip[]>("saved-trips", [])

export function useSavedStops(region: string) {
    const [all, set] = useStored(savedStopsStore)
    const stops = all.filter((s) => s.region === region)
    const isSaved = (stopId: string) => stops.some((s) => s.stopId === stopId)
    const toggle = (stop: Omit<SavedStop, "addedAt" | "region">) =>
        set((prev) =>
            prev.some((s) => s.region === region && s.stopId === stop.stopId)
                ? prev.filter((s) => !(s.region === region && s.stopId === stop.stopId))
                // A colour from the shared swatches, cycled like iOS / the web.
                : [...prev, { ...stop, color: stop.color ?? SWATCH_COLORS[prev.filter((s) => s.region === region).length % SWATCH_COLORS.length].value, region, addedAt: Date.now() }],
        )
    const update = (stopId: string, patch: Partial<Pick<SavedStop, "name" | "color">>) =>
        set((prev) => prev.map((s) => (s.region === region && s.stopId === stopId ? { ...s, ...patch } : s)))
    const remove = (stopId: string) => set((prev) => prev.filter((s) => !(s.region === region && s.stopId === stopId)))
    const move = (stopId: string, delta: number) =>
        set((prev) => {
            const mine = prev.filter((s) => s.region === region)
            const others = prev.filter((s) => s.region !== region)
            const i = mine.findIndex((s) => s.stopId === stopId)
            const j = i + delta
            if (i < 0 || j < 0 || j >= mine.length) return prev
            const next = [...mine]
            ;[next[i], next[j]] = [next[j], next[i]]
            return [...others, ...next]
        })
    return { stops, isSaved, toggle, remove, move, update }
}

export function useSavedPlaces(region: string) {
    const [all, set] = useStored(savedPlacesStore)
    const places = all.filter((p) => p.region === region)
    const save = (place: Omit<SavedPlace, "id" | "region"> & { id?: string }) =>
        set((prev) => {
            // One home and one work per region.
            const id = place.id ?? (place.kind === "other" ? `${Date.now()}` : place.kind)
            const rest = prev.filter((p) => !(p.region === region && p.id === id))
            return [...rest, { ...place, id, region }]
        })
    const remove = (id: string) => set((prev) => prev.filter((p) => !(p.region === region && p.id === id)))
    return { places, save, remove, home: places.find((p) => p.kind === "home"), work: places.find((p) => p.kind === "work") }
}

export function useSavedTrips(region: string) {
    const [all, set] = useStored(savedTripsStore)
    const trips = all.filter((t) => t.region === region)
    const save = (trip: Omit<SavedTrip, "id" | "region" | "addedAt">) => set((prev) => [...prev, { ...trip, id: `${Date.now()}`, region, addedAt: Date.now() }])
    const remove = (id: string) => set((prev) => prev.filter((t) => t.id !== id))
    return { trips, save, remove }
}

// ---------------------------------------------------------------------------
// settings

export interface Settings {
    walkSpeed: string
    /** By region slug - a region may not offer every fare type. */
    fareType: Record<string, FareType>
    showFares: boolean
    /** The step-by-step planner as the Planner's default. */
    easyPlanner: boolean
    /** Vehicles glide between position updates on the map. */
    smoothVehicles: boolean
    map3D: boolean
    /** Light, dark, or match the phone - iOS Settings > Appearance. */
    appearance: "system" | "light" | "dark"
    /** Basemap colours, independent of the app theme - iOS Settings > Map style. */
    mapStyle: "auto" | "light" | "dark"
    onboarded: boolean
    notificationsAsked: boolean
    /** Sync saved stops, places and trips through iCloud (iOS) - on unless turned off. */
    iCloudSync: boolean
}

const DEFAULT_SETTINGS: Settings = {
    walkSpeed: DEFAULT_WALK_SPEED,
    fareType: {},
    showFares: true,
    easyPlanner: false,
    smoothVehicles: true,
    map3D: false,
    appearance: "system",
    mapStyle: "auto",
    onboarded: false,
    notificationsAsked: false,
    iCloudSync: true,
}

/** New fields get their defaults when an older saved value loads. */
export const settingsStore = stored<Settings>("settings", DEFAULT_SETTINGS, (raw) => ({ ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }))

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
    const [settings, set] = useStored(settingsStore)
    return [settings, (patch) => set((prev) => ({ ...prev, ...patch }))]
}
