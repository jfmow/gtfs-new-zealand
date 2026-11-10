export * from "./map-types"

/**
 * The map every screen uses. Platform files pick the engine:
 * - `transit-map.ios.tsx`: Apple MapKit (native)
 * - `transit-map.android.tsx`: Apple MapKit JS when there's a token, else MapLibre
 * This file is the type-checked default (and web): MapLibre.
 */
export { MapLibreMap as TransitMap } from "./maplibre-map"
