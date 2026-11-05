import { useColorScheme } from "react-native"

/**
 * The "Bush" palette (picked 2026-11-03), copied from iOS
 * `Transit/DesignSystem/Theme.swift`. Token names match the web's CSS
 * variables, so `bg-muted` -> `colors.muted`, `text-muted-foreground` ->
 * `colors.mutedForeground`. Colour only ever means something: a route's
 * own colour, or a status (late, cancelled, live).
 */
const light = {
    background: "#F6F9F6",
    grouped: "#EDF2EE",
    card: "#FFFFFF",
    foreground: "#0D1A12",
    mutedForeground: "#5E6F64",
    muted: "#E6EEE8",
    accent: "#E6EEE8",
    border: "#D9E3DB",
    ring: "#173A2A",
    primary: "#173A2A",
    primaryForeground: "#F6F9F6",
    destructive: "#EF4444",
    destructiveForeground: "#FAFAFA",
    warning: "#D97706",
    danger: "#DC2626",
    success: "#16A34A",
    live: "#2563EB",
}

export type ThemeColors = typeof light

const dark: ThemeColors = {
    background: "#0C1410",
    grouped: "#0C1410",
    card: "#142019",
    foreground: "#EEF3EF",
    mutedForeground: "#9DB0A3",
    muted: "#1C2A21",
    accent: "#1F2E24",
    border: "#24352A",
    ring: "#CBD8CF",
    primary: "#E6F0E9",
    primaryForeground: "#0C1410",
    destructive: "#8D2020",
    destructiveForeground: "#FAFAFA",
    warning: "#F59E0B",
    danger: "#F87171",
    success: "#4ADE80",
    live: "#60A5FA",
}

export const palettes = { light, dark }

export const radius = { sm: 8, md: 10, lg: 12, xl: 12 } as const

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

/** Geist, as the iOS app (and web) use - loaded in the root layout. One family per weight so it works the same on Android. */
export const fonts = {
    regular: "Geist-Regular",
    medium: "Geist-Medium",
    semibold: "Geist-SemiBold",
    bold: "Geist-Bold",
    mono: "GeistMono-Regular",
    monoMedium: "GeistMono-Medium",
} as const

/**
 * The iOS type scale (`Theme.swift`): normal sizes that follow the system
 * text size - oversized fixed text was harder to read, not easier.
 */
export const type = {
    /** Large page greeting ("Good evening"). */
    display: { fontFamily: fonts.semibold, fontSize: 24 },
    pageTitle: { fontFamily: fonts.semibold, fontSize: 19 },
    sectionTitle: { fontFamily: fonts.semibold, fontSize: 19 },
    cardTitle: { fontFamily: fonts.semibold, fontSize: 16 },
    body: { fontFamily: fonts.regular, fontSize: 15 },
    bodyMedium: { fontFamily: fonts.medium, fontSize: 15 },
    meta: { fontFamily: fonts.regular, fontSize: 13 },
    metaMedium: { fontFamily: fonts.medium, fontSize: 13 },
    badge: { fontFamily: fonts.medium, fontSize: 11 },
    /** Countdowns: Geist Mono, so minutes don't jiggle as they tick. */
    minutes: { fontFamily: fonts.monoMedium, fontSize: 16 },
    number: { fontFamily: fonts.bold, fontSize: 20, fontVariant: ["tabular-nums"] as const },
} as const

/** The palette for the current light/dark setting. */
export function useColors(): ThemeColors {
    return useColorScheme() === "dark" ? dark : light
}
