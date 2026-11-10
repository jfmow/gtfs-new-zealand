import { Stack, router } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { getRegionSlug } from "@transit/shared/regions"
import { ArrowDown, ArrowUp, Briefcase, ChevronRight, House, Plus } from "@/components/icons"
import { placeStyle, placeTitle } from "@/components/place-style"
import { HeaderTextButton } from "@/components/ui"
import { readable, useLayout } from "@/lib/layout"
import { useRegion } from "@/lib/region"
import { useSavedPlaces } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** Your places: reorder them (Home's launcher and the Planner follow this order), tap one to edit its place, name, icon or colour. */
export default function Places() {
    const colors = useColors()
    const { wide } = useLayout()
    const { region } = useRegion()
    const places = useSavedPlaces(getRegionSlug(region))
    const list = places.places

    return (
        <>
            <Stack.Screen options={{ title: "Your places", headerRight: () => <HeaderTextButton title="Done" side="right" bold onPress={() => router.back()} /> }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={[styles.content, readable(wide)]}>
                {list.length ? (
                    <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {list.map((p, i) => {
                            const s = placeStyle(p)
                            const Icon = s.icon
                            return (
                                <View key={p.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${placeTitle(p)}`} onPress={() => router.push({ pathname: "/place", params: { id: p.id } })} style={({ pressed }) => [styles.main, pressed && { opacity: 0.6 }]}>
                                        <View style={[styles.tile, { backgroundColor: s.color + "33" }]}><Icon size={17} color={s.color} /></View>
                                        <View style={{ flex: 1, gap: 1 }}>
                                            <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={1}>{placeTitle(p)}</Text>
                                            {p.kind !== "other" && p.label !== placeTitle(p) ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{p.label}</Text> : null}
                                        </View>
                                        <ChevronRight size={12} color={colors.mutedForeground + "99"} />
                                    </Pressable>
                                    <Move icon={ArrowUp} label={`Move ${placeTitle(p)} up`} disabled={i === 0} onPress={() => places.move(p.id, -1)} />
                                    <Move icon={ArrowDown} label={`Move ${placeTitle(p)} down`} disabled={i === list.length - 1} onPress={() => places.move(p.id, 1)} />
                                </View>
                            )
                        })}
                    </View>
                ) : (
                    <Text style={[type.body, { color: colors.mutedForeground, textAlign: "center", marginVertical: spacing.xl }]}>No saved places yet.</Text>
                )}

                <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border, marginTop: spacing.xl }]}>
                    {!places.home ? <AddRow icon={House} label="Add home" onPress={() => router.push({ pathname: "/place", params: { kind: "home" } })} /> : null}
                    {!places.work ? <AddRow icon={Briefcase} label="Add work" border={!places.home} onPress={() => router.push({ pathname: "/place", params: { kind: "work" } })} /> : null}
                    <AddRow icon={Plus} label="Add a place" border={!places.home || !places.work} onPress={() => router.push({ pathname: "/place", params: { kind: "other" } })} />
                </View>
            </ScrollView>
        </>
    )
}

function Move({ icon: Icon, label, disabled, onPress }: { icon: typeof ArrowUp; label: string; disabled: boolean; onPress: () => void }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} hitSlop={4} onPress={onPress} style={[styles.move, { opacity: disabled ? 0.25 : 1 }]}>
            <Icon size={17} color={colors.mutedForeground} />
        </Pressable>
    )
}

function AddRow({ icon: Icon, label, onPress, border }: { icon: typeof Plus; label: string; onPress: () => void; border?: boolean }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, styles.main, border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}>
            <View style={[styles.tile, { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.mutedForeground + "88" }]}><Icon size={15} color={colors.mutedForeground} /></View>
            <Text style={[type.bodyMedium, { color: colors.foreground }]}>{label}</Text>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    group: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", paddingRight: spacing.xs },
    main: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: 14, paddingVertical: 10 },
    tile: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    move: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
})
