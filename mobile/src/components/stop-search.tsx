import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { cleanStopName } from "@transit/shared/formatting"
import type { StopSearchResult } from "@transit/shared/types/stops"
import { Loading, ModeIcon, Muted } from "@/components/ui"
import { api } from "@/lib/api"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** Stops matching a search - opens the board, or with `navigate={false}` just hands the stop back. */
export function StopSearchResults({ query, onPick, navigate = true }: { query: string; onPick?: (s: StopSearchResult) => void; navigate?: boolean }) {
    const colors = useColors()
    const { region, ready } = useRegion()
    const { data, isLoading, error } = useQuery({
        queryKey: ["find-stop", region.url, query],
        queryFn: async () => (await unwrap(api.findStop(query))) ?? [],
        enabled: ready,
        staleTime: 60_000,
    })
    if (isLoading) return <Loading />
    if (error) return <Muted style={{ margin: spacing.lg }}>{(error as Error).message}</Muted>
    if (!data?.length) return <Muted style={{ margin: spacing.lg }}>No stops match.</Muted>
    return (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}>
            {data.map((s) => (
                <Pressable
                    key={s.stop_id}
                    accessibilityRole="button"
                    accessibilityLabel={s.name}
                    onPress={() => {
                        onPick?.(s)
                        if (navigate) router.push({ pathname: "/stop/[query]", params: { query: s.name } })
                    }}
                    style={({ pressed }) => [styles.result, { borderBottomColor: colors.border }, pressed && { opacity: 0.6 }]}
                >
                    <View style={[styles.resultIcon, { backgroundColor: colors.muted }]}>
                        <ModeIcon mode={s.type_of_stop} size={18} color={colors.foreground} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[type.bodyMedium, { color: colors.foreground }]}>{cleanStopName(s.name)}</Text>
                        {s.stop_code ? <Muted>Stop {s.stop_code}</Muted> : null}
                    </View>
                </Pressable>
            ))}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    result: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
    resultIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
})
