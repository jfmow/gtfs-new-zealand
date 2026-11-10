import { router } from "expo-router"
import { Accessibility, Bike, ChevronRight, Rss, Star } from "@/components/icons"
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { cleanStopName, headsignDisplay } from "@transit/shared/formatting"
import { clock12, timeTillArrivalLabel } from "@transit/shared/logic/basics"
import { isTrackable, type Departure } from "@transit/shared/models"
import { useDepartures } from "@/lib/queries"
import { type, useColors } from "@/theme"
import { FitRow, RouteBadge } from "./ui"

/** iOS `OccupancyText.short` (the web's getOccupancyShort). */
export function occupancyShort(value: number): string {
    switch (value) {
        case 0: case 1: return "Seats free"
        case 2: return "Filling up"
        case 3: return "Standing room"
        case 4: return "Likely full"
        default: return ""
    }
}

type Tracking = "live" | "limited" | "scheduled" | "none"
function trackingOf(d: Departure): Tracking {
    if (d.canceled || d.skipped) return "none"
    if (d.location_tracking) return "live"
    if (d.trip_update_tracking) return "limited"
    return "scheduled"
}

/** The right-hand time - iOS `boardTime`: Cancelled / Not stopping / Departed in their colours, else the countdown. */
function BoardTime({ d, preview, compact }: { d: Departure; preview?: boolean; compact?: boolean }) {
    const colors = useColors()
    const size = compact ? 15 : 16
    if (preview) return <Text style={[type.number, { fontSize: size, color: colors.foreground }]}>{clock12(d.arrival_time) ?? d.arrival_time}</Text>
    if (d.canceled) return <Text style={[styles.status, { color: colors.danger }]}>Cancelled</Text>
    if (d.skipped) return <Text style={[styles.status, { color: colors.live }]}>Not stopping</Text>
    if (d.departed || d.time_till_arrival < 0) return <Text style={[styles.status, { color: colors.warning }]}>Departed</Text>
    const t = trackingOf(d)
    return <Text numberOfLines={1} style={[type.minutes, { fontSize: size, color: t === "live" || t === "limited" ? colors.live : colors.foreground }]}>{timeTillArrivalLabel(d.time_till_arrival)}</Text>
}

/**
 * One board line - iOS `DepartureRow`: route badge, headsign, then the
 * details that fit (platform, at the stop / stops away, timetable only,
 * time, cars, occupancy, bike, wheelchair); live icon and countdown right.
 * Long press: "Remind me before it arrives".
 */
export function DepartureRow({ d, compact = false, preview = false, stopName }: { d: Departure; compact?: boolean; preview?: boolean; stopName?: string }) {
    const colors = useColors()
    const tracking = trackingOf(d)
    const live = !preview && !d.canceled && !d.skipped && (d.location_tracking || d.trip_update_tracking)
    const hasPlatform = !!d.platform && d.platform !== "no platform"
    const departed = !preview && (d.departed || d.time_till_arrival < 0)
    const trackable = isTrackable(d)

    const details: { text?: string; color?: string; icon?: "bike" | "wheelchair" }[] = []
    if (d.platform_changed && hasPlatform) details.push({ text: `Now platform ${d.platform}`, color: colors.danger })
    else if (hasPlatform) details.push({ text: `Platform ${d.platform}` })
    if (live && d.stops_away <= 0 && d.stop_state === "AtStop") details.push({ text: "At the stop", color: colors.live })
    else if (live && d.stops_away > 0) details.push({ text: `${d.stops_away} ${d.stops_away === 1 ? "stop" : "stops"} away` })
    if (!preview && tracking === "scheduled") details.push({ text: "Timetable only" })
    if (!preview && !d.canceled) details.push({ text: clock12(d.arrival_time) ?? d.arrival_time })
    if (live && d.cars) details.push({ text: `${d.cars} cars` })
    if (live && d.location_tracking && d.occupancy >= 0 && occupancyShort(d.occupancy)) details.push({ text: occupancyShort(d.occupancy) })
    if (d.bikes_allowed === 1) details.push({ icon: "bike" })
    if (d.wheelchairs_allowed === 1) details.push({ icon: "wheelchair" })

    const open = () => router.push({ pathname: "/trip/[tripId]", params: { tripId: d.trip_id, stop: d.stop.child_stop_id } })
    const menu = () => {
        if (!trackable || departed) return
        const remind = () => router.push({ pathname: "/trip-reminder", params: { tripId: d.trip_id, stopId: d.stop.child_stop_id, stopName: stopName ?? d.stop.name } })
        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions({ options: ["Remind me before it arrives", "Cancel"], cancelButtonIndex: 1 }, (i) => i === 0 && remind())
        } else {
            Alert.alert(`${d.route.name} to ${headsignDisplay(d.headsign)}`, undefined, [{ text: "Remind me before it arrives", onPress: remind }, { text: "Cancel", style: "cancel" }])
        }
    }

    return (
        <Pressable
            accessibilityRole={trackable ? "button" : undefined}
            accessibilityLabel={`${d.route.name} to ${headsignDisplay(d.headsign)}`}
            accessibilityHint={trackable ? "Opens the live trip. Long press for a reminder." : undefined}
            testID="departure-row"
            disabled={!trackable}
            onPress={open}
            onLongPress={menu}
            style={({ pressed }) => [styles.row, compact ? styles.compact : styles.full, departed && !compact && { backgroundColor: colors.warning + "14" }, pressed && { opacity: 0.6 }]}
        >
            <View style={{ minWidth: compact ? 40 : 44 }}>
                <RouteBadge name={d.route.name} color={d.route.color} size={compact ? 11 : 12} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={[compact ? type.body : type.bodyMedium, { color: d.canceled || d.skipped ? colors.mutedForeground : colors.foreground, textDecorationLine: d.canceled ? "line-through" : "none" }]}>
                    {headsignDisplay(d.headsign)}
                </Text>
                {!compact && details.length > 0 ? (
                    // Most useful first; items drop off the end until the rest fit (iOS `ViewThatFits`).
                    <FitRow
                        items={details.map((x, i) =>
                            x.icon === "bike" ? <Bike key={i} size={13} color={colors.mutedForeground} accessibilityLabel="Bikes allowed" />
                                : x.icon === "wheelchair" ? <Accessibility key={i} size={13} color={colors.mutedForeground} accessibilityLabel="Wheelchair accessible" />
                                    : <Text key={i} numberOfLines={1} textBreakStrategy="simple" style={[x.color ? type.metaMedium : type.meta, { color: x.color ?? colors.mutedForeground }]}>{x.text}</Text>)}
                    />
                ) : null}
            </View>
            {live && tracking === "live" && !departed ? <Rss size={11} color={colors.live} /> : null}
            <BoardTime d={d} preview={preview} compact={compact} />
        </Pressable>
    )
}

/** A coloured rounded tile with a star - the saved-stop marker on Home. */
export function StarTile({ color, size = 24 }: { color?: string; size?: number }) {
    const c = color || "#f59e0b"
    return (
        <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c + "2E", alignItems: "center", justifyContent: "center" }}>
            <Star size={size * 0.42} color={c} fill={c} />
        </View>
    )
}

/** A saved/nearby stop with its next few departures - the "Boards" Home card. */
export function MiniBoard({ query, name, color, saved, subtitle, onToggleSave, count = 3 }: { query: string; name: string; color?: string; saved?: boolean; subtitle?: string; onToggleSave?: () => void; count?: number }) {
    const colors = useColors()
    const { data, isLoading, error } = useDepartures(query, 20)
    const rows = (data ?? []).filter((d) => !d.departed && d.time_till_arrival >= 0).slice(0, count)
    return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${cleanStopName(name)} departures`} onPress={() => router.push({ pathname: "/stop/[query]", params: { query } })} style={styles.cardHead}>
                {saved ? <StarTile color={color} /> : null}
                <View style={{ flex: 1 }}>
                    <Text style={[type.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{cleanStopName(name)}</Text>
                    {subtitle ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
                </View>
                {!saved && onToggleSave ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Save stop" hitSlop={10} onPress={onToggleSave}>
                        <Star size={16} color={colors.mutedForeground} />
                    </Pressable>
                ) : null}
                <ChevronRight size={12} color={colors.mutedForeground + "B3"} />
            </Pressable>
            {isLoading ? <Text style={[type.meta, styles.note, { color: colors.mutedForeground }]}>Loading departures</Text> : null}
            {error ? <Text style={[type.meta, styles.note, { color: colors.mutedForeground }]}>{"Couldn't load departures"}</Text> : null}
            {!isLoading && !error && rows.length === 0 ? <Text style={[type.meta, styles.note, { color: colors.mutedForeground }]}>No upcoming services</Text> : null}
            {rows.map((d) => (
                <View key={`${d.trip_id}-${d.stop.child_stop_id}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, marginLeft: 14 }}>
                    <DepartureRow d={d} compact stopName={name} />
                </View>
            ))}
        </View>
    )
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    full: { paddingVertical: 12, paddingHorizontal: 14 },
    compact: { paddingVertical: 9, paddingRight: 14, gap: 10 },
    status: { fontFamily: "Geist-Bold", fontSize: 14 },
    card: { borderWidth: 1, borderRadius: 16, overflow: "hidden", paddingBottom: 3, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
    note: { paddingHorizontal: 14, paddingVertical: 10 },
})
