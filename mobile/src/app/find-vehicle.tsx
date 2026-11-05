import { useQuery } from "@tanstack/react-query"
import { Stack, router } from "expo-router"
import { ChevronRight, MapPinOff } from "@/components/icons"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { headsignDisplay } from "@transit/shared/formatting"
import { formatDistance } from "@transit/shared/logic/basics"
import { EmptyState, ErrorText, Loading, RouteBadge } from "@/components/ui"
import { api } from "@/lib/api"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** "Find my vehicle" - iOS `FindMyVehicleSheet`: the vehicles around you, closest first; tap the one you're on. */
export default function FindVehicle() {
    const colors = useColors()
    const { region, ready } = useRegion()
    const location = useUserLocation()
    const here = coordinateOf(location)
    const routes = useQuery({ queryKey: ["routes", region.url], queryFn: async () => (await unwrap(api.routes())) ?? {}, enabled: ready, staleTime: Infinity })
    const near = useQuery({
        queryKey: ["find-my-vehicle", region.url, here ? `${here.lat.toFixed(4)},${here.lon.toFixed(4)}` : null],
        queryFn: async () => ((await unwrap(api.findMyVehicle(here!))) ?? []).sort((a, b) => a.distance_from_vehicle - b.distance_from_vehicle),
        enabled: ready && !!here,
        refetchInterval: 15_000,
    })

    return (
        <>
            <Stack.Screen options={{ title: "Find my vehicle" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content}>
                <Text style={[type.body, { color: colors.mutedForeground, marginBottom: spacing.md }]}>{"Tap the one you're on to follow it live."}</Text>
                {location.status === "denied" ? <EmptyState icon={MapPinOff} title="Location is off" body="Turn on location in Settings to find the vehicle you're on." /> : null}
                {location.status !== "denied" && (!here || near.isLoading) ? (
                    <View style={{ alignItems: "center", gap: spacing.sm }}>
                        <Loading />
                        <Text style={[type.meta, { color: colors.mutedForeground }]}>Finding vehicles near you...</Text>
                    </View>
                ) : null}
                {near.error ? <ErrorText>{(near.error as Error).message}</ErrorText> : null}
                {near.data && near.data.length === 0 ? <EmptyState title="No vehicles nearby" body="Nothing live is close enough - try again in a moment." /> : null}
                {near.data && near.data.length > 0 ? (
                    <View style={[styles.group, { backgroundColor: colors.card }]}>
                        {near.data.map((v, i) => {
                            const route = routes.data?.[v.routeId]
                            const name = route?.route_short_name || v.routeId
                            return (
                                <Pressable
                                    key={v.tripId}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${name} to ${headsignDisplay(v.tripHeadsign)}, ${formatDistance(v.distance_from_vehicle)} away${i === 0 ? ", closest" : ""}`}
                                    onPress={() => router.replace({ pathname: "/trip/[tripId]", params: { tripId: v.tripId } })}
                                    style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}
                                >
                                    <View style={{ minWidth: 48 }}><RouteBadge name={name} color={route?.route_color} /></View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={1}>{headsignDisplay(v.tripHeadsign)}</Text>
                                        <Text style={[type.meta, { color: colors.mutedForeground }]}>{formatDistance(v.distance_from_vehicle)} away</Text>
                                    </View>
                                    {i === 0 ? <Text style={[type.badge, styles.closest, { color: colors.live, borderColor: colors.live }]}>Closest</Text> : null}
                                    <ChevronRight size={18} color={colors.mutedForeground} />
                                </Pressable>
                            )
                        })}
                    </View>
                ) : null}
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg },
    group: { borderRadius: 18, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 60 },
    closest: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
})
