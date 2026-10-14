import { load, type MapKit } from "@apple/mapkit-loader";

export type { MapKit };
export type MK = MapKit;

/**
 * MapKit JS is loaded once per page from Apple's CDN. The token is a MapKit JS
 * JWT from the Apple developer account (Certificates, IDs & Profiles → Keys /
 * Maps IDs), domain-restricted, and inlined at build time.
 */
const TOKEN = process.env.NEXT_PUBLIC_MAPKIT_TOKEN ?? "";

let loading: Promise<MapKit> | null = null;

export function hasMapKitToken(): boolean {
    return TOKEN !== "";
}

export function loadMapKit(): Promise<MapKit> {
    if (!loading) {
        loading = load({
            token: TOKEN,
            language: "en-NZ",
            libraries: ["map", "annotations", "overlays"],
        }).catch((err) => {
            loading = null; // let a later map retry
            throw err;
        });
    }
    return loading;
}
