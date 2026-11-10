import { useQuery } from "@tanstack/react-query"
import { Stack, router } from "expo-router"
import { Bus, Minus, Plus, Ship, TrainFront, X } from "@/components/icons"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { TRAVEL_MODES, type TravelMode } from "@transit/shared/endpoints"
import { WALK_SPEED_OPTIONS, normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { Button, Chip, RouteBadge, SearchField, Segmented } from "@/components/ui"
import { api } from "@/lib/api"
import { DEFAULT_PLANNER_OPTIONS, usePlannerOptions } from "@/lib/planner-store"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import { spacing, type, useColors } from "@/theme"

const MODE_ICON = { bus: Bus, train: TrainFront, ferry: Ship } as const
const WALK_STEPS = [0.3, 0.5, 0.8, 1, 1.5, 2, 3]

/** The Planner's Options sheet - iOS: Max walk, Speed, Transfers, Transport, Routes. */
export default function PlannerOptions() {
    const colors = useColors()
    const { region, ready } = useRegion()
    const [settings, updateSettings] = useSettings()
    const [options, setOptions] = usePlannerOptions()
    const [routeQuery, setRouteQuery] = useState("")
    const routes = useQuery({ queryKey: ["routes", region.url], queryFn: async () => (await unwrap(api.routes())) ?? {}, enabled: ready, staleTime: Infinity })
    const term = routeQuery.trim().toLowerCase()
    const matches = term ? Object.values(routes.data ?? {}).filter((r) => r.route_short_name.toLowerCase().startsWith(term)).slice(0, 8) : []
    const walkIndex = Math.max(0, WALK_STEPS.findIndex((w) => w >= options.maxWalkKm))
    const toggleMode = (m: TravelMode) => setOptions({ modes: options.modes.includes(m) ? options.modes.filter((x) => x !== m) : [...options.modes, m] })

    return (
        <>
            <Stack.Screen options={{ title: "Options" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Card title="Max walk">
                    <Stepper value={`${options.maxWalkKm < 1 ? `${Math.round(options.maxWalkKm * 1000)} m` : `${options.maxWalkKm} km`}`}
                        onMinus={() => setOptions({ maxWalkKm: WALK_STEPS[Math.max(0, walkIndex - 1)] })}
                        onPlus={() => setOptions({ maxWalkKm: WALK_STEPS[Math.min(WALK_STEPS.length - 1, walkIndex + 1)] })} />
                </Card>
                <Card title="Speed">
                    <Segmented options={WALK_SPEED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={normalizeWalkSpeed(settings.walkSpeed)} onChange={(v) => updateSettings({ walkSpeed: v })} />
                </Card>
                <Card title="Transfers">
                    <Stepper value={options.maxTransfers === 0 ? "Direct only" : `Up to ${options.maxTransfers}`}
                        onMinus={() => setOptions({ maxTransfers: Math.max(0, options.maxTransfers - 1) })}
                        onPlus={() => setOptions({ maxTransfers: Math.min(5, options.maxTransfers + 1) })} />
                </Card>
                <Card title="Transport" note="Leave all off to use any transport.">
                    <View style={styles.wrap}>
                        {TRAVEL_MODES.map((m) => <Chip key={m} icon={MODE_ICON[m]} label={m[0].toUpperCase() + m.slice(1)} selected={options.modes.includes(m)} onPress={() => toggleMode(m)} />)}
                    </View>
                </Card>
                <Card title="Routes" note="Leave empty to use any route.">
                    <View style={styles.wrap}>
                        {options.onlyRoutes.map((r) => (
                            <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`Remove route ${r.name}`} onPress={() => setOptions({ onlyRoutes: options.onlyRoutes.filter((x) => x.id !== r.id) })} style={styles.routeChip}>
                                <RouteBadge name={r.name} color={routes.data?.[r.id]?.route_color} />
                                <X size={14} color={colors.mutedForeground} />
                            </Pressable>
                        ))}
                    </View>
                    <SearchField value={routeQuery} onChangeText={setRouteQuery} placeholder="Add a route" accessibilityLabel="Add a route" style={{ marginTop: spacing.sm }} />
                    {matches.map((r) => (
                        <Pressable key={r.route_id} accessibilityRole="button" onPress={() => { setOptions({ onlyRoutes: [...options.onlyRoutes.filter((x) => x.id !== r.route_id), { id: r.route_id, name: r.route_short_name }] }); setRouteQuery("") }} style={styles.match}>
                            <RouteBadge name={r.route_short_name} color={r.route_color} />
                            <Text style={[type.body, { flex: 1, color: colors.foreground }]} numberOfLines={1}>{r.route_long_name}</Text>
                        </Pressable>
                    ))}
                </Card>
                <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
                    <Button title="Reset" variant="secondary" onPress={() => setOptions(DEFAULT_PLANNER_OPTIONS)} style={{ flex: 1 }} />
                    <Button title="Done" onPress={() => router.back()} style={{ flex: 1 }} />
                </View>
            </ScrollView>
        </>
    )
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
    const colors = useColors()
    return (
        <View style={{ marginBottom: spacing.lg }}>
            <Text style={[type.body, { color: colors.mutedForeground, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>{title}</Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>
            {note ? <Text style={[type.meta, { color: colors.mutedForeground, marginTop: spacing.xs, marginLeft: spacing.xs }]}>{note}</Text> : null}
        </View>
    )
}

function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
    const colors = useColors()
    return (
        <View style={styles.stepperRow}>
            <Text style={[type.bodyMedium, { flex: 1, fontSize: 17, color: colors.foreground }]}>{value}</Text>
            <View style={[styles.stepper, { backgroundColor: colors.muted }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="Less" onPress={onMinus} style={styles.step}><Minus size={20} color={colors.foreground} /></Pressable>
                <View style={{ width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.mutedForeground }} />
                <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={onPlus} style={styles.step}><Plus size={20} color={colors.foreground} /></Pressable>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    card: { borderRadius: 18, padding: spacing.md },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    stepperRow: { flexDirection: "row", alignItems: "center" },
    stepper: { flexDirection: "row", alignItems: "center", borderRadius: 22 },
    step: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    routeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
    match: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
})
