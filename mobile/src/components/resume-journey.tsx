import { router, usePathname } from "expo-router"
import { useEffect, useState } from "react"
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { laClock } from "@transit/shared/logic/journey-live"
import { goTime } from "@transit/shared/models"
import { RESUME_GRACE_MS, destinationLabel } from "@/lib/journey-runner"
import { useActiveJourney } from "@/lib/journey-session"
import { usePlan } from "@/lib/plans"
import { useRegion } from "@/lib/region"
import { stored, useStored } from "@/lib/storage"
import { radius, spacing, type, useColors } from "@/theme"
import { Navigation, X } from "./icons"

/** The plan whose resume bar the rider closed - it stays tracked, just out of the way. */
const dismissedStore = stored<string>("dismissed-resume-plan", "")

/** The tab roots, where the bar sits above the tab bar. */
const TAB_PATHS = new Set(["/", "/planner", "/map", "/updates"])

/**
 * A minimised journey, docked above the tab bar - iOS `ResumeJourneyCard`:
 * live icon, "Journey to Newmarket", "Arrives 8:10am · Tap to resume", and a
 * dismiss. Tapping reopens the tracker; tracking never stopped.
 */
export function ResumeJourneyBar() {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const pathname = usePathname()
    const { region } = useRegion()
    const [active] = useActiveJourney()
    const { data: plan } = usePlan(active?.planId)
    const [dismissed, setDismissed] = useStored(dismissedStore)
    const [keyboard, setKeyboard] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true))
        const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false))
        const t = setInterval(() => setNow(Date.now()), 30_000)
        return () => { show.remove(); hide.remove(); clearInterval(t) }
    }, [])

    if (!active || !plan || plan.ID !== active.planId || dismissed === plan.ID || keyboard || !TAB_PATHS.has(pathname)) return null
    const arrival = goTime(plan.ArrivalTime as unknown as string)
    if (arrival && now > arrival.getTime() + RESUME_GRACE_MS) return null
    const to = destinationLabel(plan)
    const arrives = arrival ? laClock(arrival, region.timeZone) : ""

    return (
        // Above the tab bar: iOS's floating glass bar, Android's bottom navigation.
        <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + (Platform.OS === "ios" ? 70 : 88) }]}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Resume journey to ${to}${arrives ? `, arrives ${arrives}` : ""}`}
                    onPress={() => router.push({ pathname: "/journey/track/[id]", params: { id: plan.ID } })}
                    style={styles.main}
                >
                    <View style={[styles.icon, { backgroundColor: colors.live }]}><Navigation size={13} color="#fff" /></View>
                    <View style={{ flex: 1, gap: 1 }}>
                        <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={1}>Journey to {to}</Text>
                        <View style={styles.sub}>
                            <View style={[styles.dot, { backgroundColor: colors.success }]} />
                            <Text style={[type.meta, { color: colors.mutedForeground, flexShrink: 1 }]} numberOfLines={1}>{arrives ? `Arrives ${arrives} · ` : ""}Tap to resume</Text>
                        </View>
                    </View>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => setDismissed(plan.ID)} style={styles.close}>
                    <X size={12} color={colors.mutedForeground} />
                </Pressable>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.lg },
    card: {
        width: "100%", maxWidth: 440, flexDirection: "row", alignItems: "center", gap: 10,
        paddingLeft: 14, paddingRight: 6, paddingVertical: 10, borderRadius: radius.xl + 4, borderWidth: 1,
        shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
    },
    main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    sub: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    close: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
})
