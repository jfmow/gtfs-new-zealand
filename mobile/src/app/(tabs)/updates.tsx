import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { Bell, BellRing, CircleCheck, ChevronRight, MessageSquareWarning, Search, Settings as Gear, X } from "@/components/icons"
import { useState } from "react"
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { cleanStopName } from "@transit/shared/formatting"
import { alertStatus } from "@transit/shared/logic/basics"
import { parseDeepLink } from "@transit/shared/logic/deeplink"
import { laClock } from "@transit/shared/logic/journey-live"
import { boardQuery } from "@transit/shared/models"
import { getRegionSlug } from "@transit/shared/regions"
import { AlertList } from "@/components/alerts"
import { StarTile } from "@/components/departures"
import { EmptyState, GlassButton, Loading, ModeIcon, RouteBadge } from "@/components/ui"
import { api } from "@/lib/api"
import { readable, useLayout } from "@/lib/layout"
import { openDeepLink } from "@/lib/links"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { unwrap, useClosestStops, useStopAlerts } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSavedStops } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"
import { StopSearchResults } from "@/components/stop-search"

/** Updates (iOS 2026-11-03 `AlertsTabView`): "For you" / "Service alerts" chips and Settings on one row, no title bar. */
export default function UpdatesTab() {
    const colors = useColors()
    const { region } = useRegion()
    const hasRealtime = region.realtime !== false
    const [inbox, setInbox] = useState(true)
    const { wide } = useLayout()
    return (
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.grouped }}>
            {/* Service alerts splits the full width on wide windows; the inbox stays a readable column. */}
            <View style={[styles.topRow, readable(wide && (inbox || !hasRealtime))]}>
                {hasRealtime ? (
                    <>
                        <ChipButton label="For you" active={inbox} onPress={() => setInbox(true)} />
                        <ChipButton label="Service alerts" active={!inbox} onPress={() => setInbox(false)} />
                    </>
                ) : null}
                <View style={{ flex: 1 }} />
                <GlassButton icon={Gear} label="Settings" onPress={() => router.push("/settings")} size={40} />
            </View>
            {inbox || !hasRealtime ? <Inbox /> : <ServiceAlerts />}
        </SafeAreaView>
    )
}

function ChipButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border }]}>
            <Text style={[type.metaMedium, { color: active ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
        </Pressable>
    )
}

/** "For you" - iOS `NotificationsInbox`: Alerts & reminders, then today's and earlier notifications. */
function Inbox() {
    const colors = useColors()
    const { wide } = useLayout()
    const { region, ready } = useRegion()
    const tz = region.timeZone
    const mine = useQuery({ queryKey: ["mine", region.url], queryFn: async () => unwrap(api.mySubscriptions()), enabled: ready })
    const entries = (mine.data?.recent_notifications ?? []).filter((n) => !n.dismissed).sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0)).slice(0, 50)
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const isToday = (s?: number | null) => !!s && s * 1000 >= startOfDay.getTime()
    const groups = [{ title: "Today", items: entries.filter((e) => isToday(e.seen_at)) }, { title: "Earlier", items: entries.filter((e) => !isToday(e.seen_at)) }].filter((g) => g.items.length)
    const dismiss = async (id: string) => {
        await api.dismissNotification(id)
        mine.refetch()
    }
    const longPress = (id: string) => {
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: ["Dismiss", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (i) => i === 0 && dismiss(id))
        else Alert.alert("Notification", undefined, [{ text: "Dismiss", style: "destructive", onPress: () => dismiss(id) }, { text: "Cancel", style: "cancel" }])
    }

    return (
        <ScrollView contentContainerStyle={[styles.scroll, readable(wide)]} refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={() => { mine.refetch() }} />}>
            <Pressable accessibilityRole="button" onPress={() => router.push("/manage-notifications")} style={[styles.group, styles.manage, { backgroundColor: colors.card }]}>
                <BellRing size={20} color={colors.primary} />
                <Text style={[type.body, { flex: 1, fontSize: 17, color: colors.foreground }]}>Alerts & reminders</Text>
                <ChevronRight size={18} color={colors.mutedForeground} />
            </Pressable>
            {mine.isLoading ? <Loading /> : null}
            {!mine.isLoading && entries.length === 0 ? (
                <View style={{ marginTop: 60 }}><EmptyState icon={Bell} title="No notifications yet" body="Stop and route alerts, and leave-by reminders, show up here." /></View>
            ) : null}
            {groups.map((g) => (
                <View key={g.title}>
                    <Text style={[type.metaMedium, styles.groupHeader, { color: colors.mutedForeground }]}>{g.title}</Text>
                    <View style={[styles.group, { backgroundColor: colors.card }]}>
                        {g.items.map((n, i) => (
                            <Pressable key={n.id} accessibilityRole="button" accessibilityHint={n.url ? "Opens it. Long-press to dismiss." : "Long-press to dismiss."}
                                onPress={() => n.url && parseDeepLink(n.url) && openDeepLink(n.url)} onLongPress={() => longPress(n.id)}
                                style={[styles.entry, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                                <View style={styles.entryHead}>
                                    <Text style={[type.bodyMedium, { flex: 1, color: colors.foreground }]}>{n.title ?? "Notification"}</Text>
                                    {n.seen_at ? <Text style={[type.meta, { fontSize: 12, color: colors.mutedForeground }]}>{laClock(new Date(n.seen_at * 1000), tz)}</Text> : null}
                                </View>
                                {n.body ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={3}>{n.body}</Text> : null}
                            </Pressable>
                        ))}
                    </View>
                </View>
            ))}
        </ScrollView>
    )
}

/**
 * Service alerts - search any stop, or your stops and the nearest few with
 * a one-line summary each. Wide windows split it (iOS's Alerts split): the
 * list stays on the left and the picked stop's alerts fill the right.
 */
function ServiceAlerts() {
    const colors = useColors()
    const layout = useLayout()
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState<string | null>(null)
    if (layout.wide) {
        return (
            <View style={{ flex: 1, flexDirection: "row" }}>
                <View style={{ width: layout.listWidth, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}>
                    <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Search size={14} color={colors.mutedForeground} />
                        <TextInput value={query} onChangeText={setQuery} placeholder="Search for stop..." placeholderTextColor={colors.mutedForeground} autoCorrect={false} clearButtonMode="while-editing"
                            accessibilityLabel="Search for stop" style={[type.body, { flex: 1, color: colors.foreground, paddingVertical: 0 }]} />
                    </View>
                    {query.trim().length >= 2
                        ? <StopSearchResults query={query.trim()} navigate={false} onPick={(s) => { setSelected(s.name); setQuery("") }} />
                        : <Overview onSelect={setSelected} selected={selected} />}
                </View>
                <View style={{ flex: 1 }}>
                    {selected ? <SelectedStop key={selected} query={selected} onClear={() => setSelected(null)} /> : (
                        <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl }}>
                            <EmptyState icon={MessageSquareWarning} title="Pick a stop" body="Its service alerts show up here." />
                        </View>
                    )}
                </View>
            </View>
        )
    }
    return (
        <View style={{ flex: 1 }}>
            {!selected ? (
                <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Search size={14} color={colors.mutedForeground} />
                    <TextInput value={query} onChangeText={setQuery} placeholder="Search for stop..." placeholderTextColor={colors.mutedForeground} autoCorrect={false} clearButtonMode="while-editing"
                        accessibilityLabel="Search for stop" style={[type.body, { flex: 1, color: colors.foreground, paddingVertical: 0 }]} />
                </View>
            ) : null}
            {selected ? (
                <SelectedStop query={selected} onClear={() => setSelected(null)} />
            ) : query.trim().length >= 2 ? (
                <StopSearchResults query={query.trim()} navigate={false} onPick={(s) => { setSelected(s.name); setQuery("") }} />
            ) : (
                <Overview onSelect={setSelected} />
            )}
        </View>
    )
}

function SelectedStop({ query, onClear }: { query: string; onClear: () => void }) {
    const colors = useColors()
    const alerts = useStopAlerts(query)
    const all = Object.values(alerts.data?.alerts ?? {}).flat()
    return (
        <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.selHead}>
                <Text style={[type.pageTitle, { flex: 1, color: colors.foreground }]} numberOfLines={2}>{cleanStopName(query)}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/alerts/subscribe", params: { stop: query } })} style={[styles.getAlerts, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <BellRing size={13} color={colors.foreground} />
                    <Text style={[type.metaMedium, { color: colors.foreground }]}>Get alerts</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Clear stop" hitSlop={8} onPress={onClear}><X size={18} color={colors.foreground} /></Pressable>
            </View>
            {alerts.isLoading ? <Loading /> : null}
            {alerts.data && all.length === 0 ? <EmptyState icon={CircleCheck} title="All clear" body="No alerts for this stop." /> : null}
            {alerts.data ? <AlertList byRoute={alerts.data.alerts ?? {}} /> : null}
        </ScrollView>
    )
}

function Overview({ onSelect, selected }: { onSelect: (q: string) => void; selected?: string | null }) {
    const { region } = useRegion()
    const saved = useSavedStops(getRegionSlug(region))
    const nearby = useClosestStops(coordinateOf(useUserLocation(false)))
    const savedIds = new Set(saved.stops.map((s) => s.query))
    const names = new Set(saved.stops.map((s) => s.name))
    const near = (nearby.data ?? []).filter((s) => !savedIds.has(boardQuery(s)) && !names.has(s.stop_name) && (names.add(s.stop_name), true)).slice(0, 3)
    return (
        <ScrollView contentContainerStyle={[styles.scroll, { gap: 20 }]}>
            {saved.stops.length === 0 && near.length === 0 ? (
                <EmptyState icon={MessageSquareWarning} title="Travel alerts" body="Search for a stop to see its alerts. Your saved and nearby stops show up here." />
            ) : null}
            {saved.stops.length ? (
                <Section title="Your stops">
                    {saved.stops.map((s, i) => <SummaryRow key={s.stopId} query={s.query} title={s.name} border={i > 0} tile={<StarTile color={s.color} />} selected={selected === s.query} onPress={() => onSelect(s.query)} />)}
                </Section>
            ) : null}
            {near.length ? (
                <Section title="Near you">
                    {near.map((s, i) => <SummaryRow key={s.stop_id} query={boardQuery(s)} title={cleanStopName(s.stop_name)} border={i > 0} tile={<ModeTile mode={s.stop_type} />} selected={selected === boardQuery(s)} onPress={() => onSelect(boardQuery(s))} />)}
                </Section>
            ) : null}
        </ScrollView>
    )
}

function ModeTile({ mode }: { mode: string }) {
    const colors = useColors()
    return <View style={[styles.tile, { backgroundColor: colors.muted }]}><ModeIcon mode={mode} size={10} color={colors.foreground} /></View>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    const colors = useColors()
    return (
        <View style={{ gap: 10 }}>
            <Text style={[type.sectionTitle, { color: colors.foreground }]}>{title}</Text>
            <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>{children}</View>
        </View>
    )
}

/** Alerts are keyed by route id - AT's carry a feed version suffix ("INN-202") that means nothing to a rider. */
const shortRoute = (id: string) => id.replace(/^(.+)-\d+$/, "$1")

/** "Britomart · 2 happening now, 1 planned" with the affected routes - iOS `StopAlertsSummaryRow`. */
function SummaryRow({ query, title, tile, border, selected, onPress }: { query: string; title: string; tile: React.ReactNode; border?: boolean; selected?: boolean; onPress: () => void }) {
    const colors = useColors()
    const alerts = useStopAlerts(query)
    let active = 0
    let upcoming = 0
    const routes: string[] = []
    for (const route of alerts.data?.routes_to_display ?? Object.keys(alerts.data?.alerts ?? {})) {
        const kinds = (alerts.data?.alerts?.[route] ?? []).map((a) => alertStatus(a).kind)
        active += kinds.filter((k) => k === "active").length
        upcoming += kinds.filter((k) => k === "soon").length
        if (kinds.some((k) => k !== "inactive")) routes.push(route)
    }
    const notFound = (alerts.error as Error | null)?.message?.includes("404")
    const count = [active ? `${active} happening now` : null, upcoming ? `${upcoming} planned` : null].filter(Boolean).join(", ")
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected: !!selected }} onPress={onPress} style={[styles.summary, border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginLeft: 0 }, selected && { backgroundColor: colors.muted }]}>
            {tile}
            <View style={{ flex: 1, gap: 5 }}>
                <Text style={[type.bodyMedium, { color: colors.foreground }]}>{title}</Text>
                {alerts.data || notFound ? (
                    !count ? (
                        <View style={styles.inline}><CircleCheck size={14} color={colors.success} /><Text style={[type.meta, { color: colors.success }]}>All clear</Text></View>
                    ) : (
                        <>
                            <View style={styles.inline}>
                                {active ? <View style={[styles.redDot, { backgroundColor: colors.danger }]} /> : null}
                                <Text style={[active ? type.metaMedium : type.meta, { color: active ? colors.danger : colors.mutedForeground }]}>{count}</Text>
                            </View>
                            <View style={[styles.inline, { flexWrap: "wrap" }]}>
                                {routes.slice(0, 8).map((r) => <RouteBadge key={r} name={shortRoute(r)} size={11} />)}
                            </View>
                        </>
                    )
                ) : alerts.error ? (
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{"Couldn't load alerts"}</Text>
                ) : (
                    <View style={styles.inline}><ActivityIndicator size="small" /><Text style={[type.meta, { color: colors.mutedForeground }]}>Checking alerts</Text></View>
                )}
            </View>
            <ChevronRight size={12} color={colors.mutedForeground + "99"} />
        </Pressable>
    )
}

const styles = StyleSheet.create({
    topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, justifyContent: "center" },
    scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 130, gap: spacing.lg },
    group: { borderRadius: 16, overflow: "hidden" },
    groupHeader: { marginLeft: spacing.lg, marginBottom: 6, textTransform: "uppercase", fontSize: 12, letterSpacing: 0.4 },
    manage: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
    entry: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 3 },
    entryHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
    search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: 12, marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: 12, borderRadius: radius.md, borderWidth: 1 },
    selHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    getAlerts: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.md, borderWidth: 1 },
    summary: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
    tile: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    inline: { flexDirection: "row", alignItems: "center", gap: 6 },
    redDot: { width: 7, height: 7, borderRadius: 4 },
})
