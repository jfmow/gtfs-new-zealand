import type { GeoJSON } from "@/components/map/geojson-types"

interface LatLon {
    lat: number
    lon: number
}

// The shapes/journey endpoints sometimes return a single Feature rather than
// a FeatureCollection - Leaflet accepts either, but merging requires a
// consistent array of features to work with.
export function toFeatureArray(line: GeoJSON): Record<string, unknown>[] {
    const anyLine = line as unknown as { type: string; features?: unknown[] }
    if (anyLine.type === "FeatureCollection") {
        return (anyLine.features as Record<string, unknown>[]) ?? []
    }
    return [anyLine as unknown as Record<string, unknown>]
}

function nearestIndex(coords: number[][], point: LatLon): number {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < coords.length; i++) {
        const [lon, lat] = coords[i]
        const d = (lat - point.lat) ** 2 + (lon - point.lon) ** 2
        if (d < bestDist) {
            bestDist = d
            best = i
        }
    }
    return best
}

/**
 * Splits a trip's full route shape into up to three segments relative to the
 * rider's own board/alight stops: "before" and "after" (outside this rider's
 * ride, even though the vehicle itself continues past them - styled gray by
 * map.tsx) and an unlabeled "active" middle segment (styled by the existing
 * transit-mode coloring, unchanged). Always returns a FeatureCollection.
 */
export function splitTrackedRouteLine(line: GeoJSON, board: LatLon, alight: LatLon): Record<string, unknown>[] {
    const feature = toFeatureArray(line)[0] as { geometry?: { coordinates?: number[][] } } | undefined
    const coords = feature?.geometry?.coordinates
    if (!coords || coords.length < 2) return toFeatureArray(line)

    let boardIdx = nearestIndex(coords, board)
    let alightIdx = nearestIndex(coords, alight)
    if (boardIdx > alightIdx) {
        const tmp = boardIdx
        boardIdx = alightIdx
        alightIdx = tmp
    }

    const makeFeature = (segment: "before" | "active" | "after", segCoords: number[][]) => ({
        type: "Feature",
        properties: { mode: "transit", segment },
        geometry: { type: "LineString", coordinates: segCoords },
    })

    const features = []
    if (boardIdx > 0) features.push(makeFeature("before", coords.slice(0, boardIdx + 1)))
    features.push(makeFeature("active", coords.slice(boardIdx, alightIdx + 1)))
    if (alightIdx < coords.length - 1) features.push(makeFeature("after", coords.slice(alightIdx)))

    return features
}

/**
 * Builds the map's route line for a journey with a live-tracked leg: every
 * feature from the full journey (all walk legs, all other transit legs) is
 * kept as-is, EXCEPT the tracked leg's own feature, which is replaced by its
 * richer tracked-mode representation (before/active/after segments). Any extra
 * synthetic features (e.g. a live walk-to-stop connector) are appended on top.
 * Legs other than the tracked one stay fully visible - tracking one leg
 * shouldn't erase the rest of the journey, including the routed walk to it.
 */
export function buildTrackedLine(
    routeGeoJson: GeoJSON | undefined,
    trackedTripId: string | undefined,
    trackedFeatures: Record<string, unknown>[]
): GeoJSON {
    const baseFeatures = routeGeoJson ? toFeatureArray(routeGeoJson) : []
    const keptFeatures = baseFeatures.filter((f) => {
        const props = (f as { properties?: { trip_id?: string } }).properties
        if (trackedTripId && props?.trip_id === trackedTripId) return false
        return true
    })
    return { type: "FeatureCollection", features: [...keptFeatures, ...trackedFeatures] } as unknown as GeoJSON
}
