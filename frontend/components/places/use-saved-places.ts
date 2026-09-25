import { useEffect, useState } from "react"
import { Briefcase, Dumbbell, GraduationCap, Heart, House, MapPin, ShoppingCart, Star, User, Utensils, type LucideIcon } from "lucide-react"
import { useUrl } from "@/lib/url-context"
import { getRegionSlug } from "@/lib/url-store"
import type { Location } from "@/components/journey/types"

/**
 * A place the rider has named - "Home", "Work", a friend's house - offered
 * first in the planner's From/To inputs and as one-tap "get me there"
 * chips on the home page. Mirrors the iOS app's `SavedPlace`.
 */
export interface SavedPlace {
    id: string
    name: string
    /** The address or search label it was picked from. */
    address: string
    lat: number
    lon: number
    icon: PlaceIconKey
    /** The region it was saved in - places only show in that region. */
    region: string
    createdAt: string
}

/** Same keys, names and tints as iOS `SavedPlaceIcon` - don't rename keys. */
export const PLACE_ICONS = {
    home: { label: "Home", icon: House, color: "#0ea5e9" },
    work: { label: "Work", icon: Briefcase, color: "#f59e0b" },
    heart: { label: "Partner", icon: Heart, color: "#f43f5e" },
    person: { label: "Friend or family", icon: User, color: "#8b5cf6" },
    school: { label: "School", icon: GraduationCap, color: "#10b981" },
    gym: { label: "Gym", icon: Dumbbell, color: "#f97316" },
    shop: { label: "Shops", icon: ShoppingCart, color: "#06b6d4" },
    food: { label: "Food", icon: Utensils, color: "#d946ef" },
    star: { label: "Favourite", icon: Star, color: "#f59e0b" },
    pin: { label: "Other", icon: MapPin, color: "#737373" },
} satisfies Record<string, { label: string; icon: LucideIcon; color: string }>

export type PlaceIconKey = keyof typeof PLACE_ICONS

export function placeIcon(key: string) {
    return PLACE_ICONS[key as PlaceIconKey] ?? PLACE_ICONS.pin
}

/** As a planner endpoint - labelled with the place's name ("Home"). */
export function placeLocation(place: SavedPlace): Location {
    return { lat: place.lat, lon: place.lon, label: place.name }
}

export function placeMatches(place: SavedPlace, query: string) {
    const q = query.trim().toLowerCase()
    return !q || place.name.toLowerCase().includes(q) || place.address.toLowerCase().includes(q)
}

const STORAGE_KEY = "savedPlaces"
const PLACES_UPDATED_EVENT = "savedPlacesUpdated"

function readPlaces(): SavedPlace[] {
    if (typeof window === "undefined") return []
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    } catch {
        return []
    }
}

function writePlaces(places: SavedPlace[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places))
    window.dispatchEvent(new CustomEvent(PLACES_UPDATED_EVENT))
}

/** The current region's saved places, in the rider's order. */
export function useSavedPlaces() {
    const { currentUrl } = useUrl()
    const region = getRegionSlug(currentUrl)
    // Starts empty (matching SSR) - see useSavedTrips.
    const [all, setAll] = useState<SavedPlace[]>([])

    useEffect(() => {
        setAll(readPlaces())
        const handler = () => setAll(readPlaces())
        window.addEventListener(PLACES_UPDATED_EVENT, handler)
        return () => window.removeEventListener(PLACES_UPDATED_EVENT, handler)
    }, [])

    const places = all.filter((p) => p.region === region)

    const addPlace = (place: Omit<SavedPlace, "id" | "createdAt" | "region">): SavedPlace => {
        const created: SavedPlace = { ...place, id: crypto.randomUUID(), createdAt: new Date().toISOString(), region }
        writePlaces([...readPlaces(), created])
        return created
    }

    const updatePlace = (updated: SavedPlace) => {
        writePlaces(readPlaces().map((p) => (p.id === updated.id ? updated : p)))
    }

    const deletePlace = (id: string) => {
        writePlaces(readPlaces().filter((p) => p.id !== id))
    }

    /** Reorders this region's places, leaving other regions' where they are. */
    const reorderPlaces = (ordered: SavedPlace[]) => {
        const others = readPlaces().filter((p) => p.region !== region)
        writePlaces([...others, ...ordered])
    }

    return { places, addPlace, updatePlace, deletePlace, reorderPlaces }
}
