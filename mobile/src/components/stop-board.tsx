import { useQuery } from "@tanstack/react-query"
import * as Linking from "expo-linking"
import { router } from "expo-router"
import { Bell, ChevronLeft, ChevronRight, EllipsisCircle, MapPinOff, Star, TriangleAlert, X } from "@/components/icons"
import { useState } from "react"
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { readable, useLayout } from "@/lib/layout"
import { cleanStopName } from "@transit/shared/formatting"
import { alertStatus, filterAndSortDepartures } from "@transit/shared/logic/basics"
import { getRegionSlug, hasRealtime } from "@transit/shared/regions"
import { DepartureRow } from "@/components/departures"
import { Button, Capsule, CapsuleButton, Chip, EmptyState, GlassButton, Loading, Muted } from "@/components/ui"
import { api } from "@/lib/api"
import { unwrap, useDepartures, useStopAlerts, useStopMatches } from "@/lib/queries"
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

/** "Bus stop · 11814" - which stop this is, since several can share a name. */
function stopKindLabel(type: string, code: string): string {
    const kind = type === "train" ? "Train station" : type === "ferry" ? "Ferry terminal" : type === "bus" ? "Bus stop" : "Stop"
    return code ? `${kind} · ${code}` : kind
}

/**
 * A stop's live departure board - iOS `StopBoardView`. `query` is the
 * "name code" board query. Full screen as its own route; on wide windows
 * the Map tab also shows it `embedded` in a side panel (iOS
 * `StopBoardView(embedding:)`), where Back becomes Close.
 */
export function StopBoardView({ query, embedded, onClose }: { query: string; embedded?: boolean; onClose?: () => void }) {
    const colors = useColors()
    const { wide } = useLayout()
    const { region, ready } = useRegion()
    const saved = useSavedStops(getRegionSlug(region))
    const board = useDepartures(query || null)
    const alerts = useStopAlerts(query || null, true)
    const matches = useStopMatches(query || null)
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
    const boardError = !scheduleDay && board.error ? (board.error as Error).message : null
    // The backend 400s with "invalid stop id" when the name doesn't resolve to a stop.
    const notFound = !!boardError && /invalid stop|not found/i.test(boardError)
    const info = matches.data?.find((m) => m.name === query) ?? matches.data?.find((m) => cleanStopName(m.name) === cleanStopName(query ?? ""))
    const suggestions = notFound ? (matches.data ?? []).filter((m) => m.name !== query).slice(0, 6) : []

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
        <SafeAreaView edges={embedded ? [] : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.header, readable(wide && !embedded)]}>
                {embedded
                    ? <GlassButton icon={X} label="Close" onPress={() => onClose?.()} size={44} />
                    : <GlassButton icon={ChevronLeft} label="Back" onPress={() => (onClose ? onClose() : router.back())} size={44} />}
                <View style={{ flex: 1 }}>
                    <Text style={[type.pageTitle, { color: colors.foreground, fontSize: 17 }]} numberOfLines={1}>{cleanStopName(query ?? "Stop")}</Text>
                    {info && !notFound ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{stopKindLabel(info.type_of_stop, info.stop_code)}</Text> : null}
                </View>
                {notFound ? null : <Capsule>
                    {hasRealtime(region) ? <CapsuleButton icon={Bell} label="Get alerts for this stop" onPress={() => router.push({ pathname: "/alerts/subscribe", params: { stop: query } })} /> : null}
                    <CapsuleButton icon={Star} label={savedEntry ? "Remove from saved" : "Save stop"} onPress={toggleSave} color={savedEntry ? "#eab308" : undefined} fill={savedEntry ? "#eab308" : undefined} />
                    <CapsuleButton icon={EllipsisCircle} label="More" onPress={more} />
                </Capsule>}
            </View>

            {scheduleDay ? (
                <View style={[styles.scheduleBar, { backgroundColor: colors.muted }, readable(wide && !embedded)]}>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[styles.chips, readable(wide && !embedded)]}>
                    <Chip label="All platforms" selected={!platform} onPress={() => setPlatform(null)} />
                    {platforms.map((p) => <Chip key={p} label={`Platform ${p}`} selected={platform === p} onPress={() => setPlatform(p)} />)}
                </ScrollView>
            ) : null}

            <ScrollView
                contentContainerStyle={[styles.content, readable(wide && !embedded), embedded && { paddingBottom: spacing.xl }]}
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
                {notFound ? (
                    <>
                        <EmptyState icon={MapPinOff} title="We couldn't find this stop" body={suggestions.length > 0 ? "It may have been renamed. Did you mean one of these?" : "It may have been renamed or removed. Try searching for it again."} action={suggestions.length === 0 ? <Button title="Go back" variant="secondary" onPress={() => (onClose ? onClose() : router.back())} /> : undefined} />
                        {suggestions.length > 0 ? (
                            <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border, marginTop: spacing.md }]}>
                                {suggestions.map((m, i) => (
                                    <Pressable key={m.stop_id} accessibilityRole="button" onPress={() => router.replace({ pathname: "/stop/[query]", params: { query: m.name } })} style={({ pressed }) => [styles.suggestion, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={1}>{cleanStopName(m.name)}</Text>
                                            <Muted>{stopKindLabel(m.type_of_stop, m.stop_code)}</Muted>
                                        </View>
                                        <ChevronRight size={14} color={colors.mutedForeground} />
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}
                    </>
                ) : boardError ? (
                    <EmptyState icon={TriangleAlert} title="Couldn't load departures" body="Check your connection and try again." action={<Button title="Try again" variant="secondary" onPress={() => { board.refetch() }} />} />
                ) : null}
                {!boardError && !board.isLoading && shown.length === 0 ? <EmptyState title={scheduleDay ? "No services that day" : "No more departures today"} /> : null}
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
    suggestion: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12, paddingHorizontal: 14 },
    backToLive: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 16 },
})
