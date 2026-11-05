import { QueryClientProvider } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Redirect, Stack, ThemeProvider, usePathname, type ErrorBoundaryProps } from "expo-router"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { Pressable, Text, useColorScheme, View, Appearance } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { regionBySlug } from "@transit/shared/regions"
import { ResumeJourneyBar } from "@/components/resume-journey"
import "@/lib/journey-location" // defines the background GPS task at startup, before iOS wakes the app for a fix
import { JourneyRunner } from "@/lib/journey-runner"
import { setRegionSwitcher } from "@/lib/links"
import { syncWidgetData } from "@/lib/live-surface"
import { migrateFromSwiftUIApp } from "@/lib/migrate"
import { queryClient } from "@/lib/plans"
import { listenForNotificationTaps, registerForPush } from "@/lib/push"
import { RegionProvider, regions, useRegion } from "@/lib/region"
import { savedStopsStore, settingsStore, useSettings } from "@/lib/saved"
import { palettes } from "@/theme"

/** A screen that throws shows this (with a retry) instead of blanking the whole app. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    const colors = palettes[useColorScheme() === "dark" ? "dark" : "light"]
    return (
        <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: colors.background }}>
            <Text style={{ fontSize: 19, fontFamily: "Geist-SemiBold", color: colors.foreground }}>Something went wrong</Text>
            <Text style={{ fontSize: 15, color: colors.mutedForeground }}>{error.message}</Text>
            <Pressable accessibilityRole="button" onPress={retry} style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center" }}>
                <Text style={{ color: colors.primaryForeground, fontFamily: "Geist-Medium" }}>Try again</Text>
            </Pressable>
        </View>
    )
}

/** The tabs sit under every modal (onboarding included), so a modal is never the stack's first screen. */
export const unstable_settings = { anchor: "(tabs)" }

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
    // Hold the splash until saved settings are read, so Home never flashes before onboarding.
    const [settingsLoaded, setSettingsLoaded] = useState(false)
    const [fontsLoaded, fontError] = useFonts({
        "Geist-Regular": require("../../assets/fonts/Geist-Regular.ttf"),
        "Geist-Medium": require("../../assets/fonts/Geist-Medium.ttf"),
        "Geist-SemiBold": require("../../assets/fonts/Geist-SemiBold.ttf"),
        "Geist-Bold": require("../../assets/fonts/Geist-Bold.ttf"),
        "GeistMono-Regular": require("../../assets/fonts/GeistMono-Regular.ttf"),
        "GeistMono-Medium": require("../../assets/fonts/GeistMono-Medium.ttf"),
    })
    useEffect(() => {
        settingsStore.ready.then(() => setSettingsLoaded(true))
    }, [])
    // A font that fails to load falls back to the system font rather than holding the app.
    const loaded = settingsLoaded && (fontsLoaded || !!fontError)
    useEffect(() => {
        if (loaded) SplashScreen.hideAsync().catch(() => {})
    }, [loaded])

    const scheme = useColorScheme() === "dark" ? "dark" : "light"
    const colors = palettes[scheme]
    const base = scheme === "dark" ? DarkTheme : DefaultTheme
    // Navigation chrome in Bush colours.
    const navTheme = {
        ...base,
        colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.card, text: colors.foreground, border: colors.border },
    }

    if (!loaded) return null
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <QueryClientProvider client={queryClient}>
                <RegionProvider>
                    <ThemeProvider value={navTheme}>
                        <StatusBar style="auto" />
                        <AppEffects />
                        {/* The tracked journey runs app-wide, so minimising the tracker doesn't stop it. */}
                        <JourneyRunner />
                        <Stack
                            screenOptions={{
                                headerBackButtonDisplayMode: "minimal",
                                contentStyle: { backgroundColor: colors.background },
                                // Opaque, so screens start below the header instead of under the iOS glass.
                                headerTransparent: false,
                                headerStyle: { backgroundColor: colors.background },
                                headerShadowVisible: false,
                                headerTintColor: colors.foreground,
                            }}
                        >
                            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                            <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
                            <Stack.Screen name="onboarding" options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }} />
                            <Stack.Screen name="place" options={{ presentation: "modal" }} />
                            <Stack.Screen name="alerts/subscribe" options={{ title: "Alerts for this stop", presentation: "modal" }} />
                            <Stack.Screen name="trip/[tripId]" options={{ title: "" }} />
                            <Stack.Screen name="find-vehicle" options={{ presentation: "formSheet", sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
                            <Stack.Screen name="route-filter" options={{ presentation: "modal" }} />
                            <Stack.Screen name="planner-time" options={{ presentation: "formSheet", sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true }} />
                            <Stack.Screen name="planner-options" options={{ presentation: "modal" }} />
                            <Stack.Screen name="easy-planner" options={{ presentation: "fullScreenModal" }} />
                            <Stack.Screen name="saved-trips" options={{ presentation: "modal" }} />
                            <Stack.Screen name="save-trip" options={{ presentation: "formSheet", sheetAllowedDetents: [0.4], sheetGrabberVisible: true }} />
                            <Stack.Screen name="leave-reminder" options={{ presentation: "modal" }} />
                            <Stack.Screen name="journey-map" options={{ presentation: "fullScreenModal" }} />
                            <Stack.Screen name="manage-notifications" options={{ title: "Alerts & reminders" }} />
                            <Stack.Screen name="stop/[query]" options={{ headerShown: false }} />
                            <Stack.Screen name="trip-reminder" options={{ presentation: "formSheet", sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true, headerShown: true }} />
                            <Stack.Screen name="journey/track/[id]" options={{ headerShown: false }} />
                        </Stack>
                        <ResumeJourneyBar />
                    </ThemeProvider>
                </RegionProvider>
            </QueryClientProvider>
        </GestureHandlerRootView>
    )
}

/** Launch-time work: push registration, notification taps, link region switching, onboarding. */
function AppEffects() {
    const { region, setRegion, ready } = useRegion()
    const [settings] = useSettings()
    const pathname = usePathname()

    // Settings > Appearance overrides the phone's light/dark setting app-wide.
    useEffect(() => {
        Appearance.setColorScheme(settings.appearance === "system" ? "unspecified" : settings.appearance)
    }, [settings.appearance])

    useEffect(() => {
        setRegionSwitcher((slug) => {
            const r = regionBySlug(regions, slug)
            if (r) setRegion(r)
        })
        migrateFromSwiftUIApp().catch(() => {})
        registerForPush().catch(() => {})
        return listenForNotificationTaps()
    }, [setRegion])

    // Widgets and Siri read the region and saved stops from the app group.
    useEffect(() => {
        syncWidgetData(region)
        return savedStopsStore.subscribe(() => syncWidgetData(region))
    }, [region])

    if (ready && !settings.onboarded && pathname !== "/onboarding") return <Redirect href="/onboarding" />
    return null
}
