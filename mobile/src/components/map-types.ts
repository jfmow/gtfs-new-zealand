import type { Coordinate } from "@transit/shared/models"

/**
 * The map, described as data so any engine can draw it: Apple MapKit on iOS
 * (`transit-map.ios.tsx`), and on Android MapKit JS or MapLibre
 * (`transit-map.tsx`). Screens never touch an engine directly.
 */

/** Stop colours by mode - the same as the web's `markers/icons.ts`. */
export const MODE_COLORS = { train: "#0073bd", ferry: "#2a286b", bus: "#64748b" } as const

export type Bounds = [west: number, south: number, east: number, north: number]

/** What a marker looks like - each engine has a drawing for every kind. */
export type MarkerView =
    /** A dark balloon with a count: a cluster of stops or vehicles. */
    | { type: "cluster"; count: number; color: string }
    /** A stop: a mode icon on its mode's colour. */
    | { type: "stop"; mode: string }
    /** A live vehicle on the Map tab: route name and heading on the route colour. */
    | { type: "vehicleTag"; label: string; color: string; mode: string; bearing?: number | null }
    /** The vehicle a tracker follows: a big circle with its mode icon. */
    | { type: "vehicle"; mode: string; color: string }
    /** A plain ring or dot - a stop along a trip, a journey's start. */
    | { type: "dot"; size: number; fill: string; stroke: string; strokeWidth: number }
    /** The red pin for "your stop" or a destination. Anchor it "bottom". */
    | { type: "pin"; color: string }
    /** A route badge - where a journey boards. */
    | { type: "badge"; text: string; color: string }

export interface MapMarker {
    id: string
    coordinate: Coordinate
    view: MarkerView
    anchor?: "center" | "bottom"
    accessibilityLabel?: string
    onPress?: () => void
    zIndex?: number
}

export interface MapLine {
    id: string
    coords: Coordinate[]
    color: string
    width?: number
    /** A walk: round dots rather than a solid line. */
    dashed?: boolean
}

export interface CameraOptions {
    /** [lon, lat] */
    center?: [number, number]
    zoom?: number
    pitch?: number
    duration?: number
}

export interface MapCamera {
    easeTo(o: CameraOptions): void
    flyTo(o: CameraOptions): void
    fitBounds(bounds: Bounds, o?: { padding?: { top: number; bottom: number; left: number; right: number }; duration?: number }): void
}

export interface TransitMapProps {
    center: Coordinate
    zoom?: number
    pitch?: number
    threeD?: boolean
    showUser?: boolean
    /** Off for a still preview - no pan, zoom or rotate. */
    interactive?: boolean
    padding?: { top?: number; bottom?: number; left?: number; right?: number }
    /** Start framed on these instead of `center`/`zoom`. */
    bounds?: Bounds | null
    lines?: MapLine[]
    markers?: MapMarker[]
    onPress?: () => void
    onRegionDidChange?: (center: Coordinate, zoom: number, bounds: Bounds, byUser: boolean) => void
    /** The map is ready - the moment to frame the camera. */
    onLoaded?: () => void
}

export const lngLat = (c: Coordinate): [number, number] => [c.lon, c.lat]

/** [west, south, east, north] around `coords`, or null with none. */
export function boundsOf(coords: Coordinate[]): Bounds | null {
    if (!coords.length) return null
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const c of coords) {
        w = Math.min(w, c.lon); e = Math.max(e, c.lon)
        s = Math.min(s, c.lat); n = Math.max(n, c.lat)
    }
    // A single point (or a very short trip) still needs some area to show.
    const minSpan = 0.004
    if (e - w < minSpan) { const m = (e + w) / 2; w = m - minSpan / 2; e = m + minSpan / 2 }
    if (n - s < minSpan) { const m = (n + s) / 2; s = m - minSpan / 2; n = m + minSpan / 2 }
    return [w, s, e, n]
}

/**
 * Zoom for a longitude span shown across `widthPts` points - and back. In
 * MapLibre's convention (512 pt tiles), which supercluster and every screen's
 * zoom numbers assume; MapKit reports spans, not zoom.
 */
export const zoomForSpan = (lonDelta: number, widthPts: number) => Math.log2((360 * widthPts) / (512 * Math.max(lonDelta, 1e-9)))
export const spanForZoom = (zoom: number, widthPts: number) => (360 * widthPts) / (512 * 2 ** zoom)
