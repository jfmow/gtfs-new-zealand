import { useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowUpDown, Bookmark, Briefcase, ChevronDown, ChevronRight, Clock, House, MapPin, Route as RouteIcon, Search, Settings as Gear, SlidersHorizontal } from "@/components/icons"
import { useEffect, useState, useSyncExternalStore } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { rankedPlans } from "@transit/shared/easy-planner"
import type { JourneyPlanRequest } from "@transit/shared/endpoints"
import { pruneDominatedPlans } from "@transit/shared/logic/basics"
import { laClock } from "@transit/shared/logic/journey-live"
import { latestDeparture, leaveTime } from "@transit/shared/logic/reminders"
import { goTime } from "@transit/shared/models"
import { getRegionSlug } from "@transit/shared/regions"
import type { JourneyType } from "@transit/shared/types/journey"
import { normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { EasyPlannerFlow } from "@/components/easy-planner-flow"
import { PlanCard, hasLeft } from "@/components/journey"
import { LocationResults, placeName, type PickedPlace } from "@/components/location-search"
import { Button, EmptyState, ErrorText, GlassButton, Loading, Muted } from "@/components/ui"
import { api } from "@/lib/api"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { optionsChanged, plannerWhenStore, usePlannerOptions, whenLabel } from "@/lib/planner-store"
import { contextFor, rememberPlans, useFares } from "@/lib/plans"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSavedPlaces, useSavedTrips, useSettings } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

type PlannerParams = { toLat?: string; toLon?: string; toLabel?: string; fromLat?: string; fromLon?: string; fromLabel?: string; arriveBy?: string; departAt?: string; standard?: string }

export default function PlannerTab() {
    const params = useLocalSearchParams<PlannerParams>()
    const [settings] = useSettings()
    // Step by step, unless a link, saved trip or re-plan needs the full form.
    if (settings.easyPlanner && !params.standard && !params.toLat && !params.fromLat && !params.arriveBy) return <EasyPlannerFlow embedded />
    // A launcher tap or a deep link with a new trip starts a fresh planner.
    const key = [params.toLat, params.toLon, params.fromLat, params.fromLon, params.arriveBy, params.departAt].join("|")
    return <Planner key={key} params={params} />
}

/** "Where to?" (iOS 2026-11-03): search first, from here by default, plans once both ends are set. */
function Planner({ params }: { params: PlannerParams }) {
    const colors = useColors()
    const { region, ready } = useRegion()
    const tz = region.timeZone
    const slug = getRegionSlug(region)
    const [settings] = useSettings()
    const [options] = usePlannerOptions()
    const when = useSyncExternalStore(plannerWhenStore.subscribe, plannerWhenStore.get)
    const places = useSavedPlaces(slug)
    const trips = useSavedTrips(slug)
    const here = coordinateOf(useUserLocation())

    const [to, setTo] = useState<PickedPlace | null>(params.toLat && params.toLon ? { label: params.toLabel || "Destination", lat: Number(params.toLat), lon: Number(params.toLon) } : null)
    const [from, setFrom] = useState<PickedPlace | null>(params.fromLat && params.fromLon ? { label: params.fromLabel || "Start", lat: Number(params.fromLat), lon: Number(params.fromLon) } : null)
    const [query, setQuery] = useState("")
    const [editingFrom, setEditingFrom] = useState(false)
    const [later, setLater] = useState<JourneyType[]>([])
    const [loadingLater, setLoadingLater] = useState(false)
    // A recurring reminder's "arrive by" link starts in arrive-by mode.
    useEffect(() => {
        if (params.arriveBy === "1" && plannerWhenStore.get().mode === "now") plannerWhenStore.set({ mode: "arriveat", at: Date.now() + 3_600_000 })
    }, [params.arriveBy])
    // "Find a better route" from the tracker: leave from that stop at that time.
    useEffect(() => {
        const at = Number(params.departAt)
        if (at) plannerWhenStore.set(at > Date.now() + 60_000 ? { mode: "departat", at } : { mode: "now", at: null })
    }, [params.departAt])

    const start = from ?? (here ? { label: "Current location", ...here } : null)
    const request: JourneyPlanRequest | null = start && to ? {
        start: { lat: start.lat, lon: start.lon },
        end: { lat: to.lat, lon: to.lon },
        date: when.mode === "now" || !when.at ? undefined : new Date(when.at),
        timeType: when.mode,
        walkSpeed: Number(normalizeWalkSpeed(settings.walkSpeed)),
        maxWalkKm: options.maxWalkKm,
        maxTransfers: options.maxTransfers,
        modes: options.modes,
        onlyRoutes: options.onlyRoutes.map((r) => r.id),
    } : null
    const context = request && start && to ? contextFor(request, start, to) : null
    const plans = useQuery({
        queryKey: ["plans", region.url, request && JSON.stringify(request)],
        queryFn: async () => {
            const res = (await unwrap(api.plan(request!))) ?? []
            rememberPlans(res, context ?? undefined)
            return rankedPlans(pruneDominatedPlans(res), when.mode === "arriveat" && when.at ? new Date(when.at) : null)
        },
        enabled: ready && !!request && !editingFrom,
        staleTime: 60_000,
    })
    const results = [...(plans.data ?? []), ...later.filter((l) => !(plans.data ?? []).some((p) => p.ID === l.ID))]
    const fares = useFares(results.map((p) => p.ID))
    const savedAlready = !!to && !!start && trips.trips.some((t) => Math.abs(t.to.lat - to.lat) < 1e-5 && Math.abs(t.to.lon - to.lon) < 1e-5 && Math.abs(t.from.lat - start.lat) < 1e-5 && Math.abs(t.from.lon - start.lon) < 1e-5)
    const arriveBy = when.mode === "arriveat"
    const latest = arriveBy ? latestDeparture(results) : null

    const pick = (p: PickedPlace) => {
        if (editingFrom) setFrom(p)
        else setTo(p)
        setQuery("")
        setEditingFrom(false)
        setLater([])
    }
    const loadLater = async () => {
        const last = results[results.length - 1]
        const dep = last ? goTime(last.Legs.find((l) => l.Mode === "transit")?.DepartureTime as unknown as string) ?? goTime(last.DepartureTime as unknown as string) : null
        if (!request || !dep) return
        setLoadingLater(true)
        const res = await api.plan({ ...request, timeType: "departat", date: new Date(dep.getTime() + 60_000) })
        setLoadingLater(false)
        if (res.ok && res.data) {
            rememberPlans(res.data, context ?? undefined)
            setLater((prev) => [...prev, ...res.data.filter((p) => !results.some((r) => r.ID === p.ID))])
        }
    }
    const open = (id: string) => router.push({ pathname: "/journey/[id]", params: { id } })
    const searching = !to || editingFrom || query.length > 0
    const refreshPlans = async () => {
        setLater([])
        await plans.refetch()
    }

    return (
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={styles.topRow}>
                <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Search size={15} color={colors.mutedForeground} />
                    <TextInput
                        value={query || (!editingFrom && to ? to.label : "")}
                        onChangeText={(t) => { setQuery(t); if (!t && !editingFrom) setTo(null) }}
                        onFocus={() => { if (to && !editingFrom) setQuery(to.label) }}
                        placeholder={editingFrom ? "Where from?" : "Where to?"}
                        placeholderTextColor={colors.mutedForeground}
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                        accessibilityLabel={editingFrom ? "Start" : "Destination"}
                        style={[type.body, { flex: 1, color: colors.foreground, paddingVertical: 0 }]}
                    />
                </View>
                <GlassButton icon={Gear} label="Settings" onPress={() => router.push("/settings")} size={40} />
            </View>

            <View style={styles.fromRow}>
                <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
                <Text style={[type.meta, { color: colors.mutedForeground, flexShrink: 1 }]} numberOfLines={1}>From {start?.label ?? "…choose a start"}</Text>
                <Pressable accessibilityRole="button" onPress={() => { setEditingFrom(true); setQuery("") }} hitSlop={8}>
                    <Text style={[type.meta, { color: colors.foreground, textDecorationLine: "underline" }]}>Change</Text>
                </Pressable>
                {to && start ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Swap start and destination"
                        hitSlop={8}
                        onPress={async () => {
                            const newTo = from ?? (here ? { label: await placeName(here), ...here } : null)
                            setFrom(to)
                            if (newTo) setTo(newTo)
                            setLater([])
                        }}
                    >
                        <ArrowUpDown size={13} color={colors.mutedForeground} />
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.pills}>
                <Pill icon={Clock} label={whenLabel(when, (d) => laClock(d, tz))} trailing onPress={() => router.push("/planner-time")} />
                <Pill icon={SlidersHorizontal} label="Options" onPress={() => router.push("/planner-options")} active={optionsChanged(options)} />
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scroll}
                refreshControl={!searching ? <RefreshControl refreshing={plans.isRefetching} onRefresh={refreshPlans} /> : undefined}
            >
                {searching ? (
                    <>
                        {query.trim().length >= 2 ? <LocationResults query={query} onPick={pick} showCurrent={editingFrom} /> : null}
                        {query.trim().length < 2 ? (
                            <>
                                {editingFrom && here ? <LocationResults query="" onPick={pick} showCurrent /> : null}
                                <Text style={[type.metaMedium, styles.groupLabel, { color: colors.mutedForeground }]}>Your places</Text>
                                <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <PlaceRow icon={House} tint="#0ea5e9" title="Home" subtitle={places.home?.label === "Home" ? "Set" : places.home?.label ?? "Add home"} onPress={() => (places.home ? pick({ label: "Home", lat: places.home.lat, lon: places.home.lon }) : router.push({ pathname: "/place", params: { kind: "home" } }))} />
                                    <PlaceRow icon={Briefcase} tint="#f59e0b" title="Work" subtitle={places.work ? "Set" : "Add work"} onPress={() => (places.work ? pick({ label: "Work", lat: places.work.lat, lon: places.work.lon }) : router.push({ pathname: "/place", params: { kind: "work" } }))} border />
                                    {places.places.filter((p) => p.kind === "other").map((p) => (
                                        <PlaceRow key={p.id} icon={MapPin} tint="#10b981" title={p.label} onPress={() => pick({ label: p.label, lat: p.lat, lon: p.lon })} border />
                                    ))}
                                </View>
                                {/* Like iOS, the section only appears once there's a saved trip. */}
                                {trips.trips.length ? (
                                    <>
                                        <View style={styles.groupHead}>
                                            <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Saved trips</Text>
                                            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push("/saved-trips")}><Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Manage</Text></Pressable>
                                        </View>
                                        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                            {trips.trips.map((t, i) => (
                                                <PlaceRow key={t.id} icon={RouteIcon} tint="#8b5cf6" title={t.name} subtitle={`${t.from.label} → ${t.to.label}`} border={i > 0} trailingIcon={Search}
                                                    onPress={() => { setFrom({ ...t.from }); setTo({ ...t.to }); setQuery(""); setEditingFrom(false) }} />
                                            ))}
                                        </View>
                                    </>
                                ) : null}
                                <Text style={[type.meta, { color: colors.mutedForeground, textAlign: "center", marginTop: spacing.xl }]}>
                                    Prefer a few simple questions?{" "}
                                    <Text onPress={() => router.push("/easy-planner")} style={{ color: colors.foreground, textDecorationLine: "underline" }}>Try step by step</Text>
                                </Text>
                            </>
                        ) : null}
                    </>
                ) : (
                    <>
                        <View style={styles.resultsHead}>
                            <Text style={[type.meta, { color: colors.mutedForeground }]}>
                                {plans.data ? `${results.length} route${results.length === 1 ? "" : "s"} found · planned ${laClock(new Date(plans.dataUpdatedAt), tz)}` : ""}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
                                {start && to ? (
                                    <Pressable accessibilityRole="button" disabled={savedAlready} hitSlop={8}
                                        onPress={() => router.push({ pathname: "/save-trip", params: { fromLabel: start.label, fromLat: String(start.lat), fromLon: String(start.lon), toLabel: to.label, toLat: String(to.lat), toLon: String(to.lon) } })}
                                        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                        <Bookmark size={15} color={savedAlready ? colors.success : colors.foreground} fill={savedAlready ? colors.success : "transparent"} />
                                        <Text style={[type.metaMedium, { color: savedAlready ? colors.success : colors.foreground }]}>{savedAlready ? "Saved" : "Save trip"}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </View>
                        {latest ? (
                            <Text style={[type.bodyMedium, { color: colors.foreground, marginBottom: spacing.sm }]}>Latest you can leave: {laClock(leaveTime(latest) ?? goTime(latest.DepartureTime as unknown as string), tz)}</Text>
                        ) : null}
                        {!start ? <Muted>Waiting for your location, or choose a start.</Muted> : null}
                        {plans.isLoading ? <Loading /> : null}
                        {plans.error ? (
                            <View style={{ gap: spacing.sm }}>
                                <ErrorText>{(plans.error as Error).message}</ErrorText>
                                <Button title="Try again" variant="secondary" onPress={() => plans.refetch()} />
                            </View>
                        ) : null}
                        {plans.data && results.length === 0 ? <EmptyState title="No way found" body="Try leaving at a different time, or change the options." /> : null}
                        <View style={{ gap: spacing.md }}>
                            {results.map((p) => (
                                <PlanCard key={p.ID} plan={p} tz={tz} fare={fares[p.ID]?.label} missed={hasLeft(p)}
                                    onRemind={p.Legs.some((l) => l.Mode === "transit") && !hasLeft(p) ? () => router.push({ pathname: "/leave-reminder", params: { id: p.ID } }) : undefined}
                                    onPress={() => open(p.ID)} />
                            ))}
                        </View>
                        {results.length > 0 && !arriveBy ? <Button title="Later departures" variant="secondary" onPress={loadLater} loading={loadingLater} style={{ marginTop: spacing.md }} /> : null}
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    )
}

function Pill({ icon: Icon, label, onPress, trailing, active }: { icon: typeof Clock; label: string; onPress: () => void; trailing?: boolean; active?: boolean }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.pill, { backgroundColor: active ? colors.primary : colors.card, borderColor: colors.border }]}>
            <Icon size={12} color={active ? colors.primaryForeground : colors.foreground} />
            <Text style={[type.metaMedium, { color: active ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>{label}</Text>
            {trailing ? <ChevronDown size={9} color={active ? colors.primaryForeground : colors.foreground} /> : null}
        </Pressable>
    )
}

function PlaceRow({ icon: Icon, tint, title, subtitle, onPress, border, trailingIcon: Trailing = ChevronRight }: { icon: typeof House; tint: string; title: string; subtitle?: string; onPress: () => void; border?: boolean; trailingIcon?: typeof ChevronRight }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.placeRow, border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}>
            <View style={[styles.placeIcon, { backgroundColor: tint + "2E" }]}><Icon size={13} color={tint} fill={tint} /></View>
            <View style={{ flex: 1, gap: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.foreground }]}>{title}</Text>
                {subtitle ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            <Trailing size={12} color={colors.mutedForeground + "99"} />
        </Pressable>
    )
}

const styles = StyleSheet.create({
    topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
    fromRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg + 4, marginTop: 10 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    pills: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: 10 },
    pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1 },
    scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 130 },
    groupLabel: { marginTop: spacing.lg, marginBottom: spacing.sm },
    groupHead: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
    group: { borderRadius: radius.xl, borderWidth: 1, overflow: "hidden" },
    placeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: 14, paddingVertical: 10 },
    placeIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    resultsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: spacing.sm },
})
