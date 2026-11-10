import { AlarmClock, ArrowLeftRight, ArrowRight, ChevronRight, Clock, Flag, Footprints, Rss, TriangleAlert, WifiOff } from "@/components/icons"
import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { formatDistance, formatDuration } from "@transit/shared/logic/basics"
import { laClock } from "@transit/shared/logic/journey-live"
import { goTime, lineCoordinates, type Coordinate } from "@transit/shared/models"
import type { ReliabilityConnection } from "@transit/shared/reliability"
import type { JourneyType, Leg } from "@transit/shared/types/journey"
import { radius, spacing, type, useColors } from "@/theme"
import { TransitMap, boundsOf, type MapMarker } from "./transit-map"
import { ModeIcon, RouteBadge, hexColor, textOn } from "./ui"

export const legDate = (d: unknown) => goTime(d as Date | string | null)

/** bus / train / ferry, from the route's vehicle type (or GTFS route type) - iOS `JourneyLeg.modeName`. */
export function legModeName(leg: Leg): "bus" | "train" | "ferry" {
    const t = leg.Route?.vehicle_type?.toLowerCase() ?? ""
    if (t.includes("train") || t.includes("rail") || leg.Route?.route_type === 2) return "train"
    if (t.includes("ferry") || leg.Route?.route_type === 4) return "ferry"
    return "bus"
}

export const legRouteName = (leg: Leg) => leg.Route?.route_short_name || leg.RouteID
const legMinutes = (leg: Leg) => Math.max(1, Math.round(leg.Duration / 6e10))
const legHex = (leg: Leg) => hexColor(leg.Route?.route_color, "#525252")

/** The first ride has already gone (walk-only journeys never "leave"). */
export function hasLeft(plan: JourneyType, now = Date.now()) {
    const ride = plan.Legs.find((l) => l.Mode === "transit")
    const d = ride ? legDate(ride.DepartureTime) : null
    return !!d && d.getTime() < now
}

export const isDisrupted = (plan: JourneyType) => plan.Legs.some((l) => l.Mode === "transit" && !l.trip_usable)

/** "26 min, 1 transfer, $3". */
export function summaryLine(plan: JourneyType, fare?: string | null) {
    const parts = [formatDuration(plan.TotalDuration), plan.Transfers === 0 ? "direct" : `${plan.Transfers} transfer${plan.Transfers === 1 ? "" : "s"}`]
    if (fare) parts.push(fare)
    return parts.join(", ")
}

type ChainItem = { kind: "walk"; minutes: number; i: number } | { kind: "ride"; leg: Leg; i: number } | { kind: "transfer"; wait: number | null; i: number }

/** A journey at a glance: walk › ride › transfer › ride - iOS `LegChain`. */
export function LegChain({ legs }: { legs: Leg[] }) {
    const colors = useColors()
    const items: ChainItem[] = []
    let lastArrival: number | null = null
    legs.forEach((leg, i) => {
        if (leg.Mode === "walk") {
            items.push({ kind: "walk", minutes: legMinutes(leg), i })
            return
        }
        if (lastArrival !== null) {
            let walkMs = 0
            for (let j = i - 1; j >= 0 && legs[j].Mode === "walk"; j--) walkMs += legs[j].Duration / 1e6
            const dep = legDate(leg.DepartureTime)
            items.push({ kind: "transfer", wait: dep ? Math.max(0, Math.floor((dep.getTime() - lastArrival - walkMs) / 60_000)) : null, i })
        }
        items.push({ kind: "ride", leg, i })
        lastArrival = legDate(leg.ArrivalTime)?.getTime() ?? null
    })
    const a11y = items.map((it) => (it.kind === "walk" ? `walk ${it.minutes} minutes` : it.kind === "ride" ? `${legModeName(it.leg)} ${legRouteName(it.leg)}` : it.wait !== null ? `transfer, ${it.wait} minute wait` : "transfer")).join(", ")
    return (
        <View style={styles.chain} accessible accessibilityLabel={a11y}>
            {items.map((it, n) => (
                <View key={`${it.kind}-${it.i}`} style={styles.chainItem}>
                    {it.kind === "walk" ? (
                        <View style={styles.inline}>
                            <Footprints size={13} color={colors.mutedForeground} />
                            <Text style={[type.meta, { fontSize: 13, color: colors.mutedForeground }]}>{it.minutes}</Text>
                        </View>
                    ) : it.kind === "ride" ? (
                        <View style={styles.inline}>
                            <ModeIcon mode={legModeName(it.leg)} size={13} color={colors.foreground} />
                            <View style={{ opacity: it.leg.trip_usable ? 1 : 0.45 }}>
                                <RouteBadge name={legRouteName(it.leg)} color={it.leg.Route?.route_color} />
                                {it.leg.realtime_status === "delayed" || it.leg.realtime_status === "early" ? (
                                    <View style={[styles.delayDot, { backgroundColor: it.leg.realtime_status === "delayed" ? colors.warning : colors.success, borderColor: colors.card }]} />
                                ) : null}
                            </View>
                        </View>
                    ) : (
                        <View style={[styles.transfer, { backgroundColor: colors.muted }]}>
                            <ArrowLeftRight size={11} color={colors.mutedForeground} />
                            {it.wait ? <Text style={[type.metaMedium, { fontSize: 12, color: colors.mutedForeground }]}>{it.wait}m</Text> : null}
                        </View>
                    )}
                    {n < items.length - 1 ? <ChevronRight size={10} color={colors.mutedForeground} style={{ marginLeft: 3 }} /> : null}
                </View>
            ))}
        </View>
    )
}

export function Badge({ text, variant = "secondary" }: { text: string; variant?: "default" | "secondary" | "outline" }) {
    const colors = useColors()
    const bg = variant === "default" ? colors.primary : variant === "secondary" ? colors.muted : "transparent"
    const fg = variant === "default" ? colors.primaryForeground : colors.foreground
    return (
        <View style={[styles.badge, { backgroundColor: bg, borderColor: colors.border, borderWidth: variant === "outline" ? 1 : 0 }]}>
            <Text style={[type.metaMedium, { fontSize: 12, color: fg }]}>{text}</Text>
        </View>
    )
}

/** One planner result - iOS `JourneyResultCard`. */
export function PlanCard({ plan, tz, fare, missed, onRemind, onPress }: { plan: JourneyType; tz: string; fare?: string | null; missed?: boolean; onRemind?: () => void; onPress: () => void }) {
    const colors = useColors()
    const dep = legDate(plan.DepartureTime)
    const arr = legDate(plan.ArrivalTime)
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${formatDuration(plan.TotalDuration)}, leave ${dep ? laClock(dep, tz) : ""}, arrive ${arr ? laClock(arr, tz) : ""}, ${plan.Transfers === 0 ? "direct" : `${plan.Transfers} transfers`}${fare ? `, fare ${fare}` : ""}`}
            onPress={onPress}
            style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: missed ? 0.55 : pressed ? 0.8 : 1 }]}
        >
            {isDisrupted(plan) ? (
                <View style={[styles.disruption, { backgroundColor: colors.danger + "1a" }]}>
                    <TriangleAlert size={13} color={colors.danger} />
                    <Text style={[type.metaMedium, { fontSize: 12, color: colors.danger }]}>Service disruption on this route</Text>
                </View>
            ) : null}
            <View style={{ padding: 14, gap: 10 }}>
                <View style={styles.cardHead}>
                    <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[type.number, { fontSize: 19, color: colors.foreground }]}>{formatDuration(plan.TotalDuration)}</Text>
                        {dep && arr ? (
                            <View style={styles.inline}>
                                <Text style={[type.meta, { color: colors.mutedForeground }]}>{laClock(dep, tz)}</Text>
                                <ArrowRight size={10} color={colors.mutedForeground} />
                                <Text style={[type.meta, { color: colors.mutedForeground }]}>{laClock(arr, tz)}</Text>
                                {fare ? <Text style={[type.metaMedium, { color: colors.foreground, marginLeft: 4 }]}>{fare}</Text> : null}
                            </View>
                        ) : null}
                    </View>
                    {missed ? <Badge text="Left" variant="outline" /> : null}
                    <Badge text={plan.Transfers === 0 ? "Direct" : `${plan.Transfers} transfer${plan.Transfers === 1 ? "" : "s"}`} variant={plan.Transfers === 0 ? "default" : "secondary"} />
                    {onRemind ? (
                        <Pressable accessibilityRole="button" accessibilityLabel="Remind me when to leave for this journey" hitSlop={8} onPress={onRemind} style={styles.remind}>
                            <AlarmClock size={16} color={colors.mutedForeground} />
                        </Pressable>
                    ) : null}
                </View>
                <LegChain legs={plan.Legs} />
            </View>
        </Pressable>
    )
}

/** The trip as a labelled bar, each piece as wide as its share of the time - iOS `JourneyLegBar`. */
export function JourneyLegBar({ plan, currentIndex, progress }: { plan: JourneyType; currentIndex?: number; progress?: number | null }) {
    const colors = useColors()
    const legs = plan.Legs
    const start = legDate(plan.DepartureTime)?.getTime() ?? 0
    const end = legDate(plan.ArrivalTime)?.getTime() ?? start
    const shares = legs.map((l, i) => {
        const from = legDate(l.DepartureTime)?.getTime() ?? start
        const to = i + 1 < legs.length ? legDate(legs[i + 1].DepartureTime)?.getTime() ?? end : end
        return Math.max(to - from, 1000)
    })
    return (
        <View accessible accessibilityLabel={"Your trip: " + legs.map((l) => (l.Mode === "walk" ? "walk" : `the ${legRouteName(l)}`)).join(", then ")}>
            {progress != null ? (
                <View style={{ height: 11 }}>
                    <View style={[styles.youAreHere, { left: `${Math.max(0, Math.min(97, progress * 100))}%`, borderTopColor: colors.live }]} />
                </View>
            ) : null}
            <View style={styles.bar}>
                {legs.map((leg, i) => {
                    const done = currentIndex !== undefined && i < currentIndex
                    const minutes = Math.max(1, Math.round(((legDate(leg.ArrivalTime)?.getTime() ?? 0) - (legDate(leg.DepartureTime)?.getTime() ?? 0)) / 60_000))
                    const hex = legHex(leg)
                    return (
                        <View key={i} style={[styles.piece, { flexGrow: shares[i], minWidth: leg.Mode === "walk" ? 40 : 48, backgroundColor: leg.Mode === "walk" ? colors.muted : hex, opacity: done ? 0.4 : 1 }, currentIndex === i && { borderWidth: 2, borderColor: colors.live }]}>
                            {leg.Mode === "walk" ? (
                                <>
                                    <Footprints size={12} color={colors.foreground} />
                                    <Text style={[type.metaMedium, { fontSize: 12, color: colors.foreground }]}>{minutes}</Text>
                                </>
                            ) : (
                                <Text style={[type.badge, { fontSize: 12, color: textOn(hex) }]} numberOfLines={1}>{legRouteName(leg)}</Text>
                            )}
                        </View>
                    )
                })}
            </View>
        </View>
    )
}

// ---------------------------------------------------------------------------
// Timeline - iOS `JourneyTimeline` / `TrackedLegRow` / `TimelineRow`

type Rail = { kind: "solid"; color: string; dim?: boolean } | { kind: "dotted"; color: string } | null
type MarkerKind = { kind: "start" } | { kind: "destination" } | { kind: "walk"; color: string } | { kind: "route"; name: string; color: string } | { kind: "stop"; color: string } | null
export type LegStatus = "done" | "current" | "upcoming"

function RailPiece({ rail }: { rail: Rail }) {
    if (!rail) return <View style={{ flex: 1 }} />
    if (rail.kind === "solid") return <View style={{ flex: 1, width: 4, backgroundColor: rail.color, opacity: rail.dim ? 0.35 : 1 }} />
    return (
        <View style={{ flex: 1, width: 4, overflow: "hidden" }}>
            {/* Absolute so the dots never give the row height of their own. */}
            <View style={{ position: "absolute", top: 2, left: 0, gap: 4 }}>
                {Array.from({ length: 30 }).map((_, i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: rail.color }} />)}
            </View>
        </View>
    )
}

function TimelineMarker({ marker }: { marker: MarkerKind }) {
    const colors = useColors()
    if (!marker) return null
    switch (marker.kind) {
        case "start":
            return <View style={[styles.mStart, { borderColor: colors.foreground, backgroundColor: colors.card }]} />
        case "destination":
            return <View style={[styles.mDest, { backgroundColor: colors.foreground }]}><Flag size={11} color={colors.background} fill={colors.background} /></View>
        case "walk":
            return <View style={[styles.mWalk, { backgroundColor: colors.card, borderColor: marker.color }]}><Footprints size={13} color={marker.color} /></View>
        case "route":
            return <View style={[styles.mRoute, { backgroundColor: marker.color }]}><Text style={[type.badge, { fontSize: 11, color: textOn(marker.color) }]} numberOfLines={1}>{marker.name}</Text></View>
        case "stop":
            return <View style={[styles.mStop, { borderColor: marker.color, backgroundColor: colors.card }]} />
    }
}

function TimelineRow({ time, above, below, marker, highlighted, tz, children }: { time: Date | null; above: Rail; below: Rail; marker: MarkerKind; highlighted?: boolean; tz: string; children: ReactNode }) {
    const colors = useColors()
    return (
        <View style={[styles.tRow, highlighted && { backgroundColor: colors.live + "12" }]}>
            <Text style={[type.metaMedium, styles.tTime, { color: colors.foreground }]}>{time ? laClock(time, tz) : ""}</Text>
            <View style={styles.tRail}>
                <RailPiece rail={above} />
                <RailPiece rail={below} />
                <View style={styles.tMarker}><TimelineMarker marker={marker} /></View>
            </View>
            <View style={{ flex: 1, justifyContent: "center" }}>{children}</View>
        </View>
    )
}

export function JourneyTimeline({ legs, tz, destinationName, startName, status = () => "upcoming", tracked, odds }: {
    legs: Leg[]
    tz: string
    destinationName: string
    startName?: string | null
    status?: (i: number) => LegStatus
    /** Whether leg i's vehicle is reporting right now; undefined falls back to the plan's answer. */
    tracked?: (i: number) => boolean | undefined
    odds?: Map<number, ReliabilityConnection>
}) {
    const colors = useColors()
    const walkRail: Rail = { kind: "dotted", color: colors.mutedForeground + "80" }
    const rows: ReactNode[] = []
    let prev: Rail = null
    const push = (key: string, time: Date | null, below: Rail, marker: MarkerKind, highlighted: boolean, body: ReactNode, dim = false) => {
        rows.push(
            <View key={key} style={dim ? { opacity: 0.45 } : undefined}>
                <TimelineRow time={time} above={prev} below={below} marker={marker} highlighted={highlighted} tz={tz}>{body}</TimelineRow>
            </View>,
        )
        prev = below
    }
    const isTransferBefore = (i: number) => i < legs.length && legs[i].Mode === "transit" && legs.slice(0, i).some((l) => l.Mode === "transit")

    if (startName && legs[0]) {
        push("start", legDate(legs[0].DepartureTime), walkRail, { kind: "start" }, false, <Text style={[type.bodyMedium, styles.tText, { color: colors.foreground }]} numberOfLines={3}>Leave from {startName}</Text>)
    }
    legs.forEach((leg, i) => {
        const st = status(i)
        const current = st === "current"
        const done = st === "done"
        if (leg.Mode === "walk") {
            const to = leg.ToStop?.stop_name ?? (i === legs.length - 1 ? destinationName : "your destination")
            push(`walk-${i}`, legDate(leg.DepartureTime), walkRail, { kind: "walk", color: current ? colors.live : colors.mutedForeground }, current, (
                <View style={styles.tText}>
                    <Text style={[current ? type.bodyMedium : type.body, { color: colors.foreground }]}>Walk to {to}</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{legMinutes(leg)} min{leg.DistanceKm > 0 ? ` · ${formatDistance(leg.DistanceKm * 1000)}` : ""}</Text>
                </View>
            ), done)
        } else {
            const hex = legHex(leg)
            const solid: Rail = { kind: "solid", color: hex, dim: done }
            const isTracked = tracked?.(i) ?? leg.vehicle_tracked
            const showTracking = isTracked !== undefined && !done && leg.trip_usable
            const conn = odds?.get(i)
            push(`board-${i}`, legDate(leg.DepartureTime), solid, { kind: "route", name: legRouteName(leg), color: hex }, current, (
                <View style={[styles.tText, { gap: 4 }]}>
                    <View style={styles.inline}>
                        <Text style={[current ? type.bodyMedium : type.body, { color: colors.foreground, flexShrink: 1 }]}>{leg.FromStop?.stop_name ?? "Board"}</Text>
                        {leg.FromStop?.platform_number ? <Badge text={`Plat. ${leg.FromStop.platform_number}`} variant="outline" /> : null}
                    </View>
                    <View style={styles.inline}>
                        <Text style={[type.meta, { color: colors.mutedForeground }]}>Ride {legMinutes(leg)} min</Text>
                        {showTracking ? (isTracked ? <Rss size={13} color={colors.success} accessibilityLabel="Live tracking" /> : <WifiOff size={13} color={colors.danger} accessibilityLabel="No live tracking" />) : null}
                    </View>
                    {!leg.trip_usable ? (
                        <View style={styles.inline}><TriangleAlert size={13} color={colors.danger} /><Text style={[type.metaMedium, { color: colors.danger }]}>Not running - check alternative routes</Text></View>
                    ) : leg.delay_seconds && Math.abs(leg.delay_seconds) >= 60 ? (
                        <Text style={[type.metaMedium, { color: leg.delay_seconds > 0 ? colors.warning : colors.success }]}>
                            {leg.delay_seconds > 0 ? `${Math.floor(leg.delay_seconds / 60)} min late` : `${Math.floor(-leg.delay_seconds / 60)} min early`}
                        </Text>
                    ) : null}
                    {conn && leg.trip_usable && !done ? (
                        <Text style={[type.meta, { color: colors.mutedForeground }]}>
                            <Text style={{ fontFamily: "Geist-Medium", color: conn.level === "good" ? colors.success : conn.level === "poor" ? colors.danger : colors.warning }}>Change: {conn.summary.toLowerCase()}</Text> from how both usually run
                        </Text>
                    ) : null}
                </View>
            ), done)
            push(`alight-${i}`, legDate(leg.ArrivalTime), walkRail, { kind: "stop", color: hex }, current, (
                <View style={[styles.inline, styles.tText]}>
                    <Text style={[type.body, { color: colors.foreground, flexShrink: 1 }]}>Get off at {leg.ToStop?.stop_name ?? "your stop"}</Text>
                    {leg.ToStop?.platform_number ? <Badge text={`Plat. ${leg.ToStop.platform_number}`} variant="outline" /> : null}
                </View>
            ), done)
        }
        if (i < legs.length - 1) {
            const end = legDate(leg.ArrivalTime)?.getTime()
            const next = legDate(legs[i + 1].DepartureTime)?.getTime()
            const wait = end && next ? Math.max(0, Math.round((next - end) / 60_000)) : 0
            const transfer = isTransferBefore(i + 1)
            if (wait >= 1 || transfer) {
                const Icon = transfer ? ArrowLeftRight : Clock
                push(`wait-${i}`, null, walkRail, null, false, (
                    <View style={[styles.inline, { paddingVertical: 6 }]}>
                        <Icon size={12} color={colors.mutedForeground} />
                        <Text style={[type.meta, { fontSize: 12, color: colors.mutedForeground }]}>{transfer ? (wait >= 1 ? `Transfer · ${wait} min wait` : "Transfer") : `${wait} min wait`}</Text>
                    </View>
                ), status(i + 1) === "done")
            }
        }
    })
    const last = legs[legs.length - 1]
    if (last) {
        push("arrive", legDate(last.ArrivalTime), null, { kind: "destination" }, false, <Text style={[type.bodyMedium, { color: colors.foreground, paddingVertical: 12 }]}>Arrive at {destinationName}</Text>)
    }
    return <View style={[styles.timeline, { backgroundColor: colors.card, borderColor: colors.border }]}>{rows}</View>
}

// ---------------------------------------------------------------------------
// Map - iOS `TransitMapView(waypoints:polylines:)` for a plan

/** Each ride in its own route colour, walks as grey dots - iOS `JourneyDetailView.polylines`. */
export interface JourneyLine { id: string; walk: boolean; color: string; coords: Coordinate[]; muted?: boolean }

/** A greyed-out part of the vehicle's route (iOS: 60% `9CA3AF`, one point thinner). */
const MUTED_ROUTE = "#9CA3AF99"

/**
 * Each ride in its own route colour, walks in grey. Pass `ride` (the trip
 * you're on or about to catch, with its full route shape) and that ride is
 * drawn from the vehicle's whole route instead, the parts before you board
 * and after you get off greyed out - iOS `JourneyTrackingView.polylines`.
 * Greyed parts come first so they sit under the coloured lines.
 */
export function journeyLines(plan: JourneyType, fallback: string, ride?: { tripId: string; shape: Coordinate[] } | null): JourneyLine[] {
    const features = plan.RouteGeoJSON?.features ?? []
    const rides = plan.Legs.filter((l) => l.Mode === "transit")
    let n = 0
    const lines = features.flatMap((f, i): JourneyLine[] => {
        const props = (f.properties ?? {}) as unknown as Record<string, unknown>
        const walk = (props.mode ?? "walk") === "walk"
        if (walk) return [{ id: `leg-${i}`, walk, color: "#9CA3AF", coords: lineCoordinates(f as never) }]
        const leg = rides[n++]
        const color = hexColor(leg?.Route?.route_color, fallback)
        if (leg && ride && leg.TripID === ride.tripId && leg.FromStop && leg.ToStop) {
            const split = splitRide(`leg-${i}`, ride.shape, { lat: leg.FromStop.stop_lat, lon: leg.FromStop.stop_lon }, { lat: leg.ToStop.stop_lat, lon: leg.ToStop.stop_lon }, color)
            if (split.length) return split
        }
        return [{ id: `leg-${i}`, walk, color, coords: lineCoordinates(f as never) }]
    })
    return [...lines.filter((l) => l.muted), ...lines.filter((l) => !l.muted)]
}

/** iOS `RoutePolylineData.splitRide`: the shape cut at the stops nearest where you get on and off. */
function splitRide(id: string, shape: Coordinate[], board: Coordinate, alight: Coordinate, color: string): JourneyLine[] {
    if (shape.length < 2) return []
    const nearest = (p: Coordinate) => {
        let best = 0, bestD = Infinity
        shape.forEach((c, i) => {
            const d = (c.lat - p.lat) ** 2 + (c.lon - p.lon) ** 2
            if (d < bestD) { best = i; bestD = d }
        })
        return best
    }
    let a = nearest(board), b = nearest(alight)
    if (a > b) [a, b] = [b, a]
    const out: JourneyLine[] = []
    if (a > 0) out.push({ id: `${id}-before`, walk: false, color: MUTED_ROUTE, coords: shape.slice(0, a + 1), muted: true })
    if (b < shape.length - 1) out.push({ id: `${id}-after`, walk: false, color: MUTED_ROUTE, coords: shape.slice(b), muted: true })
    if (b > a) out.push({ id: `${id}-ride`, walk: false, color, coords: shape.slice(a, b + 1) })
    return out
}

export function JourneyMap({ plan, interactive = true, padding, showUser }: { plan: JourneyType; interactive?: boolean; padding?: { top?: number; bottom?: number; left?: number; right?: number }; showUser?: boolean }) {
    const colors = useColors()
    const lines = journeyLines(plan, colors.live)
    const stopCoord = (s: Leg["FromStop"]): Coordinate | null => (s ? { lat: s.stop_lat, lon: s.stop_lon } : null)
    const start: Coordinate | null = plan.StartLat || plan.StartLon ? { lat: plan.StartLat, lon: plan.StartLon } : stopCoord(plan.Legs[0]?.FromStop ?? null)
    const end: Coordinate | null = plan.EndLat || plan.EndLon ? { lat: plan.EndLat, lon: plan.EndLon } : stopCoord(plan.Legs[plan.Legs.length - 1]?.ToStop ?? null)
    const all = [...lines.flatMap((l) => l.coords), ...(start ? [start] : []), ...(end ? [end] : [])]
    const bounds = boundsOf(all)
    const center = start ?? all[0] ?? { lat: -36.85, lon: 174.76 }
    const pad = { top: 40, bottom: 40, left: 40, right: 40, ...padding }
    const markers: MapMarker[] = []
    plan.Legs.forEach((leg, i) => {
        if (leg.Mode !== "transit") return
        const hex = hexColor(leg.Route?.route_color, colors.live)
        if (leg.FromStop) markers.push({ id: `board-${i}`, coordinate: { lat: leg.FromStop.stop_lat, lon: leg.FromStop.stop_lon }, zIndex: 2, view: { type: "badge", text: legRouteName(leg), color: hex }, accessibilityLabel: `Get on the ${legRouteName(leg)} at ${leg.FromStop.stop_name}` })
        if (leg.ToStop) markers.push({ id: `alight-${i}`, coordinate: { lat: leg.ToStop.stop_lat, lon: leg.ToStop.stop_lon }, view: { type: "dot", size: 16, fill: colors.card, stroke: hex, strokeWidth: 4 }, accessibilityLabel: `Get off at ${leg.ToStop.stop_name}` })
    })
    if (start) markers.push({ id: "start", coordinate: start, zIndex: 3, view: { type: "dot", size: 18, fill: colors.success, stroke: "#fff", strokeWidth: 3 }, accessibilityLabel: "Start" })
    if (end) markers.push({ id: "end", coordinate: end, anchor: "bottom", zIndex: 3, view: { type: "pin", color: colors.danger }, accessibilityLabel: "End" })
    return (
        <TransitMap
            center={center}
            bounds={bounds}
            interactive={interactive}
            showUser={showUser ?? interactive}
            padding={pad}
            lines={lines.map((l) => ({ id: l.id, coords: l.coords, color: l.color, dashed: l.walk }))}
            markers={markers}
        />
    )
}

const styles = StyleSheet.create({
    chain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 6 },
    chainItem: { flexDirection: "row", alignItems: "center", marginRight: 3 },
    inline: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
    delayDot: { position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
    transfer: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 10 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
    disruption: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5 },
    cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    remind: { width: 30, height: 26, alignItems: "center", justifyContent: "center" },
    bar: { flexDirection: "row", gap: 3, height: 26 },
    piece: { flexBasis: 0, borderRadius: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 4 },
    youAreHere: { position: "absolute", top: 0, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8, borderLeftColor: "transparent", borderRightColor: "transparent" },
    timeline: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: "hidden" },
    tRow: { flexDirection: "row", alignItems: "stretch", paddingRight: spacing.md, minHeight: 44 },
    tTime: { width: 70, textAlign: "right", paddingTop: 12, fontSize: 13 },
    tRail: { width: 44, alignItems: "center" },
    tMarker: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
    tText: { paddingVertical: 10 },
    mStart: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
    mDest: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    mWalk: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    mRoute: { minWidth: 30, height: 22, borderRadius: 6, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
    mStop: { width: 14, height: 14, borderRadius: 7, borderWidth: 3.5 },
})
