import type { CoordinateRegion, Map as MKMap, MapKit } from "@apple/mapkit-loader";

/** App data is always [lat, lon]. */
export type LatLng = [number, number];

export type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * MapKit JS has no zoom level and no padded fitBounds, so the camera works in
 * Web-Mercator "world units" (the whole world is 1x1, the same space as
 * mapkit.MapPoint): at zoom z one screen pixel covers 1 / (512 * 2^z) units.
 * Zoom levels are MapLibre/Mapbox-style (512px tiles), so the numbers carried
 * over from the old map (17 for a stop, 16 max on fits...) mean the same thing.
 * Every camera move is turned into a CoordinateRegion that exactly fills the
 * map's inset frame (map.padding), which MapKit then shows as-is.
 */
export function project([lat, lon]: LatLng): { x: number; y: number } {
    const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return {
        x: (lon + 180) / 360,
        y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
    };
}

export function unproject(x: number, y: number): LatLng {
    const lon = x * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
    return [lat, lon];
}

export function scaleForZoom(zoom: number): number {
    return 1 / (512 * Math.pow(2, zoom));
}

export function containerSize(map: MKMap): { w: number; h: number } {
    const el = map.element;
    return { w: el?.clientWidth || 1, h: el?.clientHeight || 1 };
}

/**
 * World units per pixel right now. MapKit's `visibleMapRect` (like `center`
 * and `region`) describes the inset frame - the element minus `map.padding`.
 */
export function currentScale(map: MKMap): number {
    return map.visibleMapRect.size.width / innerSize(map).w;
}

export function currentZoom(map: MKMap): number {
    return Math.log2(1 / (512 * currentScale(map)));
}

function innerSize(map: MKMap): { w: number; h: number } {
    const { w, h } = containerSize(map);
    const p = map.padding;
    return { w: Math.max(1, w - p.left - p.right), h: Math.max(1, h - p.top - p.bottom) };
}

function regionFor(mk: MapKit, cx: number, cy: number, scale: number, map: MKMap): CoordinateRegion {
    const { w, h } = innerSize(map);
    const halfW = (w * scale) / 2;
    const halfH = (h * scale) / 2;
    const [north, west] = unproject(cx - halfW, cy - halfH);
    const [south, east] = unproject(cx + halfW, cy + halfH);
    return new mk.CoordinateRegion(
        new mk.Coordinate((north + south) / 2, (west + east) / 2),
        new mk.CoordinateSpan(north - south, east - west),
    );
}

/** Centre `point` in the inset frame at `zoom` (default: keep the current zoom). */
export function setView(mk: MapKit, map: MKMap, point: LatLng, zoom?: number, animate = true) {
    const { x, y } = project(point);
    const scale = zoom === undefined ? currentScale(map) : scaleForZoom(zoom);
    map.setRegionAnimated(regionFor(mk, x, y, scale, map), animate);
}

/**
 * Frame `points` inside the inset frame, keeping `pad` pixels clear on each
 * side, never closer than `maxZoom`.
 */
export function fitPoints(
    mk: MapKit,
    map: MKMap,
    points: LatLng[],
    pad: Insets,
    opts: { maxZoom?: number; animate?: boolean } = {},
) {
    if (points.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
        const { x, y } = project(p);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const { w, h } = innerSize(map);
    const availW = Math.max(1, w - pad.left - pad.right);
    const availH = Math.max(1, h - pad.top - pad.bottom);
    const scale = Math.max((x1 - x0) / availW, (y1 - y0) / availH, scaleForZoom(opts.maxZoom ?? 17));
    // Put the points' centre in the middle of the area left after `pad`, then
    // express that as the centre of the whole inset frame.
    const cx = (x0 + x1) / 2 - (pad.left + availW / 2 - w / 2) * scale;
    const cy = (y0 + y1) / 2 - (pad.top + availH / 2 - h / 2) * scale;
    map.setRegionAnimated(regionFor(mk, cx, cy, scale, map), opts.animate ?? true);
}

/** Zoom in/out by `delta` levels about the current view centre. */
export function zoomBy(mk: MapKit, map: MKMap, delta: number) {
    const rect = map.visibleMapRect;
    const cx = rect.origin.x + rect.size.width / 2;
    const cy = rect.origin.y + rect.size.height / 2;
    map.setRegionAnimated(regionFor(mk, cx, cy, currentScale(map) / Math.pow(2, delta), map), true);
}

/** [west, south, east, north] of the whole element (padding included), grown by `margin` (fraction). */
export function viewBBox(map: MKMap, margin = 0.25): [number, number, number, number] {
    const r = map.visibleMapRect;
    const scale = currentScale(map);
    const p = map.padding;
    const { w, h } = containerSize(map);
    const x0 = r.origin.x - p.left * scale - w * scale * margin;
    const y0 = r.origin.y - p.top * scale - h * scale * margin;
    const x1 = r.origin.x + r.size.width + p.right * scale + w * scale * margin;
    const y1 = r.origin.y + r.size.height + p.bottom * scale + h * scale * margin;
    const [north, west] = unproject(x0, y0);
    const [south, east] = unproject(x1, y1);
    return [west, south, east, north];
}
