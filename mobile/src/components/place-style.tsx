import { SWATCH_COLORS } from "@transit/shared/colors"
import { Bookmark, Briefcase, Building, Bus, Coffee, Dumbbell, Flag, GraduationCap, Heart, Hospital, House, MapPin, Plane, ShoppingCart, Star, TrainFront, Trees, Users, Utensils, type LucideIcon } from "@/components/icons"
import type { PlaceKind, SavedPlace } from "@/lib/saved"

/** The icons a saved place can wear. Ids are stored (and synced), so never rename one. */
export const PLACE_ICONS: { id: string; label: string; icon: LucideIcon }[] = [
    { id: "house", label: "Home", icon: House },
    { id: "briefcase", label: "Work", icon: Briefcase },
    { id: "pin", label: "Pin", icon: MapPin },
    { id: "school", label: "School", icon: GraduationCap },
    { id: "heart", label: "Heart", icon: Heart },
    { id: "users", label: "Friends", icon: Users },
    { id: "cart", label: "Shopping", icon: ShoppingCart },
    { id: "food", label: "Food", icon: Utensils },
    { id: "coffee", label: "Coffee", icon: Coffee },
    { id: "gym", label: "Gym", icon: Dumbbell },
    { id: "park", label: "Park", icon: Trees },
    { id: "hospital", label: "Health", icon: Hospital },
    { id: "building", label: "Building", icon: Building },
    { id: "train", label: "Station", icon: TrainFront },
    { id: "bus", label: "Bus", icon: Bus },
    { id: "plane", label: "Airport", icon: Plane },
    { id: "star", label: "Star", icon: Star },
    { id: "flag", label: "Flag", icon: Flag },
    { id: "bookmark", label: "Bookmark", icon: Bookmark },
]

/** The colours: home and work's original sky and amber first, then the shared swatches. */
export const PLACE_COLORS: string[] = [...new Set(["#0ea5e9", "#f59e0b", "#10b981", ...SWATCH_COLORS.map((c) => c.value), "#64748b"])]

const DEFAULTS: Record<PlaceKind, { icon: string; color: string }> = {
    home: { icon: "house", color: "#0ea5e9" },
    work: { icon: "briefcase", color: "#f59e0b" },
    other: { icon: "pin", color: "#10b981" },
}

/** A place's icon and colour - the rider's pick, or its kind's default. */
export function placeStyle(place: Pick<SavedPlace, "kind" | "icon" | "color"> | { kind: PlaceKind; icon?: string; color?: string }): { iconId: string; icon: LucideIcon; color: string } {
    const d = DEFAULTS[place.kind]
    const iconId = place.icon && PLACE_ICONS.some((i) => i.id === place.icon) ? place.icon : d.icon
    return { iconId, icon: PLACE_ICONS.find((i) => i.id === iconId)!.icon, color: place.color ?? d.color }
}

/** What a place is called in lists: Home and Work by their kind, the rest by name. */
export function placeTitle(place: SavedPlace): string {
    return place.kind === "home" ? "Home" : place.kind === "work" ? "Work" : place.label
}
