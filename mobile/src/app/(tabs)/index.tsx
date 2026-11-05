import { router } from "expo-router"
import { ArrowDown, ArrowUp, Briefcase, House, MapPin, Palette, Plus, Route as RouteIcon, ScanLine, Search, Settings as Gear, Trash2 } from "@/components/icons"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { SWATCH_COLORS } from "@transit/shared/colors"
import { cleanStopName } from "@transit/shared/formatting"
import { boardQuery } from "@transit/shared/models"
import { getRegionSlug } from "@transit/shared/regions"
import { MiniBoard, StarTile } from "@/components/departures"
import { StopSearchResults } from "@/components/stop-search"
import { EmptyState, GlassButton, Loading, Muted, SectionHeader } from "@/components/ui"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { useClosestStops } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSavedPlaces, useSavedStops, useSavedTrips, type SavedPlace } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** "Good morning" etc. on the region's clock. */
function greeting(tz: string): string {
    const hour = Number(new Intl.DateTimeFormat("en-NZ", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()))
    return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

function regionCity(name: string): string {
    // "Auckland Transport" -> "Auckland", "Wellington – Metlink" -> "Wellington"
    return name.replace(/^Dev – /, "").split(/ – | Transport/)[0]
}

/** The "Boards" Home (iOS 2026-11-03): search + gear, greeting, round launcher, your stops, near you. */
export default function HomeTab() {
    const colors = useColors()
    const { region } = useRegion()
    const slug = getRegionSlug(region)
    const [query, setQuery] = useState("")
    const [editing, setEditing] = useState(false)
    const searching = query.trim().length >= 2
    const saved = useSavedStops(slug)
    const places = useSavedPlaces(slug)
    const trips = useSavedTrips(slug)
    const location = useUserLocation()
    const nearby = useClosestStops(coordinateOf(location))
    const nearbyStops = (nearby.data ?? []).filter((s) => !saved.isSaved(s.stop_id)).slice(0, 3)
    const date = new Intl.DateTimeFormat("en-NZ", { timeZone: region.timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date())

    return (
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={styles.topRow}>
                <View style={[styles.search, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Search size={14} color={colors.mutedForeground} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search for stop..."
                        placeholderTextColor={colors.mutedForeground}
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                        accessibilityLabel="Search for stop"
                        style={[type.body, { flex: 1, color: colors.foreground, paddingVertical: 0 }]}
                    />
                </View>
                <GlassButton icon={Gear} label="Settings" onPress={() => router.push("/settings")} size={40} />
            </View>

            {searching ? (
                <StopSearchResults query={query.trim()} onPick={() => setQuery("")} />
            ) : (
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <Text accessibilityRole="header" style={[type.display, { color: colors.foreground, marginTop: 4 }]}>{greeting(region.timeZone)}</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground, marginTop: 2 }]}>{date} · {regionCity(region.displayName)}</Text>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.launcher}>
                        <RoundButton label="Find vehicle" onPress={() => router.push("/find-vehicle")} bg={colors.primary} fg={colors.primaryForeground} icon={ScanLine} />
                        <PlaceButton place={places.home} kind="home" />
                        <PlaceButton place={places.work} kind="work" />
                        {trips.trips.map((t) => (
                            <RoundButton
                                key={t.id}
                                label={t.name}
                                icon={RouteIcon}
                                bg="#8b5cf633"
                                fg="#8b5cf6"
                                onPress={() => router.push({ pathname: "/(tabs)/planner", params: { fromLat: String(t.from.lat), fromLon: String(t.from.lon), fromLabel: t.from.label, toLat: String(t.to.lat), toLon: String(t.to.lon), toLabel: t.to.label } })}
                            />
                        ))}
                        {places.places.filter((p) => p.kind === "other").map((p) => <PlaceButton key={p.id} place={p} kind="other" />)}
                        <RoundButton label="Add" icon={Plus} dashed onPress={() => router.push({ pathname: "/place", params: { kind: "other" } })} />
                    </ScrollView>

                    <SectionHeader title="Your stops" action={saved.stops.length ? (editing ? "Done" : "Edit") : undefined} onAction={() => setEditing((e) => !e)} />
                    {saved.stops.length === 0 ? (
                        <EmptyState icon={MapPin} title="No saved stops yet" body="Save the places and stops you use most and their next departures show up here." />
                    ) : editing ? (
                        <EditStops />
                    ) : (
                        <View style={{ gap: spacing.md }}>
                            {saved.stops.map((s) => <MiniBoard key={s.stopId} query={s.query} name={s.name} color={s.color} saved />)}
                        </View>
                    )}

                    <SectionHeader title="Near you" action={location.status === "ok" ? "Map" : undefined} onAction={() => router.push("/(tabs)/map")} />
                    {location.status === "denied" ? (
                        <EmptyState icon={MapPin} title="See live departures from the stops around you." body="Turn on location in Settings." />
                    ) : nearby.isLoading || location.status === "unknown" ? (
                        <Loading />
                    ) : nearbyStops.length === 0 ? (
                        <Muted>No stops nearby.</Muted>
                    ) : (
                        <View style={{ gap: spacing.md }}>
                            {nearbyStops.map((s) => (
                                <MiniBoard
                                    key={s.stop_id}
                                    query={boardQuery(s)}
                                    name={s.stop_name}
                                    onToggleSave={() => saved.toggle({ query: boardQuery(s), stopId: s.stop_id, name: s.stop_name, code: s.stop_code, lat: s.stop_lat, lon: s.stop_lon, type: s.stop_type })}
                                />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    )
}

/** Edit mode for "Your stops": rename, recolour, reorder, remove - iOS's Saved stops sheet, inline. */
function EditStops() {
    const colors = useColors()
    const { region } = useRegion()
    const saved = useSavedStops(getRegionSlug(region))
    return (
        <View style={[styles.editList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {saved.stops.map((s, i) => {
                const nextColor = () => {
                    const idx = SWATCH_COLORS.findIndex((c) => c.value === s.color)
                    saved.update(s.stopId, { color: SWATCH_COLORS[(idx + 1) % SWATCH_COLORS.length].value })
                }
                return (
                    <View key={s.stopId} style={[styles.editRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Change colour" onPress={nextColor}>
                            <StarTile color={s.color} />
                        </Pressable>
                        <TextInput
                            defaultValue={cleanStopName(s.name)}
                            onEndEditing={(e) => e.nativeEvent.text.trim() && saved.update(s.stopId, { name: e.nativeEvent.text.trim() })}
                            accessibilityLabel={`Rename ${cleanStopName(s.name)}`}
                            style={[type.bodyMedium, { flex: 1, color: colors.foreground, paddingVertical: 6 }]}
                        />
                        <IconAction icon={Palette} label="Colour" onPress={nextColor} />
                        <IconAction icon={ArrowUp} label="Move up" onPress={() => saved.move(s.stopId, -1)} disabled={i === 0} />
                        <IconAction icon={ArrowDown} label="Move down" onPress={() => saved.move(s.stopId, 1)} disabled={i === saved.stops.length - 1} />
                        <IconAction icon={Trash2} label="Remove from saved" onPress={() => saved.remove(s.stopId)} danger />
                    </View>
                )
            })}
        </View>
    )
}

function IconAction({ icon: Icon, label, onPress, disabled, danger }: { icon: typeof Trash2; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={6} onPress={onPress} style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}>
            <Icon size={18} color={danger ? colors.danger : colors.mutedForeground} />
        </Pressable>
    )
}

const PLACE_STYLE = {
    home: { icon: House, fg: "#0ea5e9", label: "Home", add: "Add home" },
    work: { icon: Briefcase, fg: "#f59e0b", label: "Work", add: "Add work" },
    other: { icon: MapPin, fg: "#10b981", label: "", add: "Add" },
} as const

function PlaceButton({ place, kind }: { place?: SavedPlace; kind: "home" | "work" | "other" }) {
    const s = PLACE_STYLE[kind]
    if (!place) return <RoundButton label={s.add} icon={s.icon} dashed onPress={() => router.push({ pathname: "/place", params: { kind } })} />
    return (
        <RoundButton
            label={kind === "other" ? place.label : s.label}
            icon={s.icon}
            bg={s.fg + "33"}
            fg={s.fg}
            onPress={() => router.push({ pathname: "/(tabs)/planner", params: { toLat: String(place.lat), toLon: String(place.lon), toLabel: place.label } })}
            onLongPress={() => router.push({ pathname: "/place", params: { kind } })}
        />
    )
}

function RoundButton({ label, icon: Icon, onPress, onLongPress, bg, fg, dashed }: { label: string; icon: typeof House; onPress: () => void; onLongPress?: () => void; bg?: string; fg?: string; dashed?: boolean }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} style={styles.round}>
            <View style={[styles.circle, dashed ? { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.mutedForeground + "88" } : { backgroundColor: bg ?? colors.card }]}>
                <Icon size={20} color={fg ?? colors.mutedForeground} />
            </View>
            <Text numberOfLines={1} style={{ fontFamily: "Geist-Medium", fontSize: 12, color: colors.foreground, maxWidth: 70, textAlign: "center" }}>{label}</Text>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1 },
    scroll: { paddingHorizontal: spacing.lg, paddingBottom: 130 },
    launcher: { gap: 10, paddingTop: spacing.lg, paddingBottom: spacing.xs },
    round: { alignItems: "center", gap: 6, width: 70 },
    circle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
    editList: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
    editRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
})
