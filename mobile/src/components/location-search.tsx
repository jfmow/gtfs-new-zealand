import { useQuery } from "@tanstack/react-query"
import { LocateFixed, MapPin } from "@/components/icons"
import { Pressable, StyleSheet, Text, View } from "react-native"
import type { Coordinate } from "@transit/shared/models"
import { api } from "@/lib/api"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"
import { Loading, Muted } from "./ui"

export interface PickedPlace {
    label: string
    lat: number
    lon: number
}

/** Places and stops matching `query` (`map/search`), plus "Current location". */
export function LocationResults({ query, onPick, showCurrent = true }: { query: string; onPick: (p: PickedPlace) => void; showCurrent?: boolean }) {
    const colors = useColors()
    const { region, ready } = useRegion()
    const location = useUserLocation(false)
    const here = coordinateOf(location)
    const q = query.trim()
    const results = useQuery({
        queryKey: ["places", region.url, q],
        queryFn: async () => (await unwrap(api.searchLocations(q, 8))) ?? [],
        enabled: ready && q.length >= 2,
        staleTime: 60_000,
    })

    return (
        <View>
            {showCurrent && here ? (
                <Row icon={LocateFixed} title="Current location" onPress={async () => onPick({ label: await placeName(here), lat: here.lat, lon: here.lon })} />
            ) : null}
            {q.length >= 2 && results.isLoading ? <Loading /> : null}
            {results.data?.map((r) => (
                <Row key={`${r.id}-${r.lat}`} icon={MapPin} title={r.label.split(",")[0]} subtitle={r.label.split(",").slice(1, 3).join(",").trim()} onPress={() => onPick({ label: r.label.split(",")[0], lat: r.lat, lon: r.lon })} />
            ))}
            {q.length >= 2 && results.data?.length === 0 ? <Muted style={{ padding: spacing.md }}>No places match.</Muted> : null}
            {results.error ? <Muted style={{ padding: spacing.md }}>{(results.error as Error).message}</Muted> : null}
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        </View>
    )
}

/** A reverse-geocoded name for a coordinate, or "Current location". */
export async function placeName(c: Coordinate): Promise<string> {
    const res = await api.reverseGeocode(c)
    return res.ok && res.data?.name ? res.data.name : "Current location"
}

function Row({ icon: Icon, title, subtitle, onPress }: { icon: typeof MapPin; title: string; subtitle?: string; onPress: () => void }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, { borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}>
            <Icon size={18} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
                {subtitle ? <Muted>{subtitle}</Muted> : null}
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
})
