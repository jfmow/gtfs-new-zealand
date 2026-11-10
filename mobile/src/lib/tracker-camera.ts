import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Dimensions } from "react-native"
import { haversineMeters } from "@transit/shared/logic/basics"
import type { JourneyProgressSnapshot } from "@transit/shared/logic/tracking"
import { lineCoordinates, type Coordinate, type Vehicle } from "@transit/shared/models"
import type { JourneyType, Leg } from "@transit/shared/types/journey"
import { boundsOf, isValidCoordinate, type Bounds, type MapCamera } from "@/components/map-types"

/**
 * Where a tracker's map points - the SwiftUI `MapCamera` enum
 * (TransitMapView.swift), as data. Screens work out the mode from the
 * journey/trip state; `useTrackerCamera` moves the map.
 */
export type TrackerCameraMode =
    /** Leave the camera alone. */
    | { kind: "none" }
    /** The whole route (before starting, once arrived). */
    | { kind: "fitAll"; points: Coordinate[] }
    /**
     * Keep a vehicle centred as it moves. `spanMeters` sets the zoom when
     * following starts; after that only the centre moves, so the rider's
     * pinch-zoom stays.
     */
    | { kind: "follow"; id: string; at: Coordinate; spanMeters: number; bearing?: number | null }
    /** `follow`, for the rider's own position. */
    | { kind: "followUser"; at: Coordinate; spanMeters: number; bearing?: number | null }
    /** Frame these points (you and the bus), never tighter than `minSpanMeters`. */
    | { kind: "frame"; points: Coordinate[]; minSpanMeters: number }

/** SwiftUI `Map3D`: tilt for framing, and the chase cam's steeper tilt. */
const FRAME_PITCH_3D = 45
const FOLLOW_PITCH_3D = 62
/** Camera moves the app makes itself can read as gestures for a moment. */
const HOLD_MS = 1_200

type Padding = { top: number; bottom: number; left: number; right: number }

const metersPerDegLat = 111_320
const metersPerDegLon = (lat: number) => metersPerDegLat * Math.max(0.01, Math.cos((lat * Math.PI) / 180))

/** A box `widthMeters` x `heightMeters` centred on `c`. */
function boxAround(c: Coordinate, widthMeters: number, heightMeters: number): Bounds {
    const dLon = widthMeters / 2 / metersPerDegLon(c.lat)
    const dLat = heightMeters / 2 / metersPerDegLat
    return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat]
}

/** Bounds around `points`, at least `minSpanMeters` each way. */
function framing(points: Coordinate[], minSpanMeters: number): Bounds | null {
    const b = boundsOf(points)
    if (!b) return null
    const mid = { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 }
    const min = boxAround(mid, minSpanMeters, minSpanMeters)
    return [Math.min(b[0], min[0]), Math.min(b[1], min[1]), Math.max(b[2], min[2]), Math.max(b[3], min[3])]
}

const inside = (b: Bounds, c: Coordinate) => c.lon >= b[0] && c.lon <= b[2] && c.lat >= b[1] && c.lat <= b[3]

function identityOf(mode: TrackerCameraMode): string | null {
    switch (mode.kind) {
        case "none": return null
        case "fitAll": return mode.points.length ? `fitAll:${mode.points.length}` : null
        case "follow": return `follow:${mode.id}`
        case "followUser": return "followUser"
        case "frame": return mode.points.length ? `frame:${mode.points.length}:${mode.minSpanMeters}` : null
    }
}

/**
 * Drives a tracker map like the SwiftUI trackers do: the camera follows the
 * mode until the rider pans or pinches, and `recentre` hands it back.
 * Recentring onto a follow keeps the zoom the rider had pinched to; a second
 * tap (no gesture since) goes back to the mode's own zoom.
 *
 * Only real changes move the map - a new mode, the followed point moving
 * more than 3 m, or a framed point leaving the visible area (or the points
 * bunching up, e.g. the bus has nearly reached you).
 */
export function useTrackerCamera(
    map: RefObject<MapCamera | null>,
    mode: TrackerCameraMode,
    { padding, threeD }: { padding: Padding; threeD: boolean },
) {
    const [following, setFollowing] = useState(true)
    const [, setResetToken] = useState(0)
    const applied = useRef<{ identity: string; at?: Coordinate; bounds?: Bounds; threeD: boolean; padKey: string } | null>(null)
    const holdUntil = useRef(0)
    const movedByUser = useRef(false)
    const keepZoom = useRef(false)
    const visible = useRef<Bounds | null>(null)
    const loaded = useRef(false)

    /** The part of the map not under the top bar or drawer, from the last reported region. */
    const unobscured = (): Bounds | null => {
        const b = visible.current
        if (!b) return null
        const { width: W, height: H } = Dimensions.get("window")
        const lonPerPt = (b[2] - b[0]) / W
        const latPerPt = (b[3] - b[1]) / H
        return [b[0] + padding.left * lonPerPt, b[1] + padding.bottom * latPerPt, b[2] - padding.right * lonPerPt, b[3] - padding.top * latPerPt]
    }

    const apply = () => {
        const m = map.current
        if (!following || !m || !loaded.current) return
        const identity = identityOf(mode)
        if (!identity) return
        const prev = applied.current
        // A new mode, 3D toggled or the clear area resized (a banner came or went) re-applies from scratch.
        const padKey = `${padding.top},${padding.bottom},${padding.left},${padding.right}`
        const resized = !!prev && prev.padKey !== padKey
        const fresh = !prev || prev.identity !== identity || prev.threeD !== threeD || resized
        const now = Date.now()
        // Back to 2D: flatten first - fitting a box keeps the tilt.
        const flatten = !!prev && prev.threeD && !threeD
        const fit = (b: Bounds, o: { padding: Padding; duration: number }) => {
            if (!flatten) return m.fitBounds(b, o)
            m.easeTo({ pitch: 0, heading: 0, duration: 300 })
            setTimeout(() => m.fitBounds(b, o), 350)
        }

        if (mode.kind === "follow" || mode.kind === "followUser") {
            const at = mode.at
            if (!isValidCoordinate(at)) return
            if (!fresh && prev?.at && haversineMeters(prev.at, at) < 3) return
            holdUntil.current = now + HOLD_MS
            const bearing = mode.bearing && mode.bearing > 0 ? mode.bearing : undefined
            if (threeD) {
                // Chase cam: behind the vehicle, looking along its bearing.
                m.easeTo({ center: [at.lon, at.lat], pitch: FOLLOW_PITCH_3D, heading: bearing, zoom: fresh && !keepZoom.current && !resized ? 16.5 : undefined, duration: 800 })
            } else {
                // Fitting a box keeps the point centred in the unobscured
                // area on every engine; its size is the mode's span to
                // start, then whatever the map shows now.
                const view = unobscured()
                const box = fresh && !keepZoom.current && !resized
                    ? boxAround(at, mode.spanMeters, mode.spanMeters)
                    : view
                        ? boxAround(at, (view[2] - view[0]) * metersPerDegLon(at.lat), (view[3] - view[1]) * metersPerDegLat)
                        : boxAround(at, mode.spanMeters, mode.spanMeters)
                fit(box, { padding, duration: 800 })
            }
            keepZoom.current = false
            applied.current = { identity, at, threeD, padKey }
            return
        }

        keepZoom.current = false
        if (mode.kind === "frame") {
            const b = framing(mode.points, mode.minSpanMeters)
            if (!b) return
            if (!fresh && prev?.bounds) {
                // Mid-flight a point can look off screen - wait for the move to settle.
                if (now < holdUntil.current) return
                const view = unobscured()
                const offScreen = view ? mode.points.some((p) => !inside(view, p)) : false
                const prevSize = Math.max(prev.bounds[2] - prev.bounds[0], prev.bounds[3] - prev.bounds[1])
                const bunched = Math.max(b[2] - b[0], b[3] - b[1]) < prevSize * 0.55
                if (!offScreen && !bunched) return
            }
            holdUntil.current = now + HOLD_MS
            fit(b, { padding: { top: padding.top + 40, bottom: padding.bottom + 40, left: padding.left + 40, right: padding.right + 40 }, duration: 800 })
            if (threeD) setTimeout(() => m.easeTo({ pitch: FRAME_PITCH_3D, duration: 400 }), 850)
            applied.current = { identity, bounds: b, threeD, padKey }
            return
        }

        // fitAll: once per identity (it changes when the route arrives).
        if (mode.kind !== "fitAll" || !fresh) return
        const b = boundsOf(mode.points)
        if (!b) return
        holdUntil.current = now + HOLD_MS
        fit(b, { padding: { top: padding.top + 30, bottom: padding.bottom + 30, left: padding.left + 30, right: padding.right + 30 }, duration: 800 })
        applied.current = { identity, bounds: b, threeD, padKey }
    }

    // Every render (a reset bumps a token to force one) - cheap when nothing changed, `apply` bails early.
    useEffect(() => { apply() })

    const onLoaded = useCallback(() => {
        loaded.current = true
        setResetToken((t) => t + 1)
    }, [])

    const onRegionDidChange = useCallback((_c: Coordinate, _z: number, bounds: Bounds, byUser: boolean) => {
        visible.current = bounds
        if (byUser && Date.now() >= holdUntil.current) {
            movedByUser.current = true
            setFollowing(false)
        }
    }, [])

    /** Hand the camera back to the mode and re-frame it. */
    const recentre = useCallback(() => {
        keepZoom.current = movedByUser.current
        movedByUser.current = false
        applied.current = null
        setFollowing(true)
        setResetToken((t) => t + 1)
    }, [])

    return { following, recentre, onRegionDidChange, onLoaded }
}

const stopAt = (s: Leg["FromStop"] | null | undefined): Coordinate | null =>
    s && isValidCoordinate({ lat: s.stop_lat, lon: s.stop_lon }) && (s.stop_lat || s.stop_lon) ? { lat: s.stop_lat, lon: s.stop_lon } : null
const valid = (c: Coordinate | null | undefined): c is Coordinate => !!c && isValidCoordinate(c) && (c.lat !== 0 || c.lon !== 0)

/**
 * Where the journey tracker's map looks at each stage - SwiftUI
 * `JourneyTrackingView.camera`:
 * - walking (to a stop, a transfer, or the destination): follow you - or,
 *   without your location, the walk's start and end
 * - waiting / boarding (including between rides): you and the vehicle
 *   you're about to catch (the stop, until it's live)
 * - on board: follow the vehicle - or, with no live position, the ride's
 *   two ends (and you)
 * - before starting, and once arrived: the whole route
 */
export function journeyCamera(plan: JourneyType | null, snap: JourneyProgressSnapshot | null, vehicle: Vehicle | undefined, rider: Coordinate | null): TrackerCameraMode {
    if (!plan) return { kind: "none" }
    const legs = plan.Legs
    const start = { lat: plan.StartLat, lon: plan.StartLon }
    const end = { lat: plan.EndLat, lon: plan.EndLon }
    if (!snap || !snap.phase || snap.journeyArrived) {
        const points = [...lineCoordinates(plan.RouteGeoJSON as never), start, end].filter(valid)
        return { kind: "fitAll", points }
    }
    const index = snap.progressLegIndex
    const leg: Leg | undefined = legs[index]
    // The ride you're on, or the next one you'll catch.
    const ride = leg?.Mode === "transit" ? leg : legs.slice(Math.max(0, index)).find((l) => l.Mode === "transit")
    const you = valid(rider) ? rider : null
    const vehicleAt = vehicle && valid(vehicle.position) ? { lat: vehicle.position.lat, lon: vehicle.position.lon } : null
    const frame = (points: (Coordinate | null)[], minSpanMeters: number): TrackerCameraMode => {
        const ok = points.filter(valid)
        return ok.length ? { kind: "frame", points: ok, minSpanMeters } : { kind: "fitAll", points: [start, end].filter(valid) }
    }

    switch (snap.phase) {
        case "onboard":
            if (vehicle && vehicleAt) return { kind: "follow", id: vehicle.trip_id, at: vehicleAt, spanMeters: 700, bearing: vehicle.position.bearing }
            return frame([stopAt(ride?.FromStop), stopAt(ride?.ToStop), you], 800)
        case "walking": {
            if (you) return { kind: "followUser", at: you, spanMeters: 350 }
            const target = leg?.Mode === "walk"
                ? stopAt(leg.ToStop) ?? (index === legs.length - 1 ? end : null)
                : stopAt(ride?.FromStop)
            const origin = stopAt(leg?.FromStop) ?? (index > 0 ? stopAt(legs[index - 1]?.ToStop) : null) ?? start
            return frame([origin, target], 300)
        }
        default: {
            // Waiting / boarding: you (or the stop) and the vehicle coming;
            // until it's live, you and the stop.
            const stop = stopAt(ride?.FromStop)
            return frame([you ?? stop, vehicleAt ?? (you ? stop : null)], 400)
        }
    }
}
