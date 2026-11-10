import { useEffect, useState } from "react"
import { Bookmark, Briefcase, Building, Bus, Coffee, Dumbbell, Flag, GraduationCap, Heart, Hospital, House, MapPin, Plane, ShoppingCart, Star, TrainFront, Trees, User, Utensils, type LucideIcon } from "lucide-react"
import { SWATCH_COLORS } from "@/lib/colors"
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
    /** The rider's colour pick (hex); unset = the icon's own tint. */
    color?: string
    /** The region it was saved in - places only show in that region. */
    region: string
    createdAt: string
}

/**
 * Same keys, names and tints as iOS `SavedPlaceIcon` - don't rename keys.
 * The later ones match the Expo app's extra icons (place-style.tsx).
 */
export const PLACE_ICONS = {
    home: { label: "Home", icon: House, color: "#0ea5e9" },
    work: { label: "Work", icon: Briefcase, color: "#f59e0b" },
    pin: { label: "Pin", icon: MapPin, color: "#10b981" },
    school: { label: "School", icon: GraduationCap, color: "#10b981" },
    heart: { label: "Partner", icon: Heart, color: "#f43f5e" },
    person: { label: "Friend or family", icon: User, color: "#8b5cf6" },
    shop: { label: "Shops", icon: ShoppingCart, color: "#06b6d4" },
    food: { label: "Food", icon: Utensils, color: "#d946ef" },
    coffee: { label: "Coffee", icon: Coffee, color: "#f97316" },
    gym: { label: "Gym", icon: Dumbbell, color: "#f97316" },
    park: { label: "Park", icon: Trees, color: "#10b981" },
    hospital: { label: "Health", icon: Hospital, color: "#f43f5e" },
    building: { label: "Building", icon: Building, color: "#64748b" },
    train: { label: "Station", icon: TrainFront, color: "#0ea5e9" },
    bus: { label: "Bus", icon: Bus, color: "#0ea5e9" },
    plane: { label: "Airport", icon: Plane, color: "#8b5cf6" },
    star: { label: "Favourite", icon: Star, color: "#f59e0b" },
    flag: { label: "Flag", icon: Flag, color: "#f43f5e" },
    bookmark: { label: "Bookmark", icon: Bookmark, color: "#8b5cf6" },
} satisfies Record<string, { label: string; icon: LucideIcon; color: string }>

/** The colours a place can wear - the app's: sky and amber first, then the shared swatches. */
export const PLACE_COLORS: string[] = [...new Set(["#0ea5e9", "#f59e0b", "#10b981", ...SWATCH_COLORS.map((c) => c.value), "#64748b"])]

export type PlaceIconKey = keyof typeof PLACE_ICONS

export function placeIcon(key: string) {
    return PLACE_ICONS[key as PlaceIconKey] ?? PLACE_ICONS.pin
}

/** A place's icon and colour - the rider's colour pick, or the icon's tint. */
export function placeStyle(place: { icon: string; color?: string }) {
    const meta = placeIcon(place.icon)
    return { ...meta, color: place.color || meta.color }
}

/** Is this the rider's home (or work)? Picked by icon, as the add buttons offer them. */
export function hasPlaceKind(places: SavedPlace[], key: "home" | "work") {
    return places.some((p) => p.icon === key)
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
