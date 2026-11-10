import type { Map as MKMap, MapKit } from "@apple/mapkit-loader"
import { fitPoints, project, setView, type Insets, type LatLng } from "./geo"
import type { JourneyType, Leg } from "@/components/journey/types"
import type { VehiclesResponse } from "@/components/services/tracker"
import { toFeatureArray } from "@/components/journey/tracked-line"

/**
 * Where a tracker's map points - a port of the app's tracker-camera.ts (itself
 * the SwiftUI `MapCamera`). Screens work out the mode from the journey state;
 * `TrackerCamera` moves a MapKit JS map to match, until the rider pans.
 */
export type TrackerCameraMode =
    /** Leave the camera alone. */
    | { kind: "none" }
    /** The whole route (once arrived). */
    | { kind: "fitAll"; points: LatLng[] }
    /** Keep a vehicle centred; `spanMeters` sets the zoom when following starts, after that only the centre moves. */
    | { kind: "follow"; id: string; at: LatLng; spanMeters: number }
    /** `follow`, for the rider's own position. */
    | { kind: "followUser"; at: LatLng; spanMeters: number }
    /** Frame these points (you and the bus), never tighter than `minSpanMeters`. */
    | { kind: "frame"; points: LatLng[]; minSpanMeters: number }

/** Camera moves the app makes itself can read as gestures for a moment. */
const HOLD_MS = 1_200
const M_PER_DEG_LAT = 111_320
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180))

function haversine(a: LatLng, b: LatLng): number {
    const r = Math.PI / 180
    const dLat = (b[0] - a[0]) * r
    const dLon = (b[1] - a[1]) * r
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** The two corners of a box `w` x `h` metres centred on `c`. */
function boxAround(c: LatLng, w: number, h: number): LatLng[] {
    const dLon = w / 2 / mPerDegLon(c[0])
    const dLat = h / 2 / M_PER_DEG_LAT
    return [[c[0] - dLat, c[1] - dLon], [c[0] + dLat, c[1] + dLon]]
}

/** `points`, plus a box so the framing is at least `minSpan` metres each way. */
function framing(points: LatLng[], minSpan: number): LatLng[] {
    const lats = points.map((p) => p[0])
    const lons = points.map((p) => p[1])
    const mid: LatLng = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]
    return [...points, ...boxAround(mid, minSpan, minSpan)]
}

/** Largest side of the points' bounds, in degrees - to notice them bunching up. */
function extent(points: LatLng[]): number {
    const lats = points.map((p) => p[0])
    const lons = points.map((p) => p[1])
    return Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
}

/** Is `p` inside the clear part of the map (MapKit's visible rect is already inside `map.padding`)? */
function inView(map: MKMap, p: LatLng): boolean {
    const r = map.visibleMapRect
    const { x, y } = project(p)
    return x >= r.origin.x && x <= r.origin.x + r.size.width && y >= r.origin.y && y <= r.origin.y + r.size.height
}

function identityOf(mode: TrackerCameraMode): string | null {
    switch (mode.kind) {
        case "none": return null
        case "fitAll": return mode.points.length ? `fitAll:${mode.points.length}` : null
        case "follow": return `follow:${mode.id}`
        case "followUser": return "followUser"
        case "frame": return mode.points.length ? `frame:${mode.points.length}:${mode.minSpanMeters}` : null
    }
}

const pad = (n: number): Insets => ({ top: n, right: n, bottom: n, left: n })

/**
 * The camera state machine for one map: `apply` moves the map only on real
 * changes - a new mode, the followed point moving more than 3 m, a framed
 * point leaving the clear area, or the framed points bunching up (the bus has
 * nearly reached you). Following starts at the mode's own zoom; after a
 * re-centre it keeps the zoom the rider had pinched to.
 */
export class TrackerCamera {
    private applied: { identity: string; at?: LatLng; extent?: number; padKey: string } | null = null
    private holdUntil = 0
    private keepZoom = false
    private movedByUser = false

    /** A gesture of the rider's - ignored while the app's own move settles. Returns whether it counts. */
    userMoved(): boolean {
        if (Date.now() < this.holdUntil) return false
        this.movedByUser = true
        return true
    }

    /** Hand the camera back to the mode: keep the rider's zoom if they'd changed it. */
    reset() {
        this.keepZoom = this.movedByUser
        this.movedByUser = false
        this.applied = null
    }

    apply(mk: MapKit, map: MKMap, mode: TrackerCameraMode) {
        const identity = identityOf(mode)
        if (!identity) return
        const p = map.padding
        const padKey = `${p.top},${p.right},${p.bottom},${p.left}`
        const prev = this.applied
        // A new mode, or the clear area resized (the drawer moved), re-applies.
        const resized = !!prev && prev.padKey !== padKey
        const fresh = !prev || prev.identity !== identity || resized
        const now = Date.now()

        if (mode.kind === "follow" || mode.kind === "followUser") {
            const at = mode.at
            if (!fresh && prev?.at && haversine(prev.at, at) < 3) return
            this.holdUntil = now + HOLD_MS
            if (fresh && !this.keepZoom && !resized) fitPoints(mk, map, boxAround(at, mode.spanMeters, mode.spanMeters), pad(0), { maxZoom: 18 })
            else setView(mk, map, at)
            this.keepZoom = false
            this.applied = { identity, at, padKey }
            return
        }

        this.keepZoom = false
        if (mode.kind === "frame") {
            const size = extent(mode.points)
            if (!fresh && prev?.extent !== undefined) {
                // Mid-flight a point can look off screen - wait for the move to settle.
                if (now < this.holdUntil) return
                const offScreen = mode.points.some((pt) => !inView(map, pt))
                const bunched = size < prev.extent * 0.55 && prev.extent > 0.003
                if (!offScreen && !bunched) return
            }
            this.holdUntil = now + HOLD_MS
            fitPoints(mk, map, framing(mode.points, mode.minSpanMeters), pad(40), { maxZoom: 17 })
            this.applied = { identity, extent: size, padKey }
            return
        }

        // fitAll: once per identity (it changes when the route arrives).
        if (mode.kind !== "fitAll" || !fresh) return
        this.holdUntil = now + HOLD_MS
        fitPoints(mk, map, mode.points, pad(30), { maxZoom: 16 })
        this.applied = { identity, padKey }
    }
}

// ─── The journey tracker's camera ─────────────────────────────────────────────

const valid = (c: LatLng | null | undefined): c is LatLng =>
    !!c && Number.isFinite(c[0]) && Number.isFinite(c[1]) && (c[0] !== 0 || c[1] !== 0)
const stopAt = (s: Leg["FromStop"] | null | undefined): LatLng | null => (s ? [s.stop_lat, s.stop_lon] : null)

function routeLinePoints(plan: JourneyType): LatLng[] {
    const out: LatLng[] = []
    for (const f of toFeatureArray(plan.RouteGeoJSON) as { geometry?: { type?: string; coordinates?: unknown } }[]) {
        const g = f?.geometry
        const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? (g.coordinates as unknown[]) : []
        for (const line of lines as [number, number][][]) for (const [lon, lat] of line ?? []) out.push([lat, lon])
    }
    // Plenty to frame a route; keeps the identity cheap.
    const step = Math.max(1, Math.floor(out.length / 200))
    return out.filter((_, i) => i % step === 0)
}

export type JourneyPhase = "walking" | "waiting" | "boarding" | "onboard"

/**
 * Where the journey tracker's map looks at each stage - the app's
 * `journeyCamera` (SwiftUI `JourneyTrackingView.camera`):
 * - walking: follow you (350 m) - or, without your location, the walk's two ends
 * - waiting / boarding: you (or the stop) and the vehicle you're about to catch
 * - on board: follow the vehicle (700 m) - or, with no live position, the ride's two ends
 * - before starting, and once arrived: the whole route
 */
export function journeyCamera({ plan, started, arrived, legIndex, phase, vehicle, rider }: {
    plan: JourneyType | null | undefined
    started: boolean
    arrived: boolean
    legIndex: number
    phase: JourneyPhase | undefined
    vehicle: VehiclesResponse | undefined
    rider: LatLng | null
}): TrackerCameraMode {
    if (!plan) return { kind: "none" }
    const legs = plan.Legs
    const start: LatLng = [plan.StartLat, plan.StartLon]
    const end: LatLng = [plan.EndLat, plan.EndLon]
    if (!started || !phase || arrived) {
        return { kind: "fitAll", points: [...routeLinePoints(plan), start, end].filter(valid) }
    }
    const leg = legs[legIndex] as Leg | undefined
    // The ride you're on, or the next one you'll catch.
    const ride = leg?.Mode === "transit" ? leg : legs.slice(Math.max(0, legIndex)).find((l) => l.Mode === "transit")
    const you = valid(rider) ? rider : null
    const vehicleAt: LatLng | null = vehicle && valid([vehicle.position.lat, vehicle.position.lon]) ? [vehicle.position.lat, vehicle.position.lon] : null
    const frame = (points: (LatLng | null)[], minSpanMeters: number): TrackerCameraMode => {
        const ok = points.filter(valid)
        return ok.length ? { kind: "frame", points: ok, minSpanMeters } : { kind: "fitAll", points: [start, end].filter(valid) }
    }

    switch (phase) {
        case "onboard":
            if (vehicle && vehicleAt) return { kind: "follow", id: vehicle.trip_id, at: vehicleAt, spanMeters: 700 }
            return frame([stopAt(ride?.FromStop), stopAt(ride?.ToStop), you], 800)
        case "walking": {
            if (you) return { kind: "followUser", at: you, spanMeters: 350 }
            const target = leg?.Mode === "walk"
                ? stopAt(leg.ToStop) ?? (legIndex === legs.length - 1 ? end : null)
                : stopAt(ride?.FromStop)
            const origin = stopAt(leg?.FromStop) ?? (legIndex > 0 ? stopAt(legs[legIndex - 1]?.ToStop) : null) ?? start
            return frame([origin, target], 300)
        }
        default: {
            // Waiting / boarding: you (or the stop) and the vehicle coming; until it's live, you and the stop.
            const stop = stopAt(ride?.FromStop)
            return frame([you ?? stop, vehicleAt ?? (you ? stop : null)], 400)
        }
    }
}
