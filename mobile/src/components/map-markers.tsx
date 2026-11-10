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

export const stopMarker = (stop: StopPoint, onPress: () => void): MapMarker => ({
    id: `s-${stop.id}`, coordinate: { lat: stop.lat, lon: stop.lon }, view: { type: "stop", mode: stop.type }, accessibilityLabel: stop.name, onPress,
})

export const vehicleMarker = (v: VehiclePoint, onPress: () => void): MapMarker => ({
    id: `v-${v.id}`, coordinate: { lat: v.lat, lon: v.lon }, zIndex: 2,
    view: { type: "vehicleTag", label: v.label, color: v.color, mode: v.type, bearing: v.bearing }, accessibilityLabel: `${v.type} ${v.label}`, onPress,
})
