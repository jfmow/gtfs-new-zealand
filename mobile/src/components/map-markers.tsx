import Supercluster from "supercluster"
import type { Bounds, MapMarker } from "./map-types"

/**
 * The Map tab's stops and vehicles, clustered in JS with supercluster so only
 * what's on screen is drawn, as marker data for whichever map engine.
 */

export type { Bounds }

export interface StopPoint { kind: "stop"; id: string; query: string; name: string; type: string; lat: number; lon: number }
export interface VehiclePoint { kind: "vehicle"; id: string; label: string; color: string; type: string; bearing: number; lat: number; lon: number }
type Point = StopPoint | VehiclePoint

export function buildIndex<T extends Point>(points: T[], radius = 60) {
    const index = new Supercluster<T>({ radius, maxZoom: 15, minPoints: 3 })
    index.load(points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: p })))
    return index
}

export type Clustered<T> = { kind: "cluster"; id: number; count: number; lat: number; lon: number } | (T & { kind: T extends StopPoint ? "stop" : "vehicle" })

export function clustersIn<T extends Point>(index: Supercluster<T>, bounds: Bounds, zoom: number): (T | { kind: "cluster"; id: number; count: number; lat: number; lon: number })[] {
    return index.getClusters(bounds, Math.round(zoom)).map((f) => {
        const [lon, lat] = f.geometry.coordinates
        const props = f.properties as T & { cluster?: boolean; cluster_id?: number; point_count?: number }
        if (props.cluster) return { kind: "cluster" as const, id: props.cluster_id!, count: props.point_count!, lat, lon }
        return props as T
    })
}

/** A cluster balloon - tap to zoom in. */
export const clusterMarker = (c: { id: number; count: number; lat: number; lon: number }, prefix: string, color: string, onPress: () => void): MapMarker => ({
    id: `${prefix}-${c.id}`, coordinate: { lat: c.lat, lon: c.lon }, anchor: "bottom",
    view: { type: "cluster", count: c.count, color }, accessibilityLabel: `${c.count} ${prefix === "vc" ? "vehicles" : "stops"}, zoom in`, onPress,
})

/** Train stations and ferry terminals: few, and what people orient by - never clustered, drawn bigger and on top. */
export const isMajorStop = (stop: Pick<StopPoint, "type">) => stop.type === "train" || stop.type === "ferry"

/** The major stops inside `bounds` (a little padded so they don't pop at the edges). */
export function majorStopsIn(stops: StopPoint[], bounds: Bounds): StopPoint[] {
    const padLon = (bounds[2] - bounds[0]) * 0.1
    const padLat = (bounds[3] - bounds[1]) * 0.1
    return stops.filter((s) => s.lon >= bounds[0] - padLon && s.lon <= bounds[2] + padLon && s.lat >= bounds[1] - padLat && s.lat <= bounds[3] + padLat)
}

export const stopMarker = (stop: StopPoint, onPress: () => void): MapMarker => {
    const major = isMajorStop(stop)
    return {
        id: `s-${stop.id}`, coordinate: { lat: stop.lat, lon: stop.lon }, zIndex: major ? 1 : undefined,
        view: { type: "stop", mode: stop.type, major }, accessibilityLabel: stop.name, onPress,
    }
}

export const vehicleMarker = (v: VehiclePoint, onPress: () => void): MapMarker => ({
    id: `v-${v.id}`, coordinate: { lat: v.lat, lon: v.lon }, zIndex: 2,
    view: { type: "vehicleTag", label: v.label, color: v.color, mode: v.type, bearing: v.bearing }, accessibilityLabel: `${v.type} ${v.label}`, onPress,
})
