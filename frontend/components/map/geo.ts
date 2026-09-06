import maplibregl from "maplibre-gl";

/**
 * Leaflet spoke in [lat, lon]; MapLibre speaks [lng, lat]. Every coordinate
 * that crosses from app data (always lat-first) into a MapLibre call goes
 * through here so the flip lives in exactly one place.
 */
export type LatLng = [number, number];

export function toLngLat(latLng: LatLng): [number, number] {
    return [latLng[1], latLng[0]];
}

export function boundsOf(a: LatLng, b: LatLng): maplibregl.LngLatBounds {
    // Build by extending, not `new LngLatBounds(sw, ne)` - the two points aren't
    // guaranteed to be in SW/NE order (e.g. a route heading north-west), and a
    // malformed bounds makes fitBounds compute a NaN zoom and fall back to the
    // whole-world view.
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend(toLngLat(a));
    bounds.extend(toLngLat(b));
    return bounds;
}

/**
 * Run `cb` now if the style is ready, otherwise as soon as it becomes ready.
 * Adding sources/layers before the style is parsed (or mid `setStyle` theme
 * swap) throws "Style is not done loading". `cb` must be idempotent - callers
 * guard with `getSource`/`getLayer` - since it can run more than once here.
 * `isStyleLoaded()` alone isn't trusted: we try immediately and, if that
 * throws, fall back to retrying on `styledata`/`idle`.
 */
export function whenStyleReady(map: maplibregl.Map, cb: () => void): void {
    const attempt = (): boolean => {
        try {
            cb();
            return true;
        } catch {
            return false;
        }
    };

    if (map.isStyleLoaded() && attempt()) return;

    const retry = () => {
        if (attempt()) {
            map.off("styledata", retry);
            map.off("idle", retry);
        }
    };
    map.on("styledata", retry);
    map.on("idle", retry);
}
