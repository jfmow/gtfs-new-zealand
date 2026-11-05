import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import * as Haptics from "expo-haptics"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowUp, ChevronLeft, CircleCheck, CornerUpLeft, CornerUpRight, Ellipsis, Flag, Footprints, LocateFixed, MapPin, Navigation, RefreshCw, Share2, TriangleAlert, WifiOff } from "@/components/icons"
import { useEffect, useRef, useState } from "react"
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { cleanStopName } from "@transit/shared/formatting"
import { formatDistance, formatDuration } from "@transit/shared/logic/basics"
import { laClock, replanChoices } from "@transit/shared/logic/journey-live"
import { connectionRisk } from "@transit/shared/logic/tracking"
import { getRegionSlug } from "@transit/shared/regions"
import type { Leg } from "@transit/shared/types/journey"
import { occupancyShort } from "@/components/departures"
import { JourneyLegBar, JourneyTimeline, journeyLines, legDate, legRouteName, type LegStatus } from "@/components/journey"
import { TransitMap, type MapCamera } from "@/components/transit-map"
import { ErrorText, FitRow, GlassButton, Loading, RouteBadge, hexColor } from "@/components/ui"
import type { JourneyTick } from "@/lib/journey-session"
import { startJourney, stopJourney, useJourneyTick } from "@/lib/journey-runner"
import { useMapFilter } from "@/lib/map-filter"
import { usePlan } from "@/lib/plans"
import { setJourneyTrackerOpen } from "@/lib/push"
import { useRegion } from "@/lib/region"
import { useWalkNavigation } from "@/lib/walk-nav"
import { radius, spacing, type, useColors } from "@/theme"

const WEB_HOST = "https://trains.suddsy.dev"

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
    const [now, setNow] = useState(() => Date.now())
    const moment = useMomentBanner(tick)
    const [filter, setFilter] = useMapFilter()
    const walk = useWalkNavigation(tick?.displayPlan, tick?.snapshot.progressLegIndex ?? -1, tick?.snapshot.phase === "walking", tick?.user ?? null)
    const [follow, setFollow] = useState(true)
    const camera = useRef<MapCamera>(null)
    // Follow the vehicle you're on (or yourself) until you pan the map.
    const followTarget = tick?.snapshot.followMarkerId ? tick.vehicles[tick.snapshot.followMarkerId.replace("vehicle-", "")]?.position ?? null : tick?.user ?? null
    useEffect(() => {
        if (follow && followTarget) camera.current?.easeTo({ center: [followTarget.lon, followTarget.lat], duration: 800 })
    }, [follow, followTarget?.lat, followTarget?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setJourneyTrackerOpen(true)
        const timer = setInterval(() => setNow(Date.now()), 1_000)
        return () => {
            setJourneyTrackerOpen(false)
            clearInterval(timer)
        }
    }, [])

    if (isLoading) return <Loading />
    if (error || !plan) return <View style={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl }}><ErrorText>{(error as Error | null)?.message ?? "Journey not found"}</ErrorText></View>

    const display = tick?.displayPlan ?? plan
    const legs = display.Legs
    const snap = tick?.snapshot ?? null
    const idx = Math.max(0, snap?.progressLegIndex ?? 0)
    const currentLeg = snap && snap.progressLegIndex >= 0 ? legs[snap.progressLegIndex] : undefined
    const nextRide = legs.slice(idx).find((l) => l.Mode === "transit")
    const vehicle = snap?.trackedTripId ? tick?.vehicles[snap.trackedTripId] : undefined
    const destinationName = cleanStopName(legs[legs.length - 1]?.ToStop?.stop_name ?? "") || "your destination"
    const clock = (d: unknown) => { const x = legDate(d); return x ? laClock(x, tz) : "" }
    const name = (l?: Leg) => (l ? legRouteName(l) || "Bus" : "service")
    const stopName = (st?: Leg["FromStop"]) => (st?.stop_name ? cleanStopName(st.stop_name) : null)

    const phaseLabel = (() => {
        if (!snap) return "Your journey"
        if (snap.journeyArrived) return "You've arrived"
        const leg = legs[Math.min(idx, legs.length - 1)]
        if (!leg) return "Tracking"
        switch (snap.phase) {
            case "walking": return leg.ToStop ? `Walking to ${cleanStopName(leg.ToStop.stop_name)}` : idx === legs.length - 1 ? "Almost there" : "Walking"
            case "waiting": return `Waiting for the ${name(leg.Mode === "transit" ? leg : nextRide)}`
            case "boarding": return `Boarding the ${name(leg.Mode === "transit" ? leg : nextRide)}`
            case "onboard": return leg.ToStop ? `On the ${name(leg)} → ${cleanStopName(leg.ToStop.stop_name)}` : `On the ${name(leg)}`
            default: return "Tracking"
        }
    })()

    const countdown: { target: Date; caption: string; place: string; urgent: boolean } | null = (() => {
        if (!snap || snap.journeyArrived) return null
        if (snap.phase === "onboard") {
            const a = legDate(currentLeg?.ArrivalTime)
            return a ? { target: a, caption: "Get off at", place: stopName(currentLeg?.ToStop) ?? "your stop", urgent: false } : null
        }
        if (snap.phase) {
            const dep = legDate(nextRide?.DepartureTime)
            if (nextRide && dep && (currentLeg?.Mode === "walk" || currentLeg?.TripID === nextRide.TripID)) {
                return { target: dep, caption: `${name(nextRide)} leaves`, place: stopName(nextRide.FromStop) ?? "the stop", urgent: dep.getTime() - now < 120_000 }
            }
            const arr = legDate(display.ArrivalTime)
            return arr ? { target: arr, caption: "Arrive at", place: destinationName, urgent: false } : null
        }
        const d = legDate(display.DepartureTime)
        return d ? { target: d, caption: "Leave from", place: stopName(legs[0]?.FromStop) ?? "your start", urgent: false } : null
    })()
    const heroExtra = !snap || snap.journeyArrived ? null : snap.phase === "onboard"
        ? (vehicle?.trip?.next_stop?.name ? `Next stop: ${vehicle.trip.next_stop.name}` : null)
        : nextRide?.FromStop?.platform_number ? `Platform ${nextRide.FromStop.platform_number}` : null
    const subline = !snap ? null : snap.journeyArrived ? `at ${destinationName}` : countdown
        ? `${countdown.caption} ${countdown.place} at ${laClock(countdown.target, tz)}${heroExtra ? `, ${heroExtra.charAt(0).toLowerCase()}${heroExtra.slice(1)}` : ""}`
        : heroExtra

    const risk = snap ? legs.map((_, i) => (i > idx ? connectionRisk(legs, i) : null)).find(Boolean) ?? null : null
    const stale = tick?.lastLiveAt ? now - tick.lastLiveAt > 45_000 : false
    const status: { text: string; color?: string; icon?: typeof WifiOff; dot?: string; spin?: boolean }[] = []
    if (snap && !snap.journeyArrived && snap.phase) {
        if (nextRide && !nextRide.trip_usable) status.push({ text: "Not running", color: colors.danger, icon: TriangleAlert })
        if (risk) status.push({ text: risk.level === "missed" ? "Connection missed" : "Tight connection", color: risk.level === "missed" ? colors.danger : colors.warning, icon: TriangleAlert })
        if (tick && !tick.online) status.push({ text: "Offline", color: colors.warning, icon: WifiOff })
        if (nextRide?.trip_usable && nextRide.delay_seconds && Math.abs(nextRide.delay_seconds) >= 60) status.push({ text: nextRide.delay_seconds > 0 ? `${Math.floor(nextRide.delay_seconds / 60)} min late` : `${Math.floor(-nextRide.delay_seconds / 60)} min early`, color: nextRide.delay_seconds > 0 ? colors.warning : colors.success })
        if (nextRide) {
            if (snap.trackingLevel === "live") status.push(stale ? { text: "Updating", spin: true } : { text: "Live", dot: colors.success })
            else if (snap.trackingLevel === "estimated") status.push({ text: "From GPS", icon: Navigation })
            else if (snap.trackingLevel === "predicted") status.push({ text: "Predicted" })
            else status.push({ text: "Timetable only" })
        }
        if (snap.trackedStopsAway != null && snap.trackedStopsToGo != null) {
            const away = snap.trackedStopsAway
            const atStop = snap.trackedStopsToGo === 0
            status.push({ text: snap.phase === "onboard"
                ? (atStop ? "At your stop - get off" : away === 0 ? "Get off at the next stop" : `${away + 1} stops to go`)
                : (atStop ? `${name(nextRide)} at your stop` : away === 0 ? `${name(nextRide)} arriving` : `${name(nextRide)} is ${away} stop${away === 1 ? "" : "s"} away`) })
        }
        if (vehicle && vehicle.occupancy >= 0 && occupancyShort(vehicle.occupancy)) status.push({ text: occupancyShort(vehicle.occupancy) })
        if (vehicle?.cars) status.push({ text: `${vehicle.cars} cars` })
    }

    const choices = snap && !snap.journeyArrived ? replanChoices({
        legs, progressLegIndex: snap.progressLegIndex, phase: snap.phase,
        vehicleNextStop: vehicle?.trip?.next_stop ? { name: vehicle.trip.next_stop.name, coordinate: { lat: vehicle.trip.next_stop.lat, lon: vehicle.trip.next_stop.lon } } : null,
        vehicleNextStopETA: null, userLocation: tick?.user ?? null, tz,
    }) : []
    const replanUrgent = !!risk || (!!nextRide && !nextRide.trip_usable)
    const shareUrl = `${WEB_HOST}/journey?id=${encodeURIComponent(plan.ID)}&region=${getRegionSlug(region)}&track=1`
    const share = () => Share.share({ message: `Follow my journey\n${shareUrl}` })
    const replan = () => {
        const end = legs[legs.length - 1]
        const toLat = display.EndLat || end?.ToStop?.stop_lat || 0
        const toLon = display.EndLon || end?.ToStop?.stop_lon || 0
        const go = (c: (typeof choices)[number]) => router.push({ pathname: "/(tabs)/planner", params: { fromLat: String(c.origin.lat), fromLon: String(c.origin.lon), fromLabel: c.originLabel, toLat: String(toLat), toLon: String(toLon), toLabel: destinationName, departAt: String(c.departAt.getTime()) } })
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ title: "Re-plan from…", options: [...choices.map((c) => `${c.label} - ${c.detail}`), "Cancel"], cancelButtonIndex: choices.length }, (i) => choices[i] && go(choices[i]))
        else Alert.alert("Re-plan from…", undefined, [...choices.map((c) => ({ text: `${c.label} - ${c.detail}`, onPress: () => go(c) })), { text: "Cancel", style: "cancel" as const }])
    }
    // Minimise: back to wherever the tracker was opened from - Home when it
    // was opened from a link or notification with nothing behind it.
    const leave = () => (router.canGoBack() ? router.back() : router.replace("/"))
    const end = () => {
        stopJourney()
        leave()
    }
    const confirmEnd = () => {
        const msg = "Get-off alerts and the live notification will stop. Minimise keeps them going."
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ title: "End this journey?", message: msg, options: ["End journey", "Minimise instead", "Keep tracking"], destructiveButtonIndex: 0, cancelButtonIndex: 2 }, (i) => (i === 0 ? end() : i === 1 ? leave() : undefined))
        else Alert.alert("End this journey?", msg, [{ text: "End journey", style: "destructive", onPress: end }, { text: "Minimise instead", onPress: () => leave() }, { text: "Keep tracking", style: "cancel" }])
    }
    const more = () => {
        const toggle3D = () => setFilter({ threeD: !filter.threeD })
        const opts = [{ label: filter.threeD ? "Flat map" : "3D map", run: toggle3D }, { label: "Share journey", run: share }, { label: "End journey", run: confirmEnd }]
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: [...opts.map((o) => o.label), "Cancel"], destructiveButtonIndex: 2, cancelButtonIndex: 3 }, (i) => opts[i]?.run())
        else Alert.alert("Journey", undefined, [...opts.map((o, i) => ({ text: o.label, style: i === 2 ? ("destructive" as const) : undefined, onPress: o.run })), { text: "Cancel", style: "cancel" as const }])
    }

    const lines = journeyLines(display, colors.live)
    const user = tick?.user ?? null
    const followVehicle = snap?.followMarkerId ? tick?.vehicles[snap.followMarkerId.replace("vehicle-", "")] : null
    const followAt = followVehicle ? { lat: followVehicle.position.lat, lon: followVehicle.position.lon } : user
    const startAt = followAt ?? { lat: plan.StartLat, lon: plan.StartLon }
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

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <TransitMap
                ref={camera}
                center={startAt}
                zoom={16}
                threeD={filter.threeD}
                pitch={filter.threeD ? 55 : followVehicle ? 40 : 0}
                padding={{ top: insets.top + 70, bottom: 380 }}
                onRegionDidChange={(_c, _z, _b, byUser) => { if (byUser) setFollow(false) }}
                lines={lines.map((l) => ({ id: `trk-${l.id}`, coords: l.coords, color: l.color, dashed: l.walk }))}
                markers={Object.values(tick?.vehicles ?? {}).map((v) => ({
                    id: `veh-${v.trip_id}`, coordinate: { lat: v.position.lat, lon: v.position.lon }, zIndex: 4,
                    view: { type: "vehicle" as const, mode: v.type, color: hexColor(v.route.color, "#0D1A12") }, accessibilityLabel: `${v.type} ${v.route.name}`,
                }))}
            />

            <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
                <GlassButton icon={ChevronLeft} label="Minimise" onPress={() => leave()} size={52} />
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                    <GlassButton icon={LocateFixed} label={follow ? "Following your journey" : "Follow my journey"} active={follow} size={52} onPress={() => { setFollow(true); if (followAt) camera.current?.easeTo({ center: [followAt.lon, followAt.lat], zoom: 16, duration: 600 }) }} />
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

            <BottomSheet snapPoints={["40%", "90%"]} index={0} backgroundStyle={{ backgroundColor: colors.background }} handleIndicatorStyle={{ backgroundColor: colors.mutedForeground, width: 40 }}>
                <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + 40, gap: spacing.lg }}>
                    {!tick ? <Loading /> : (
                        <>
                            <View style={styles.hero} accessible>
                                {snap?.journeyArrived ? <CircleCheck size={22} color={colors.success} />
                                    : snap?.phase === "walking" || !nextRide ? <View style={[styles.walkTile, { backgroundColor: colors.muted }]}><Footprints size={14} color={colors.foreground} /></View>
                                        : <RouteBadge name={name(nextRide)} color={nextRide.Route?.route_color} />}
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={[type.cardTitle, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>{phaseLabel}</Text>
                                    {subline ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{subline}</Text> : null}
                                </View>
                                {countdown ? <Text style={[type.minutes, { fontSize: 24, minWidth: 80, textAlign: "right", color: countdown.urgent ? colors.warning : colors.live }]}>{minutesText(countdown.target)}</Text> : null}
                            </View>
                            {snap && !snap.journeyArrived ? (
                                <View style={{ gap: spacing.sm }}>
                                    <JourneyLegBar plan={display} currentIndex={snap.progressLegIndex} progress={fraction} />
                                    <View style={styles.between}>
                                        <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Arrive {clock(display.ArrivalTime)}</Text>
                                        <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>{formatDuration(display.TotalDuration)} trip</Text>
                                    </View>
                                </View>
                            ) : null}
                            {status.length ? (
                                // Problems first; lower-priority facts drop off rather than wrap (iOS `ViewThatFits`).
                                <FitRow gap={14} items={status.map((it, i) => (
                                    <View key={i} style={styles.statusItem}>
                                        {it.dot ? <View style={[styles.liveDot, { backgroundColor: it.dot }]} /> : null}
                                        {it.spin ? <ActivityIndicator size="small" /> : null}
                                        {it.icon ? <it.icon size={13} color={it.color ?? colors.mutedForeground} /> : null}
                                        <Text numberOfLines={1} style={[it.color ? type.metaMedium : type.meta, { color: it.color ?? colors.mutedForeground }]}>{it.text}</Text>
                                    </View>
                                ))} />
                            ) : null}
                            <View style={styles.actions}>
                                {choices.length ? (
                                    <Pressable accessibilityRole="button" onPress={replan} style={[styles.action, { flex: 1, backgroundColor: replanUrgent ? colors.danger : colors.card, borderColor: replanUrgent ? colors.danger : colors.border }]}>
                                        <RefreshCw size={16} color={replanUrgent ? "#fff" : colors.foreground} />
                                        <Text style={[type.bodyMedium, { color: replanUrgent ? "#fff" : colors.foreground }]}>Find a better route</Text>
                                    </Pressable>
                                ) : null}
                                <Pressable accessibilityRole="button" accessibilityLabel="Share journey" onPress={share} style={[styles.action, choices.length ? { width: 48 } : { flex: 1 }, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <Share2 size={16} color={colors.foreground} />
                                    {choices.length ? null : <Text style={[type.bodyMedium, { color: colors.foreground }]}>Share journey</Text>}
                                </Pressable>
                            </View>
                            <Text style={[type.metaMedium, { color: colors.mutedForeground }]}>Your trip</Text>
                            <JourneyTimeline legs={legs} tz={tz} destinationName={destinationName} status={legStatus}
                                tracked={(i) => { const l = legs[i]; return l?.Mode === "transit" && tick ? !!tick.vehicles[l.TripID] || undefined : undefined }} />
                            <Pressable accessibilityRole="button" onPress={confirmEnd} style={{ alignSelf: "center", padding: spacing.sm }}>
                                <Text style={[type.bodyMedium, { color: colors.danger }]}>End journey</Text>
                            </Pressable>
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
        setBanner(next)
        const timer = setTimeout(() => setBanner(null), 8_000)
        return () => clearTimeout(timer)
    }, [tick])
    return banner
}

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
