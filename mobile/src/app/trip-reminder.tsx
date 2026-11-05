import { Stack, router, useLocalSearchParams } from "expo-router"
import { Footprints, Hash, Minus, Navigation, Plus } from "@/components/icons"
import { useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { api } from "@/lib/api"
import { requestNotifications } from "@/lib/push"
import { radius, spacing, type, useColors } from "@/theme"

/**
 * "Remind me before it arrives" - iOS `TripReminders` sheet: a one-off
 * notification as the vehicle reaches this stop, or N stops before.
 */
export default function TripReminderSheet() {
    const colors = useColors()
    const { tripId, stopId, stopName, getOff } = useLocalSearchParams<{ tripId: string; stopId: string; stopName?: string; getOff?: string }>()
    /** Off when set from a board - you're getting on there, not off. */
    const offersGetOff = getOff === "1"
    const [stops, setStops] = useState(2)
    const [busy, setBusy] = useState(false)

    const set = async (kind: "get_off" | "arrival" | "n_stops_away") => {
        if (!(await requestNotifications())) {
            Alert.alert("Notifications are off", "Turn them on for Transit in Settings to get reminders.")
            return
        }
        setBusy(true)
        const res = await api.addTripReminder(tripId!, stopId!, kind, kind === "n_stops_away" ? stops : undefined)
        setBusy(false)
        if (!res.ok) {
            Alert.alert("Couldn't set the reminder", res.error)
            return
        }
        router.back()
    }

    return (
        <>
            <Stack.Screen options={{ title: stopName ?? "Reminder" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content}>
                <Text style={[type.body, { color: colors.foreground, marginLeft: spacing.sm, marginBottom: spacing.sm }]}>Notify me</Text>
                <View style={[styles.group, { backgroundColor: colors.card }]}>
                    {offersGetOff ? (
                        <>
                            <Pressable accessibilityRole="button" disabled={busy} onPress={() => set("get_off")} style={styles.row}>
                                <Footprints size={22} color={colors.live} />
                                <View style={{ flex: 1 }}>
                                    <Text style={[type.body, { color: colors.foreground, fontSize: 17 }]}>Get off here</Text>
                                    <Text style={[type.meta, { color: colors.mutedForeground, fontSize: 14 }]}>When this is the next stop</Text>
                                </View>
                            </Pressable>
                            <View style={[styles.divider, { backgroundColor: colors.border }]} />
                        </>
                    ) : null}
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => set("arrival")} style={styles.row}>
                        <Navigation size={22} color={colors.live} fill={colors.live} />
                        <View style={{ flex: 1 }}>
                            <Text style={[type.body, { color: colors.foreground, fontSize: 17 }]}>{"When it's arriving"}</Text>
                            <Text style={[type.meta, { color: colors.mutedForeground, fontSize: 14 }]}>As the vehicle reaches this stop</Text>
                        </View>
                    </Pressable>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => set("n_stops_away")} style={styles.row}>
                        <Hash size={22} color={colors.live} />
                        <View style={{ flex: 1 }}>
                            <Text style={[type.body, { color: colors.foreground, fontSize: 17 }]}>{stops} {stops === 1 ? "stop" : "stops"} before</Text>
                            <Text style={[type.meta, { color: colors.mutedForeground, fontSize: 14 }]}>{"A heads-up while it's on the way"}</Text>
                        </View>
                        <View style={[styles.stepper, { backgroundColor: colors.muted }]}>
                            <Pressable accessibilityRole="button" accessibilityLabel="Fewer stops" hitSlop={6} onPress={() => setStops((n) => Math.max(1, n - 1))} style={styles.step}>
                                <Minus size={20} color={colors.foreground} />
                            </Pressable>
                            <View style={{ width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.mutedForeground }} />
                            <Pressable accessibilityRole="button" accessibilityLabel="More stops" hitSlop={6} onPress={() => setStops((n) => Math.min(20, n + 1))} style={styles.step}>
                                <Plus size={20} color={colors.foreground} />
                            </Pressable>
                        </View>
                    </Pressable>
                </View>
                <Text style={[type.body, { color: colors.foreground, marginLeft: spacing.sm, marginTop: spacing.md }]}>A one-off notification for this trip.</Text>
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg },
    group: { borderRadius: 22, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, minHeight: 64 },
    divider: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
    stepper: { flexDirection: "row", alignItems: "center", borderRadius: radius.lg * 2 },
    step: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
})
