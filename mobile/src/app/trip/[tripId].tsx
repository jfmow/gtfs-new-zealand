import { useQuery } from "@tanstack/react-query"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Bell, BellRing, ChevronDown, ChevronLeft, ChevronUp, Ellipsis, LocationNorthCircle, MapPin, TriangleAlert, User, WifiOff } from "@/components/icons"
import { useEffect, useRef, useState } from "react"
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { headsignDisplay } from "@transit/shared/formatting"
import { getRegionSlug } from "@transit/shared/regions"
import { VehicleProgressRatchet } from "@transit/shared/logic/basics"
import { laClock } from "@transit/shared/logic/journey-live"
import { lineCoordinates, tripStopLabel, type StopTimeUpdate, type TripStopRef } from "@transit/shared/models"
import { occupancyShort } from "@/components/departures"
import { MapDrawer, panelInset } from "@/components/map-drawer"
import { TransitMap, type MapCamera, type MapMarker } from "@/components/transit-map"
import { FitRow, GlassButton, ModeIcon, RouteBadge, hexColor, textOn } from "@/components/ui"
import { api } from "@/lib/api"
import { useLayout } from "@/lib/layout"
import { useMapFilter } from "@/lib/map-filter"
import { requestNotifications } from "@/lib/push"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useTrackerCamera, type TrackerCameraMode } from "@/lib/tracker-camera"
import { activityKind, clearTripTarget, setTripReminder, updateTripLive, useTripTarget, type TripActivityContent } from "@/lib/trip-live"
import { spacing, type, useColors } from "@/theme"

type StopState = "passed" | "current" | "next" | "upcoming"

/**
 * One trip, live - iOS `VehicleQuickLookView` (2026-11-03): a full map with
 * the route and vehicle, and a drawer with the countdown to your stop (or
 * the next one), a progress strip, the vehicle's status and every stop with
 * a bell.
 *
 * "Your stop" is the board's stop it was opened from, or one the rider
 * picks: tapping a stop sets an arrival reminder there, the bell offers the
 * other reminders. With a reminder set, an iOS Live Activity counts the
 * vehicle down to it (lib/trip-live.ts).
 */
export default function TripTracker() {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { tripId, stop: fromStop } = useLocalSearchParams<{ tripId: string; stop?: string }>()
    const { region, ready } = useRegion()
    const tz = region.timeZone
    const [filter, setFilter] = useMapFilter()
    const [ratchet] = useState(() => new VehicleProgressRatchet())
    const target = useTripTarget(tripId)
    const [showEarlier, setShowEarlier] = useState(false)
    const camera = useRef<MapCamera>(null)
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 15_000)
        return () => clearInterval(t)
    }, [])

    const stops = useQuery({ queryKey: ["trip-stops", region.url, tripId], queryFn: async () => (await unwrap(api.stopsForTrip(tripId!))) ?? [], enabled: ready && !!tripId, staleTime: Infinity })
    const times = useQuery({ queryKey: ["trip-times", region.url, tripId], queryFn: async () => (await unwrap(api.stopTimes(tripId!))) ?? [], enabled: ready && !!tripId, refetchInterval: 20_000 })
    const vehicleQ = useQuery({
        queryKey: ["trip-vehicle", region.url, tripId],
        queryFn: async () => {
            const v = ((await unwrap(api.liveVehicles({ tripIds: [tripId!] }))) ?? [])[0] ?? null
            return v ? ratchet.apply(v, new Date()) : null
        },
        enabled: ready && !!tripId && region.realtime !== false,
        refetchInterval: 10_000,
    })
    const shape = useQuery({ queryKey: ["trip-shape", region.url, tripId], queryFn: async () => unwrap(api.routeShape({ tripId: tripId! })), enabled: ready && !!tripId, staleTime: Infinity })
    const routes = useQuery({ queryKey: ["routes", region.url], queryFn: async () => (await unwrap(api.routes())) ?? {}, enabled: ready, staleTime: Infinity })

    const v = vehicleQ.data
    const hasLoaded = !stops.isLoading && !vehicleQ.isLoading
    const route = v?.route.id ? routes.data?.[v.route.id] : undefined
    const routeHex = hexColor(v?.route.color || route?.route_color || shape.data?.color, colors.live)

    // Stops paired with times: sorted by timetable, next entry within a few places (loop routes visit a stop twice).
    const timeBySeq = new Map<number, StopTimeUpdate>()
    {
        const list = [...(times.data ?? [])].sort((a, b) => (a.scheduled_time || a.arrival_time) - (b.scheduled_time || b.arrival_time))
        let from = 0
        for (const s of stops.data ?? []) {
            let i = list.findIndex((t, k) => k >= from && t.child_stop_id === s.child_stop_id)
            if (i < 0) i = list.findIndex((t, k) => k >= from && t.parent_stop_id !== "" && t.parent_stop_id === s.parent_stop_id)
            if (i >= 0 && i - from <= 3) {
                timeBySeq.set(s.sequence, list[i])
                from = i + 1
            }
        }
    }
    const rows = stops.data ?? []
    const currentSeq = v?.trip?.current_stop?.sequence
    const nextSeq = v?.trip?.next_stop?.sequence
    const isAtStop = v?.state === "AtStop"
    const stateOf = (s: TripStopRef): StopState => {
        if (currentSeq !== undefined && s.sequence === currentSeq && isAtStop) return "current"
        if (nextSeq !== undefined && s.sequence === nextSeq) return "next"
        if (currentSeq !== undefined && s.sequence <= currentSeq) return "passed"
        const t = timeBySeq.get(s.sequence)
        if (t?.passed) return "passed"
        if (currentSeq === undefined && t && (t.arrival_time || t.departure_time) < now - 60_000) return "passed"
        return "upcoming"
    }
    const isYours = (s: TripStopRef) => (target ? s.sequence === target.stopSeq : !!fromStop && (s.child_stop_id === fromStop || s.parent_stop_id === fromStop))
    const passedRows = rows.filter((s) => stateOf(s) === "passed")
    const aheadRows = rows.filter((s) => stateOf(s) !== "passed")
    const yourRow = rows.find((s) => isYours(s) && stateOf(s) !== "passed") ?? null
    const focus = yourRow
        ?? (isAtStop && currentSeq !== undefined ? rows.find((s) => s.sequence === currentSeq) : undefined)
        ?? (nextSeq !== undefined ? rows.find((s) => s.sequence === nextSeq) : undefined)
        ?? aheadRows[0]
        ?? null
    const focusTime = focus ? timeBySeq.get(focus.sequence) : undefined
    const focusMs = focusTime ? focusTime.arrival_time || focusTime.departure_time : 0
    const minutesText = (ms: number) => {
        const m = Math.ceil((ms - now) / 60_000)
        return m <= 0 ? "Now" : m < 90 ? `${m} min` : ""
    }
    const startSeq = isAtStop ? currentSeq ?? 0 : nextSeq ?? currentSeq ?? 0
    const between = focus ? rows.filter((s) => s.sequence >= startSeq && s.sequence < focus.sequence).length : 0
    const stopsToGo = (n: number) => (isAtStop && n <= 1 && focus?.sequence === currentSeq ? "At the stop" : n <= 1 ? (yourRow ? "Your stop is next" : "Next stop") : `${n} stops to go`)

    // iOS `VehicleQuickLookView`: follow the vehicle (700 m across to start);
    // with no live position, frame the whole trip's stops. Until the rider pans.
    const cameraMode: TrackerCameraMode = v
        ? { kind: "follow", id: tripId!, at: { lat: v.position.lat, lon: v.position.lon }, spanMeters: 700, bearing: v.position.bearing }
        : rows.length ? { kind: "frame", points: rows.map((s) => ({ lat: s.lat, lon: s.lon })), minSpanMeters: 800 } : { kind: "none" }
    // Phones: clear of the top bar and the drawer. Wide windows: right of the side panel.
    const layout = useLayout()
    const mapPadding = layout.wide
        ? { top: insets.top + 60, bottom: insets.bottom + 20, left: panelInset(layout.panelWidth, insets.left), right: 0 }
        : { top: insets.top + 60, bottom: 360, left: 0, right: 0 }
    const tracker = useTrackerCamera(camera, cameraMode, { padding: mapPadding, threeD: filter.threeD })

    const more = () => {
        const options: { label: string; run: () => void }[] = []
        if (v) options.push({ label: `Alerts for route ${v.route.name}`, run: () => router.push({ pathname: "/alerts/route", params: { routeId: v.route.id } }) })
        options.push({
            label: filter.threeD ? "Flat map" : "3D map",
            run: () => {
                setFilter({ threeD: !filter.threeD })
                tracker.recentre()
            },
        })
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length }, (i) => options[i]?.run())
        else Alert.alert("More", undefined, [...options.map((o) => ({ text: o.label, onPress: o.run })), { text: "Cancel", style: "cancel" as const }])
    }
    const headsign = headsignDisplay(v?.trip?.headsign || (rows.length ? tripStopLabel(rows[rows.length - 1]) : ""))
    const bell = (s: TripStopRef) => {
        router.push({ pathname: "/trip-reminder", params: { tripId: tripId!, stopId: s.parent_stop_id || s.child_stop_id, stopName: tripStopLabel(s), getOff: "1", seq: String(s.sequence) } })
    }
    /** Tapping a stop makes it yours, with a reminder as the vehicle arrives; tapping yours again clears it. */
    const [picking, setPicking] = useState(false)
    const pick = async (s: TripStopRef) => {
        if (picking) return
        if (target && target.stopSeq === s.sequence) {
            clearTripTarget(tripId!)
            return
        }
        if (!(await requestNotifications())) {
            Alert.alert("Notifications are off", "Turn them on for Transit in Settings to get told when it's arriving.")
            return
        }
        setPicking(true)
        const error = await setTripReminder(tripId!, { seq: s.sequence, stopId: s.parent_stop_id || s.child_stop_id, name: tripStopLabel(s) }, "arrival")
        setPicking(false)
        if (error) Alert.alert("Couldn't set your stop", error)
    }

    // The Live Activity: your stop with a reminder set, while the trip is live.
    const targetRow = target ? rows.find((s) => s.sequence === target.stopSeq) : undefined
    const targetTime = targetRow ? timeBySeq.get(targetRow.sequence) : undefined
    useEffect(() => {
        if (!target || !targetRow || !target.reminders.length || region.realtime === false) return
        const dueMs = targetTime ? targetTime.arrival_time || targetTime.departure_time : 0
        if (!dueMs) return
        const scheduledMs = targetTime?.scheduled_time || dueMs
        const passed = stateOf(targetRow) === "passed"
        const away = v ? rows.filter((s) => s.sequence >= startSeq && s.sequence < targetRow.sequence).length : undefined
        const nextRow = nextSeq !== undefined ? rows.find((s) => s.sequence === nextSeq) : undefined
        const content: TripActivityContent = {
            version: 1,
            phase: passed ? "gone" : away === 0 ? "next" : "coming",
            targetUnix: dueMs / 1000,
            delayMinutes: Math.round((dueMs - scheduledMs) / 60_000),
            stopsAway: passed ? undefined : away,
            nextStopName: nextRow ? tripStopLabel(nextRow) : undefined,
            hasVehicle: !!v,
            isRealtime: !!v,
            skipped: !!targetTime?.skipped,
            occupancy: v && v.occupancy >= 0 ? v.occupancy : undefined,
            updatedUnix: Math.floor(now / 1000),
        }
        updateTripLive({
            tripID: tripId!,
            regionSlug: getRegionSlug(region),
            stopID: target.stopId,
            stopName: target.stopName,
            routeShortName: v?.route.name ?? route?.route_short_name ?? "",
            routeColorHex: routeHex.replace("#", ""),
            headsign,
            vehicleMode: v?.type ?? "",
            kind: activityKind(target),
        }, content, scheduledMs / 1000, target.stopSeq)
        // Re-run when the feed or the clock moves - the derived values above come from these.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target, targetRow?.sequence, targetTime, v, now, region])

    const shapeCoords = shape.data ? lineCoordinates(shape.data.geojson) : []
    const center = v ? { lat: v.position.lat, lon: v.position.lon } : rows[0] ? { lat: rows[0].lat, lon: rows[0].lon } : { lat: region.defaultMapCenter[0], lon: region.defaultMapCenter[1] }
    const fg = textOn(routeHex)

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <TransitMap
                ref={camera}
                center={center}
                zoom={15.5}
                threeD={filter.threeD}
                pitch={filter.threeD ? 60 : 0}
                padding={mapPadding}
                onRegionDidChange={tracker.onRegionDidChange}
                onLoaded={tracker.onLoaded}
                lines={[{ id: "shape", coords: shapeCoords, color: routeHex }]}
                markers={[
                    ...rows.map((s, i): MapMarker => {
                        const st = stateOf(s)
                        const yours = isYours(s)
                        const last = i === rows.length - 1
                        const coordinate = { lat: s.lat, lon: s.lon }
                        if (yours) return { id: `m-${s.sequence}`, coordinate, anchor: "bottom", view: { type: "pin", color: colors.danger }, zIndex: 3, accessibilityLabel: `Your stop, ${tripStopLabel(s)}` }
                        if (st === "next" || st === "current" || last) {
                            return { id: `m-${s.sequence}`, coordinate, zIndex: 2, view: { type: "dot", size: 18, fill: st === "current" ? colors.warning : st === "next" ? colors.live : routeHex, stroke: "#fff", strokeWidth: 3 } }
                        }
                        return { id: `m-${s.sequence}`, coordinate, view: { type: "dot", size: 12, fill: colors.card, stroke: st === "passed" ? colors.border : routeHex, strokeWidth: 3 } }
                    }),
                    ...(v ? [{ id: "vehicle", coordinate: { lat: v.position.lat, lon: v.position.lon }, zIndex: 4, view: { type: "vehicle" as const, mode: v.type, color: "#0D1A12", bearing: v.position.bearing } }] : []),
                ]}
            />

            <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
                <GlassButton icon={ChevronLeft} label="Back" onPress={() => router.back()} size={52} />
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                    {/* iOS: location.north.circle, filled and live-tinted while following. */}
                    <GlassButton label={tracker.following ? "Following the vehicle" : "Follow the vehicle"} size={52} onPress={tracker.recentre}>
                        <LocationNorthCircle size={52 * 0.45} color={colors.foreground} fill={tracker.following ? colors.live : undefined} />
                    </GlassButton>
                    <GlassButton icon={Ellipsis} label="More" onPress={more} size={52} />
                </View>
            </View>

            <MapDrawer snapPoints={["42%", "88%"]} index={0}>
                <View style={styles.header}>
                    {rows.length === 0 && !v ? (
                        hasLoaded ? (
                            <View style={styles.noLive}>
                                <View style={[styles.noLiveIcon, { backgroundColor: colors.muted }]}><WifiOff size={18} color={colors.mutedForeground} /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[type.cardTitle, { color: colors.foreground }]}>No live position yet</Text>
                                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{"This trip isn't sending its location - the times below are from the timetable."}</Text>
                                </View>
                            </View>
                        ) : <Text style={[type.meta, { color: colors.mutedForeground }]}>Finding the vehicle...</Text>
                    ) : (
                        <>
                            <View style={styles.what}>
                                <RouteBadge name={v?.route.name ?? route?.route_short_name ?? ""} color={routeHex} />
                                <Text style={[type.cardTitle, { flex: 1, color: colors.foreground }]} numberOfLines={1}>{headsign}</Text>
                            </View>
                            {focus ? (
                                <>
                                    <View style={styles.focus}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[type.meta, { color: colors.mutedForeground }]}>{yourRow ? "To your stop" : isAtStop && focus.sequence === currentSeq ? "At" : "Next stop"}</Text>
                                            <Text style={[type.pageTitle, { color: colors.foreground, fontSize: 20 }]} numberOfLines={1}>{tripStopLabel(focus)}</Text>
                                        </View>
                                        {focusMs ? (
                                            <View style={{ alignItems: "flex-end" }}>
                                                <Text style={[type.minutes, { fontSize: 26, color: v ? colors.live : colors.foreground }]}>{minutesText(focusMs)}</Text>
                                                <Text style={[type.meta, { color: colors.mutedForeground }]}>{laClock(new Date(focusMs), tz)}</Text>
                                            </View>
                                        ) : null}
                                    </View>
                                    <View style={styles.strip} accessibilityLabel={stopsToGo(between + 1)}>
                                        <View style={[styles.stripVehicle, { backgroundColor: routeHex }]}><ModeIcon mode={v?.type ?? "bus"} size={13} color={fg} /></View>
                                        {Array.from({ length: Math.min(between, 14) }).flatMap((_, i) => [
                                            <View key={`l${i}`} style={[styles.stripLine, { backgroundColor: routeHex }]} />,
                                            <View key={`d${i}`} style={[styles.stripDot, { borderColor: routeHex, backgroundColor: colors.background }]} />,
                                        ])}
                                        <View style={[styles.stripLine, { backgroundColor: routeHex }]} />
                                        {yourRow ? <MapPin size={22} color="#fff" fill={colors.danger} /> : <View style={[styles.stripEnd, { borderColor: routeHex }]}><View style={[styles.stripEndDot, { backgroundColor: routeHex }]} /></View>}
                                    </View>
                                    <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>{stopsToGo(between + 1)}</Text>
                                </>
                            ) : null}
                            {/* One quiet line: live or timetable, then what's known - lower-priority items drop off rather than wrap. */}
                            <FitRow gap={14} items={(v ? [
                                <View key="live" style={styles.statusItem}><View style={[styles.liveDot, { backgroundColor: colors.success }]} /><Text style={[type.meta, { color: colors.mutedForeground }]}>Live</Text></View>,
                                v.off_course ? <View key="off" style={styles.statusItem}><TriangleAlert size={13} color={colors.warning} fill={colors.warning} /><Text style={[type.meta, { color: colors.warning }]}>Off course</Text></View> : null,
                                v.occupancy >= 0 && occupancyShort(v.occupancy) ? (
                                    <View key="occ" style={styles.statusItem}>
                                        {[0, 1, 2].map((k) => {
                                            const on = k <= Math.min(2, Math.floor(v.occupancy / 2))
                                            return <User key={k} size={12} color={on ? colors.foreground : colors.border} />
                                        })}
                                        <Text style={[type.meta, { color: colors.mutedForeground }]}>{occupancyShort(v.occupancy)}</Text>
                                    </View>
                                ) : null,
                                v.cars ? <Text key="cars" style={[type.meta, { color: colors.mutedForeground }]}>{v.cars} cars</Text> : null,
                                v.trip?.next_stop?.platform ? <Text key="plat" style={[type.meta, { color: colors.mutedForeground }]}>Platform {v.trip.next_stop.platform}</Text> : null,
                            ] : hasLoaded ? [
                                <View key="tt" style={styles.statusItem}><WifiOff size={13} color={colors.mutedForeground} /><Text style={[type.meta, { color: colors.mutedForeground }]}>Timetable times - no live position</Text></View>,
                            ] : []).filter(Boolean)} />
                        </>
                    )}
                </View>
                    {passedRows.length > 0 ? (
                        <Pressable accessibilityRole="button" onPress={() => setShowEarlier((s) => !s)} style={styles.earlier}>
                            {showEarlier ? <ChevronUp size={14} color={colors.mutedForeground} /> : <ChevronDown size={14} color={colors.mutedForeground} />}
                            <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>{showEarlier ? "Hide earlier stops" : `${passedRows.length} earlier stop${passedRows.length === 1 ? "" : "s"}`}</Text>
                        </Pressable>
                    ) : null}
                    {(showEarlier ? rows : aheadRows).map((s, i, list) => {
                        const st = stateOf(s)
                        const yours = isYours(s)
                        const passed = st === "passed"
                        const t = timeBySeq.get(s.sequence)
                        const ms = t ? t.arrival_time || t.departure_time : 0
                        const isFirst = s.sequence === rows[0]?.sequence
                        const isLast = i === list.length - 1
                        const detail = [st === "current" ? "At this stop" : st === "next" ? "Next stop" : null, yours ? "Your stop" : null, t?.skipped ? "Skipped" : null, s.platform ? `Platform ${s.platform}` : null].filter(Boolean).join("  ")
                        const highlight = st === "next" ? colors.live : st === "current" ? colors.warning : null
                        return (
                            <Pressable
                                key={`${s.sequence}`}
                                disabled={passed || region.realtime === false}
                                onPress={() => pick(s)}
                                accessibilityRole="button"
                                accessibilityHint={yours ? "Clears your stop" : "Makes this your stop, with a reminder as it arrives"}
                                style={({ pressed }) => [styles.stopRow, highlight ? { backgroundColor: highlight + "12" } : null, pressed && { backgroundColor: colors.muted }, passed && { opacity: 0.7 }]}
                                testID={st === "next" ? "tracker-next-stop" : "tracker-stop"}
                            >
                                <View style={styles.rail}>
                                    <View style={[styles.railLine, { backgroundColor: isFirst ? "transparent" : routeHex, opacity: passed || st === "current" ? 0.3 : 1 }]} />
                                    <View style={[styles.railLine, { backgroundColor: isLast ? "transparent" : routeHex, opacity: passed ? 0.3 : 1 }]} />
                                    <View style={styles.railMarker}>
                                        {yours ? <MapPin size={20} color="#fff" fill={colors.danger} />
                                            : highlight ? <View style={[styles.railBig, { backgroundColor: highlight, borderColor: colors.background }]} />
                                                : <View style={[styles.railDot, { borderColor: passed ? colors.border : routeHex, backgroundColor: colors.background }]} />}
                                    </View>
                                </View>
                                <View style={{ flex: 1, paddingVertical: spacing.sm }}>
                                    <Text style={[st === "next" || st === "current" || yours ? type.bodyMedium : type.body, { color: passed ? colors.mutedForeground : colors.foreground }]} numberOfLines={1}>{tripStopLabel(s)}</Text>
                                    {detail ? <Text style={[type.meta, { color: st === "next" ? colors.live : st === "current" ? colors.warning : yours ? colors.danger : colors.mutedForeground }]} numberOfLines={1}>{detail}</Text> : null}
                                </View>
                                {ms ? (
                                    <View style={{ alignItems: "flex-end" }}>
                                        {!passed && minutesText(ms) ? <Text style={[type.minutes, { fontSize: 14, color: st === "next" || yours ? colors.live : colors.foreground }]}>{minutesText(ms)}</Text> : null}
                                        <Text style={[type.meta, { color: colors.mutedForeground }]}>{laClock(new Date(ms), tz)}</Text>
                                    </View>
                                ) : null}
                                {!passed && region.realtime !== false ? (
                                    <Pressable accessibilityRole="button" accessibilityLabel={yours && target?.reminders.length ? `Reminder set for ${tripStopLabel(s)}` : `Remind me about ${tripStopLabel(s)}`} onPress={() => bell(s)} style={styles.bell}>
                                        {yours && target?.reminders.length ? <BellRing size={18} color={colors.live} /> : <Bell size={18} color={colors.mutedForeground} />}
                                    </Pressable>
                                ) : <View style={{ width: 44 }} />}
                            </Pressable>
                        )
                    })}
            </MapDrawer>
        </View>
    )
}

const styles = StyleSheet.create({
    topBar: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", justifyContent: "space-between" },
    header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
    noLive: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    noLiveIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    what: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    focus: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
    strip: { flexDirection: "row", alignItems: "center" },
    stripVehicle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    stripLine: { flex: 1, height: 3 },
    stripDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
    stripEnd: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
    stripEndDot: { width: 8, height: 8, borderRadius: 4 },
    statusItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    liveDot: { width: 9, height: 9, borderRadius: 5 },
    earlier: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    stopRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, minHeight: 58 },
    rail: { width: 24, alignSelf: "stretch", alignItems: "center" },
    railLine: { width: 4, flex: 1 },
    railMarker: { position: "absolute", top: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
    railDot: { width: 13, height: 13, borderRadius: 7, borderWidth: 3 },
    railBig: { width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
    bell: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
})
