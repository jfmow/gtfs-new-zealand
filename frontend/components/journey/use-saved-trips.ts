import { useEffect, useState } from "react"
import { SWATCH_COLORS } from "@/lib/colors"
import type { Location } from "./types"

export interface SavedTrip {
    id: string
    name: string
    startLocation: Location
    endLocation: Location
    savedAt: string
    maxWalkKm: string
    walkSpeed: string
    maxTransfers: string
    color: string
}

const STORAGE_KEY = "savedJourneyTrips"
const TRIPS_UPDATED_EVENT = "tripsUpdated"

function readTrips(): SavedTrip[] {
    if (typeof window === "undefined") return []
    try {
        const raw: Array<Omit<SavedTrip, "color"> & { color?: string }> = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? "[]"
        )
        return raw.map((t, i) => ({
            ...t,
            color: t.color || SWATCH_COLORS[i % SWATCH_COLORS.length].value,
        }))
    } catch {
        return []
    }
}

function writeTrips(trips: SavedTrip[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trips))
    window.dispatchEvent(new CustomEvent(TRIPS_UPDATED_EVENT))
}

export function useSavedTrips() {
    // Starts empty (matching SSR) rather than reading localStorage in the
    // initializer, which would mismatch the server-rendered empty state
    // whenever the browser already has saved trips.
    const [trips, setTrips] = useState<SavedTrip[]>([])

    useEffect(() => {
        setTrips(readTrips())
        const handler = () => setTrips(readTrips())
        window.addEventListener(TRIPS_UPDATED_EVENT, handler)
        return () => window.removeEventListener(TRIPS_UPDATED_EVENT, handler)
    }, [])

    const saveTrip = (trip: Omit<SavedTrip, "id" | "savedAt" | "color">): SavedTrip => {
        const current = readTrips()
        const newTrip: SavedTrip = {
            ...trip,
            id: crypto.randomUUID(),
            savedAt: new Date().toISOString(),
            color: SWATCH_COLORS[current.length % SWATCH_COLORS.length].value,
        }
        writeTrips([newTrip, ...current])
        return newTrip
    }

    const updateTrip = (updated: SavedTrip) => {
        writeTrips(readTrips().map((t) => (t.id === updated.id ? updated : t)))
    }

    const deleteTrip = (id: string) => {
        writeTrips(readTrips().filter((t) => t.id !== id))
    }

    const reorderTrips = (newOrder: SavedTrip[]) => {
        writeTrips(newOrder)
    }

    const updateAllTrips = (settings: {
        maxWalkKm?: string
        walkSpeed?: string
        maxTransfers?: string
    }) => {
        writeTrips(
            readTrips().map((t) => ({
                ...t,
                ...(settings.maxWalkKm !== undefined && { maxWalkKm: settings.maxWalkKm }),
                ...(settings.walkSpeed !== undefined && { walkSpeed: settings.walkSpeed }),
                ...(settings.maxTransfers !== undefined && { maxTransfers: settings.maxTransfers }),
            }))
        )
    }

    return { trips, saveTrip, updateTrip, deleteTrip, reorderTrips, updateAllTrips }
}
