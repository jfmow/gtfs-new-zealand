import { useQuery } from "@tanstack/react-query"
import { Stack, router } from "expo-router"
import { Check } from "@/components/icons"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Button, Loading, Muted, RouteBadge, SearchField } from "@/components/ui"
import { api } from "@/lib/api"
import { useMapFilter } from "@/lib/map-filter"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** "Find a route…" for the Map's vehicles - iOS `RouteMultiSelect`: pick routes to show, Done. */
export default function RouteFilter() {
    const colors = useColors()
    const { region, ready } = useRegion()
    const [filter, setFilter] = useMapFilter()
    const [q, setQ] = useState("")
    const [picked, setPicked] = useState(filter.routes)
    const all = useQuery({ queryKey: ["routes", region.url], queryFn: async () => (await unwrap(api.routes())) ?? {}, enabled: ready, staleTime: Infinity })

    const term = q.trim().toLowerCase()
    const routes = Object.values(all.data ?? {})
        .filter((r) => !term || r.route_short_name.toLowerCase().includes(term) || r.route_long_name.toLowerCase().includes(term))
        .sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, { numeric: true }))
        .slice(0, 80)
    const toggle = (id: string, name: string) => setPicked((p) => (p.some((r) => r.id === id) ? p.filter((r) => r.id !== id) : [...p, { id, name }]))

    return (
        <>
            <Stack.Screen options={{ title: "Find a route" }} />
            <View style={{ flex: 1, backgroundColor: colors.grouped }}>
                <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                    <SearchField value={q} onChangeText={setQ} placeholder="Route number or name" autoFocus accessibilityLabel="Find a route" />
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 100 }}>
                    {all.isLoading ? <Loading /> : null}
                    {!all.isLoading && routes.length === 0 ? <Muted>No routes match.</Muted> : null}
                    <View style={[styles.group, { backgroundColor: colors.card }]}>
                        {routes.map((r, i) => {
                            const on = picked.some((p) => p.id === r.route_id)
                            return (
                                <Pressable key={r.route_id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={r.route_short_name} onPress={() => toggle(r.route_id, r.route_short_name)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                                    <View style={{ minWidth: 52 }}><RouteBadge name={r.route_short_name} color={r.route_color} /></View>
                                    <Text style={[type.body, { flex: 1, color: colors.foreground }]} numberOfLines={1}>{r.route_long_name}</Text>
                                    {on ? <Check size={18} color={colors.primary} /> : null}
                                </Pressable>
                            )
                        })}
                    </View>
                </ScrollView>
                <View style={[styles.footer, { backgroundColor: colors.grouped, borderTopColor: colors.border }]}>
                    <Button title={picked.length ? `Show ${picked.length} route${picked.length > 1 ? "s" : ""}` : "Show all routes"} onPress={() => { setFilter({ routes: picked }); router.back() }} />
                </View>
            </View>
        </>
    )
}

const styles = StyleSheet.create({
    group: { borderRadius: 18, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
})
