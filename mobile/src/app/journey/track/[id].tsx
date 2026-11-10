import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import * as Haptics from "expo-haptics"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowDownCircle, ArrowUp, ChevronLeft, CircleCheck, CornerUpLeft, CornerUpRight, Ellipsis, Flag, Footprints, LocateFixed, MapPin, Navigation, RefreshCw, Share2, TriangleAlert, WifiOff } from "@/components/icons"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { formatDistance, formatDuration } from "@transit/shared/logic/basics"
import { laClock, replanChoices } from "@transit/shared/logic/journey-live"
import { getRegionSlug } from "@transit/shared/regions"
import { lineCoordinates } from "@transit/shared/models"
import { JourneyLegBar, JourneyTimeline, journeyLines, legDate, legRouteName, type LegStatus } from "@/components/journey"
import { TransitMap, isValidCoordinate, type MapCamera } from "@/components/transit-map"
import { ErrorText, FitRow, GlassButton, Loading, RouteBadge, hexColor } from "@/components/ui"
import type { JourneyTick } from "@/lib/journey-session"
import { api } from "@/lib/api"
import { packIsComplete, useJourneyPack } from "@/lib/journey-pack"
import { destinationLabel, startJourney, stopJourney, useJourneyTick } from "@/lib/journey-runner"
import { activeRide, trackerSummary, type StatusTone } from "@/lib/journey-status"
import { journeyWebLink } from "@/lib/links"
import { useMapFilter } from "@/lib/map-filter"
import { usePlan } from "@/lib/plans"
import { unwrap } from "@/lib/queries"
import { setJourneyTrackerOpen } from "@/lib/push"
import { useRegion } from "@/lib/region"
import { journeyCamera, useTrackerCamera } from "@/lib/tracker-camera"
import { useWalkNavigation } from "@/lib/walk-nav"
import { radius, spacing, type, useColors } from "@/theme"

/** Live journey tracking - iOS `JourneyTrackingView` (restyled 2026-11-03). */

export default function JourneyTracker() {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { id } = useLocalSearchParams<{ id: string }>()
    const { region } = useRegion()
    const tz = region.timeZone
    const { data: plan, isLoading, error } = usePlan(id)
    // Opening the tracker starts (or resumes) this journey; the app-wide
    // runner does the tracking, so it carries on when this is minimised.
    useEffect(() => { if (plan) startJourney(plan.ID, region.url) }, [plan, region.url])
    const tick = useJourneyTick(plan?.ID)
    const pack = useJourneyPack(plan?.ID)
    const [now, setNow] = useState(() => Date.now())
    const [filter, setFilter] = useMapFilter()

    // The journey as it stands: the plan re-timed from live data, where you
    // are in it, and the vehicle for the ride you're on or about to catch
    // (iOS `activeRideVehicle` - the map shows only this one).
    const display = tick?.displayPlan ?? plan
    const snap = tick?.snapshot ?? null
    const vehicle = snap?.trackedTripId ? tick?.vehicles[snap.trackedTripId] : undefined
    const ride = display ? activeRide(display, snap) : undefined
    const user = tick?.user && isValidCoordinate(tick.user) ? tick.user : null

    const moment = useMomentBanner(tick)
    const walk = useWalkNavigation(display, snap?.progressLegIndex ?? -1, snap?.phase === "walking", user)

    // Map: the camera follows the stage of the journey (tracker-camera.ts);
    // the clear area is between the top bar (plus the walk card while it
    // shows, as iOS) and the drawer.
    const camera = useRef<MapCamera>(null)
    // The drawer: peek (just the hero row - the map gets nearly the whole
    // screen), compact (down to the actions) and full - iOS's detents. The
    // peek hugs the hero row, which is one or two lines.
    const { height: screenHeight } = useWindowDimensions()
    const [heroHeight, setHeroHeight] = useState(56)
    const [drawer, setDrawer] = useState<Drawer>("compact")
    // iOS `peekHeight`: handle + top padding + hero + 16 - the leg bar starts right below, out of sight.
    const peekHeight = Math.round(DRAWER_HANDLE + spacing.sm + heroHeight + spacing.lg)
    const snapPoints = useMemo(() => [peekHeight, "40%", "90%"], [peekHeight])
    // The map's clear area ends at the drawer (iOS caps it at half the screen when the drawer's up).
    const drawerCover = drawer === "peek" ? peekHeight : drawer === "compact" ? COMPACT_COVER : screenHeight / 2
    const mapPadding = { top: insets.top + 70 + (walk || moment ? 76 : 0), bottom: drawerCover, left: 0, right: 0 }
    const tracker = useTrackerCamera(camera, journeyCamera(display ?? null, snap, vehicle, user), { padding: mapPadding, threeD: filter.threeD })
    // The active ride is drawn along the vehicle's whole route, greyed before
    // you board and after you get off (iOS `rideShapes`); same cache as the trip screen.
    const shape = useQuery({
        queryKey: ["trip-shape", region.url, ride?.TripID],
        queryFn: async () => unwrap(api.routeShape({ tripId: ride!.TripID })),
        enabled: !!ride?.TripID,
        staleTime: Infinity,
    })

    useEffect(() => {
        setJourneyTrackerOpen(true)
        const timer = setInterval(() => setNow(Date.now()), 1_000)
        return () => {
            setJourneyTrackerOpen(false)
            clearInterval(timer)
        }
    }, [])

    if (isLoading) return <Loading />
    if (error || !plan || !display) return <View style={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl }}><ErrorText>{(error as Error | null)?.message ?? "Journey not found"}</ErrorText></View>

    const legs = display.Legs
    const destination = destinationLabel(display)
    const summary = trackerSummary({ plan: display, snap, vehicle, destination, online: tick?.online ?? true, lastLiveAt: tick?.lastLiveAt ?? null, savedOffline: packIsComplete(pack), now, tz })
    const { countdown } = summary
    const toneColor = (t?: StatusTone) => (t ? colors[t] : colors.mutedForeground)

    const choices = snap && !snap.journeyArrived ? replanChoices({
        legs, progressLegIndex: snap.progressLegIndex, phase: snap.phase,
        vehicleNextStop: vehicle?.trip?.next_stop ? { name: vehicle.trip.next_stop.name, coordinate: { lat: vehicle.trip.next_stop.lat, lon: vehicle.trip.next_stop.lon } } : null,
        vehicleNextStopETA: null, userLocation: user, tz,
    }) : []
    const share = () => Share.share({ message: `Follow my journey\n${journeyWebLink(plan.ID, getRegionSlug(region), true)}` })
    const replan = () => {
        const end = legs[legs.length - 1]
        const toLat = display.EndLat || end?.ToStop?.stop_lat || 0
        const toLon = display.EndLon || end?.ToStop?.stop_lon || 0
        const go = (c: (typeof choices)[number]) => router.push({ pathname: "/(tabs)/planner", params: { fromLat: String(c.origin.lat), fromLon: String(c.origin.lon), fromLabel: c.originLabel, toLat: String(toLat), toLon: String(toLon), toLabel: destination, departAt: String(c.departAt.getTime()) } })
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ title: "Re-plan from…", options: [...choices.map((c) => `${c.label} - ${c.detail}`), "Cancel"], cancelButtonIndex: choices.length }, (i) => choices[i] && go(choices[i]))
        else Alert.alert("Re-plan from…", undefined, [...choices.map((c) => ({ text: `${c.label} - ${c.detail}`, onPress: () => go(c) })), { text: "Cancel", style: "cancel" as const }])
    }
    // Back to wherever the tracker was opened from (Home from a link or notification).
    const close = () => (router.canGoBack() ? router.back() : router.replace("/"))
    const end = () => {
        stopJourney()
        close()
    }
    // Minimise keeps the journey going - unless it's arrived, when there's
    // nothing left to resume (iOS `leaveTracker`).
    const minimise = () => (snap?.journeyArrived ? end() : close())
    const confirmEnd = () => {
        const msg = "Get-off alerts and the live notification will stop. Minimise keeps them going."
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ title: "End this journey?", message: msg, options: ["End journey", "Minimise instead", "Keep tracking"], destructiveButtonIndex: 0, cancelButtonIndex: 2 }, (i) => (i === 0 ? end() : i === 1 ? close() : undefined))
        else Alert.alert("End this journey?", msg, [{ text: "End journey", style: "destructive", onPress: end }, { text: "Minimise instead", onPress: close }, { text: "Keep tracking", style: "cancel" }])
    }
    const toggle3D = () => {
        setFilter({ threeD: !filter.threeD })
        tracker.recentre()
    }
    // iOS's ⋯ menu: the 3D toggle and End (behind a confirmation). Share is
    // in the drawer's actions row.
    const more = () => {
        const opts = [{ label: filter.threeD ? "Flat map" : "3D map", run: toggle3D }, { label: "End journey", run: confirmEnd }]
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: [...opts.map((o) => o.label), "Cancel"], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (i) => opts[i]?.run())
        else Alert.alert("Journey", undefined, [...opts.map((o, i) => ({ text: o.label, style: i === 1 ? ("destructive" as const) : undefined, onPress: o.run })), { text: "Cancel", style: "cancel" as const }])
    }

    const lines = journeyLines(display, colors.live, ride && shape.data ? { tripId: ride.TripID, shape: lineCoordinates(shape.data.geojson) } : null)
    const planStart = { lat: plan.StartLat, lon: plan.StartLon }
    const fraction = (() => {
        const a = legDate(display.DepartureTime)?.getTime() ?? now
        const b = legDate(display.ArrivalTime)?.getTime() ?? now
        return Math.max(0, Math.min(1, (now - a) / Math.max(b - a, 1)))
    })()
    const minutesText = (t: Date) => {
        const m = Math.ceil((t.getTime() - now) / 60_000)
        return m <= 0 ? "Now" : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
    }
    const legStatus = (i: number): LegStatus => (!snap || snap.progressLegIndex < 0 ? "upcoming" : i < snap.progressLegIndex ? "done" : i === snap.progressLegIndex ? "current" : "upcoming")
    const statusIcon = { alert: TriangleAlert, offline: WifiOff, gps: Navigation, saved: ArrowDownCircle } as const

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <TransitMap
                ref={camera}
                center={user ?? (isValidCoordinate(planStart) ? planStart : { lat: 0, lon: 0 })}
                zoom={16}
                threeD={filter.threeD}
                padding={mapPadding}
                onRegionDidChange={tracker.onRegionDidChange}
                onLoaded={tracker.onLoaded}
                lines={lines.map((l) => ({ id: `trk-${l.id}`, coords: l.coords, color: l.color, dashed: l.walk, width: l.muted ? 4 : undefined }))}
                markers={(vehicle && isValidCoordinate(vehicle.position) ? [vehicle] : []).map((v) => ({
                    id: `veh-${v.trip_id}`, coordinate: { lat: v.position.lat, lon: v.position.lon }, zIndex: 4,
                    view: { type: "vehicle" as const, mode: v.type, color: hexColor(v.route.color, "#0D1A12"), bearing: v.position.bearing }, accessibilityLabel: `${v.type} ${v.route.name}`,
                }))}
            />

            <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
                <GlassButton icon={ChevronLeft} label="Minimise" onPress={minimise} size={52} />
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                    <GlassButton icon={LocateFixed} label={tracker.following ? "Following your journey" : "Follow my journey"} active={tracker.following} size={52} onPress={tracker.recentre} />
                    <GlassButton icon={Ellipsis} label="More" onPress={more} size={52} />
                </View>
            </View>
            {walk && !moment ? <WalkBanner walk={walk} top={insets.top + 72} /> : null}
            {moment ? (
                <View accessibilityLiveRegion="assertive" style={[styles.banner, { top: insets.top + 72, backgroundColor: colors.primary }]}>
                    <Text style={[type.cardTitle, { color: colors.primaryForeground }]}>{moment.title}</Text>
                    <Text style={[type.body, { color: colors.primaryForeground }]}>{moment.body}</Text>
                </View>
            ) : null}

            <BottomSheet snapPoints={snapPoints} index={1} onChange={(i) => i >= 0 && setDrawer(DRAWER_STATES[i] ?? "compact")} backgroundStyle={{ backgroundColor: colors.background }} handleIndicatorStyle={{ backgroundColor: colors.mutedForeground, width: 40 }}>
                <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + 40, gap: spacing.lg }}>
                    {!tick ? <Loading /> : (
                        <>
                            <View style={styles.hero} accessible onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}>
                                {snap?.journeyArrived ? <CircleCheck size={22} color={colors.success} />
                                    : snap?.phase === "walking" || !ride ? <View style={[styles.walkTile, { backgroundColor: colors.muted }]}><Footprints size={14} color={colors.foreground} /></View>
                                        : <RouteBadge name={legRouteName(ride) || "Bus"} color={ride.Route?.route_color} />}
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={[type.cardTitle, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>{summary.headline}</Text>
                                    {summary.subline ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{summary.subline}</Text> : null}
                                </View>
                                {countdown ? <Text style={[type.minutes, { fontSize: 24, minWidth: 80, textAlign: "right", color: countdown.urgent ? colors.warning : colors.live }]}>{minutesText(countdown.target)}</Text> : null}
                            </View>
                            {snap && !snap.journeyArrived ? (
                                <View style={{ gap: spacing.sm }}>
                                    <JourneyLegBar plan={display} currentIndex={snap.progressLegIndex} progress={fraction} />
                                    <View style={styles.between}>
                                        <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Arrive {legDate(display.ArrivalTime) ? laClock(legDate(display.ArrivalTime)!, tz) : ""}</Text>
                                        <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>{formatDuration(display.TotalDuration)} trip</Text>
                                    </View>
                                </View>
                            ) : null}
                            {summary.status.length ? (
                                // Problems first; lower-priority facts drop off rather than wrap (iOS `ViewThatFits`).
                                <FitRow gap={14} items={summary.status.map((it, i) => {
                                    const Icon = it.icon ? statusIcon[it.icon] : null
                                    return (
                                        <View key={i} style={styles.statusItem}>
                                            {it.liveDot ? <View style={[styles.liveDot, { backgroundColor: colors.success }]} /> : null}
                                            {it.spinner ? <ActivityIndicator size="small" /> : null}
                                            {Icon ? <Icon size={13} color={toneColor(it.tone)} /> : null}
                                            <Text numberOfLines={1} style={[it.tone ? type.metaMedium : type.meta, { color: toneColor(it.tone) }]}>{it.text}</Text>
                                        </View>
                                    )
                                })} />
                            ) : null}
                            <View style={styles.actions}>
                                {choices.length ? (
                                    <Pressable accessibilityRole="button" onPress={replan} style={[styles.action, { flex: 1, backgroundColor: summary.replanUrgent ? colors.danger : colors.card, borderColor: summary.replanUrgent ? colors.danger : colors.border }]}>
                                        <RefreshCw size={16} color={summary.replanUrgent ? "#fff" : colors.foreground} />
                                        <Text style={[type.bodyMedium, { color: summary.replanUrgent ? "#fff" : colors.foreground }]}>Find a better route</Text>
                                    </Pressable>
                                ) : null}
                                <Pressable accessibilityRole="button" accessibilityLabel="Share journey" onPress={share} style={[styles.action, choices.length ? { width: 48 } : { flex: 1 }, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <Share2 size={16} color={colors.foreground} />
                                    {choices.length ? null : <Text style={[type.bodyMedium, { color: colors.foreground }]}>Share journey</Text>}
                                </Pressable>
                            </View>
                            <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Your trip</Text>
                            <JourneyTimeline legs={legs} tz={tz} destinationName={destination} status={legStatus}
                                tracked={(i) => { const l = legs[i]; return l?.Mode === "transit" && tick ? !!tick.vehicles[l.TripID] || undefined : undefined }} />
                        </>
                    )}
                </BottomSheetScrollView>
            </BottomSheet>
        </View>
    )
}

/** The walking step you're on - iOS's turn-by-turn card over the map. */
function WalkBanner({ walk, top }: { walk: NonNullable<ReturnType<typeof useWalkNavigation>>; top: number }) {
    const colors = useColors()
    const { step, distance, arrived } = walk
    const Icon = arrived || step.type === "arrive" ? Flag : step.type === "depart" ? MapPin : step.modifier.includes("right") ? CornerUpRight : step.modifier.includes("left") ? CornerUpLeft : ArrowUp
    const text = arrived ? "You've arrived" : step.instruction.charAt(0).toUpperCase() + step.instruction.slice(1)
    return (
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${text}${!arrived && distance > 0 ? `, ${formatDistance(distance)}` : ""}`}
            style={[styles.walkBanner, { top, backgroundColor: arrived ? colors.success + "26" : colors.card + "f2", borderColor: colors.border }]}>
            <View style={[styles.walkIcon, { backgroundColor: arrived ? colors.success : colors.live }]}><Icon size={20} color="#fff" /></View>
            <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: colors.foreground }]} numberOfLines={2}>{text}</Text>
                {!arrived && distance > 0 ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{formatDistance(distance)}</Text> : null}
            </View>
        </View>
    )
}

/** In-app "get on now" / "get off next" - iOS `JourneyAlertCenter`. Shown once each, for 8 s, with a haptic. */
function useMomentBanner(tick: JourneyTick | null): { title: string; body: string } | null {
    const [banner, setBanner] = useState<{ title: string; body: string } | null>(null)
    const shown = useRef(new Set<string>())
    useEffect(() => {
        if (!tick) return
        const s = tick.snapshot
        const leg = tick.displayPlan.Legs[s.progressLegIndex]
        let key: string | null = null
        let next: { title: string; body: string } | null = null
        if (s.phase === "boarding" && leg?.Mode === "transit") {
            key = `${leg.TripID}:board`
            next = { title: `Get on the ${leg.Route?.route_short_name || "service"} now`, body: leg.FromStop ? `At ${leg.FromStop.stop_name}${leg.FromStop.platform_number ? `, platform ${leg.FromStop.platform_number}` : ""}` : "" }
        } else if (s.phase === "onboard" && s.trackedStopsAway === 0 && leg?.Mode === "transit") {
            key = `${leg.TripID}:alight`
            next = { title: "Get off at the next stop", body: leg.ToStop?.stop_name ?? "" }
        }
        if (!key || !next || shown.current.has(key)) return
        shown.current.add(key)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => { })
        setBanner(next)
        const timer = setTimeout(() => setBanner(null), 8_000)
        return () => clearTimeout(timer)
    }, [tick])
    return banner
}

type Drawer = "peek" | "compact" | "full"
const DRAWER_STATES: Drawer[] = ["peek", "compact", "full"]
/** The bottom sheet's grab-handle area. */
const DRAWER_HANDLE = 24
/** How much of the map the compact (40%) drawer covers, for centring - as before the peek existed. */
const COMPACT_COVER = 380

const styles = StyleSheet.create({
    topBar: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", justifyContent: "space-between" },
    walkBanner: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    walkIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    banner: { position: "absolute", left: spacing.md, right: spacing.md, padding: spacing.md, borderRadius: radius.lg },
    hero: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    walkTile: { width: 30, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center" },
    between: { flexDirection: "row", justifyContent: "space-between" },
    statusItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    actions: { flexDirection: "row", gap: spacing.sm },
    action: { height: 48, borderRadius: 24, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
})
