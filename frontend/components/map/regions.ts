import type { LatLng } from "./geo";

/**
 * Where each region's map may go: `center` + `span` (degrees, lat x lon) is
 * the MapKit camera boundary - the map centre can't leave it - and also sets
 * how far out you can zoom. Sized from each feed's stop extent plus a margin
 * (Auckland includes Te Huia to Hamilton, Waiheke and Great Barrier, but not
 * AT's bogus "Virtual Point" ferry stops in the Pacific).
 *
 * Keyed by region slug (`getRegionSlug`), so the localhost dev regions and any
 * region object already saved in localStorage pick it up too.
 */
export type MapRegion = { center: LatLng; span: LatLng };

export const MAP_REGIONS: Record<string, MapRegion> = {
    at: { center: [-37.035, 174.95], span: [1.63, 1.14] },
    wel: { center: [-40.985, 175.2], span: [0.87, 1.1] },
    christ: { center: [-43.465, 172.435], span: [0.47, 0.77] },
    otago: { center: [-45.44, 169.8], span: [1.12, 2.5] },
    seq: { center: [-27.165, 152.835], span: [2.13, 1.57] },
};

/** Closest the camera may get (metres above the map centre) - a few houses across. */
export const MIN_CAMERA_DISTANCE = 120;

/** Furthest out: enough to see the whole region with some room around it. */
export function maxCameraDistance(region: MapRegion): number {
    const metresPerDegree = 111_320;
    const heightM = region.span[0] * metresPerDegree;
    const widthM = region.span[1] * metresPerDegree * Math.cos((region.center[0] * Math.PI) / 180);
    return Math.max(heightM, widthM) * 1.5;
}
