import { useQuery } from "@tanstack/react-query"
import * as Linking from "expo-linking"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Bell, ChevronLeft, EllipsisCircle, Star, TriangleAlert } from "@/components/icons"
import { useState } from "react"
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { cleanStopName } from "@transit/shared/formatting"
import { alertStatus, filterAndSortDepartures } from "@transit/shared/logic/basics"
import { getRegionSlug, hasRealtime } from "@transit/shared/regions"
import { DepartureRow } from "@/components/departures"
import { Capsule, CapsuleButton, Chip, EmptyState, ErrorText, GlassButton, Loading, Muted } from "@/components/ui"
import { api } from "@/lib/api"
import { unwrap, useDepartures, useStopAlerts } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSavedStops } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** Days for "Timetable for a date": today and the next week. */
function nextDays(tz: string) {
    return Array.from({ length: 8 }, (_, i) => {
        const d = new Date(Date.now() + i * 86_400_000)
        d.setHours(12, 0, 0, 0)
        const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-NZ", { timeZone: tz, weekday: "short", day: "numeric" }).format(d)
        return { date: d, label }
    })
}

/** A stop's live departure board - iOS `StopBoardView`. `query` is the "name code" board query. */
export default function StopBoard() {
    const colors = useColors()
    const { query } = useLocalSearchParams<{ query: string }>()
    const { region, ready } = useRegion()
    const saved = useSavedStops(getRegionSlug(region))
    const board = useDepartures(query ?? null)
    const alerts = useStopAlerts(query ?? null, true)
    const [platform, setPlatform] = useState<string | null>(null)
    const [scheduleDay, setScheduleDay] = useState<Date | null>(null)
    const schedule = useQuery({
        queryKey: ["schedule", region.url, query, scheduleDay?.toDateString()],
        queryFn: async () => filterAndSortDepartures((await unwrap(api.schedule(query!, scheduleDay!))) ?? []).filter(() => true),
        enabled: ready && !!query && !!scheduleDay,
    })

    const first = board.data?.[0]?.stop
    const stopId = first?.parent_stop_id || first?.child_stop_id || query
    const savedEntry = saved.stops.find((s) => s.query === query || s.stopId === stopId)
    const todaysAlerts = Object.values(alerts.data?.alerts ?? {}).flat().filter((a) => alertStatus(a).kind !== "inactive")
    const rows = (scheduleDay ? schedule.data : board.data) ?? []
    const platforms = [...new Set((board.data ?? []).map((d) => d.platform).filter((p) => p && p !== "no platform"))].sort()
    const shown = platform ? rows.filter((d) => d.platform === platform) : rows

    const toggleSave = () => {
        if (savedEntry) saved.remove(savedEntry.stopId)
        else saved.toggle({ query: query!, stopId: stopId!, name: query!, code: "", lat: first?.lat ?? 0, lon: first?.lon ?? 0, type: "other" })
    }
    const more = () => {
        const options: { label: string; run: () => void }[] = [
            { label: "Directions to stop", run: () => first && Linking.openURL(Platform.OS === "ios" ? `maps://?daddr=${first.lat},${first.lon}&dirflg=w` : `google.navigation:q=${first.lat},${first.lon}&mode=w`) },
            { label: "Timetable for a date", run: () => setScheduleDay(nextDays(region.timeZone)[1].date) },
        ]
        if (hasRealtime(region)) options.push({ label: "Service alerts", run: () => router.push({ pathname: "/alerts/stop", params: { stop: query } }) })
        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions({ options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length }, (i) => options[i]?.run())
        } else {
            Alert.alert(cleanStopName(query ?? ""), undefined, [...options.map((o) => ({ text: o.label, onPress: o.run })), { text: "Cancel", style: "cancel" as const }])
        }
    }

    return (
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={styles.header}>
                <GlassButton icon={ChevronLeft} label="Back" onPress={() => router.back()} size={44} />
                <Text style={[type.pageTitle, { flex: 1, color: colors.foreground, fontSize: 17 }]} numberOfLines={1}>{cleanStopName(query ?? "Stop")}</Text>
                <Capsule>
                    {hasRealtime(region) ? <CapsuleButton icon={Bell} label="Get alerts for this stop" onPress={() => router.push({ pathname: "/alerts/subscribe", params: { stop: query } })} /> : null}
                    <CapsuleButton icon={Star} label={savedEntry ? "Remove from saved" : "Save stop"} onPress={toggleSave} color={savedEntry ? "#eab308" : undefined} fill={savedEntry ? "#eab308" : undefined} />
                    <CapsuleButton icon={EllipsisCircle} label="More" onPress={more} />
                </Capsule>
            </View>

            {scheduleDay ? (
                <View style={[styles.scheduleBar, { backgroundColor: colors.muted }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, alignItems: "center" }}>
                        {nextDays(region.timeZone).map((d) => (
                            <Chip key={d.label} label={d.label} selected={d.date.toDateString() === scheduleDay.toDateString()} onPress={() => setScheduleDay(d.date)} />
                        ))}
                    </ScrollView>
                    <Pressable accessibilityRole="button" onPress={() => setScheduleDay(null)} style={[styles.backToLive, { backgroundColor: colors.primary }]}>
                        <Text style={[type.metaMedium, { color: colors.primaryForeground }]}>Back to live</Text>
                    </Pressable>
                </View>
            ) : null}

            {platforms.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
                    <Chip label="All platforms" selected={!platform} onPress={() => setPlatform(null)} />
                    {platforms.map((p) => <Chip key={p} label={`Platform ${p}`} selected={platform === p} onPress={() => setPlatform(p)} />)}
                </ScrollView>
            ) : null}

            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={board.isRefetching} onRefresh={() => { board.refetch() }} />}
            >
                {todaysAlerts.length > 0 && !scheduleDay ? (
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/alerts/stop", params: { stop: query } })} style={[styles.alert, { backgroundColor: colors.warning + "1A", borderColor: colors.warning + "55" }]}>
                        <TriangleAlert size={18} color={colors.warning} />
                        <View style={{ flex: 1 }}>
                            <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={2}>{todaysAlerts[0].title}</Text>
                            {todaysAlerts.length > 1 ? <Muted>+{todaysAlerts.length - 1} more service alerts</Muted> : null}
                        </View>
                    </Pressable>
                ) : null}

                {(scheduleDay ? schedule.isLoading : board.isLoading) ? <Loading /> : null}
                {board.error && !scheduleDay ? <ErrorText>{(board.error as Error).message}</ErrorText> : null}
                {!board.isLoading && shown.length === 0 ? <EmptyState title={scheduleDay ? "No services that day" : "No more departures today"} /> : null}
                {shown.length > 0 ? (
                    <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {shown.map((d, i) => (
                            <View key={`${d.trip_id}-${d.stop.child_stop_id}`} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}>
                                <DepartureRow d={d} preview={!!scheduleDay} stopName={query} />
                            </View>
                        ))}
                    </View>
                ) : null}
                {!hasRealtime(region) ? <Muted style={{ marginTop: spacing.md }}>Timetable only - this region publishes no live data.</Muted> : null}
            </ScrollView>
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 130 },
    list: { borderRadius: radius.xl, borderWidth: 1, overflow: "hidden" },
    alert: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md },
    scheduleBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, padding: spacing.sm, borderRadius: radius.lg },
    backToLive: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 16 },
})
