import DateTimePicker from "@react-native-community/datetimepicker"
import { Stack, router } from "expo-router"
import { useState } from "react"
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { laClock } from "@transit/shared/logic/journey-live"
import { Button, Segmented } from "@/components/ui"
import { plannerWhenStore, type PlannerWhen } from "@/lib/planner-store"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** The Planner's "Leave now ▾" sheet - iOS's When menu: Leave now, Leave at…, Arrive by…, with a date and time. */
export default function PlannerTime() {
    const colors = useColors()
    const { region } = useRegion()
    const current = plannerWhenStore.get()
    const [mode, setMode] = useState<PlannerWhen["mode"]>(current.mode)
    const [at, setAt] = useState(() => new Date(current.at ?? Date.now() + (current.mode === "arriveat" ? 3_600_000 : 15 * 60_000)))
    const [androidPicker, setAndroidPicker] = useState<"date" | "time" | null>(null)
    const [earliest] = useState(() => new Date(Date.now() - 60 * 60_000))

    const done = () => {
        plannerWhenStore.set(mode === "now" ? { mode: "now", at: null } : { mode, at: at.getTime() })
        router.back()
    }

    return (
        <>
            <Stack.Screen options={{ title: "When" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content}>
                <Segmented<PlannerWhen["mode"]>
                    options={[{ value: "now", label: "Leave now" }, { value: "departat", label: "Leave at" }, { value: "arriveat", label: "Arrive by" }]}
                    value={mode}
                    onChange={setMode}
                />
                {mode !== "now" ? (
                    Platform.OS === "ios" ? (
                        <View style={[styles.pickerCard, { backgroundColor: colors.card }]}>
                            <DateTimePicker value={at} mode="datetime" display="inline" minimumDate={earliest} onChange={(_, d) => d && setAt(d)} accentColor={colors.primary} />
                        </View>
                    ) : (
                        <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
                            <Pressable accessibilityRole="button" onPress={() => setAndroidPicker("date")} style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[type.meta, { color: colors.mutedForeground }]}>Date</Text>
                                <Text style={[type.bodyMedium, { color: colors.foreground }]}>{at.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => setAndroidPicker("time")} style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[type.meta, { color: colors.mutedForeground }]}>Time</Text>
                                <Text style={[type.bodyMedium, { color: colors.foreground }]}>{laClock(at, region.timeZone)}</Text>
                            </Pressable>
                            {androidPicker ? (
                                <DateTimePicker value={at} mode={androidPicker} onChange={(_, d) => { setAndroidPicker(null); if (d) setAt(d) }} />
                            ) : null}
                        </View>
                    )
                ) : null}
                <Button title="Done" onPress={done} style={{ marginTop: spacing.xl }} />
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg },
    pickerCard: { borderRadius: 18, marginTop: spacing.lg, padding: spacing.sm },
    field: { flex: 1, padding: spacing.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
})
