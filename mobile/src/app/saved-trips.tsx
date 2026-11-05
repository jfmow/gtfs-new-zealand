import { Stack } from "expo-router"
import { Route as RouteIcon, Trash2 } from "@/components/icons"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { getRegionSlug } from "@transit/shared/regions"
import { EmptyState } from "@/components/ui"
import { useRegion } from "@/lib/region"
import { savedTripsStore, useSavedTrips } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** "Manage trips" - iOS `SavedTripsViews`: rename or delete saved trips. */
export default function SavedTrips() {
    const colors = useColors()
    const { region } = useRegion()
    const { trips, remove } = useSavedTrips(getRegionSlug(region))
    const rename = (id: string, name: string) => savedTripsStore.set((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)))
    return (
        <>
            <Stack.Screen options={{ title: "Saved trips" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={{ padding: spacing.lg }}>
                {trips.length === 0 ? <EmptyState icon={RouteIcon} title="No saved trips" body="Plan a journey, then save it from its details." /> : null}
                <View style={[styles.group, { backgroundColor: colors.card }]}>
                    {trips.map((t, i) => (
                        <View key={t.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                            <View style={[styles.icon, { backgroundColor: "#8b5cf626" }]}><RouteIcon size={20} color="#8b5cf6" /></View>
                            <View style={{ flex: 1 }}>
                                <TextInput defaultValue={t.name} onEndEditing={(e) => e.nativeEvent.text.trim() && rename(t.id, e.nativeEvent.text.trim())} accessibilityLabel={`Rename ${t.name}`} style={[type.bodyMedium, { fontSize: 17, color: colors.foreground, paddingVertical: 2 }]} />
                                <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{t.from.label} → {t.to.label}</Text>
                            </View>
                            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${t.name}`} hitSlop={8} onPress={() => remove(t.id)}>
                                <Trash2 size={18} color={colors.danger} />
                            </Pressable>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    group: { borderRadius: 18, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
    icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
})
