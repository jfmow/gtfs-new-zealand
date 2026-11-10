export interface NamedColor {
    name: string
    value: string
}

/** Shared swatch palette for user-assignable colors (saved stops, saved trips). */
export const SWATCH_COLORS: NamedColor[] = [
    { name: "Amber", value: "#f59e0b" },
    { name: "Rose", value: "#f43f5e" },
    { name: "Sky", value: "#0ea5e9" },
    { name: "Emerald", value: "#10b981" },
    { name: "Violet", value: "#8b5cf6" },
    { name: "Orange", value: "#f97316" },
    { name: "Cyan", value: "#06b6d4" },
    { name: "Fuchsia", value: "#d946ef" },
]
