'use client';

import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import React, { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import type { Feature, FeatureCollection, LineString } from "geojson"
import { GeoJSON } from "./geojson-types";
import { buttonVariants } from "../ui/button";
import { BasemapManager, styleUrlForTheme, type MapTheme } from "./tile-layer";
import { resolveMapTheme, useMapThemeOverride } from "./map-theme";
import { MapItem } from "./markers/create";
import { MarkerManager } from "./cluster-manager";
import { useUrl } from "@/lib/url-context";
import { boundsOf, toLngLat, whenStyleReady, type LatLng } from "./geo";

export type { LatLng };
type BackupLatLng = LatLng

interface MapProps {
    line?: {
        GeoJson: GeoJSON
        color: string
    }
    mapItems?: MapItem[]
    map_id: string
    height: string
    defaultZoom: [LatLng, LatLng] | [LatLng] | ["user", BackupLatLng]
    options?: MapOptions
    onMapClick?: (lat: number, lon: number) => void
    onLocationUpdate?: (lat: number, lon: number) => void
    followUser?: boolean
    /** Tune when markers of a given type start clustering together, and how tightly. */
    clusterOptions?: { threshold?: number; maxClusterRadius?: number }
    /** Auto-pan the map to keep this marker id in view as it moves. */
    followMarkerId?: string
    /** When following a marker, instead of panning to it, keep both it and this [lat, lon] point framed (e.g. the vehicle and the stop you're waiting at). */
    followFitWith?: [number, number] | null
    /** Flips false→true once (e.g. when live tracking starts) to fly the map into a close zoom on zoomInCenter - a one-shot trigger, not a held state. */
    zoomInTrigger?: boolean
    zoomInCenter?: LatLng
}

interface MapOptions {
    buttonPosition: "top" | "bottom"
}

const ROUTE_SOURCE = "route-line"
const WAYPOINT_SOURCE = "waypoint-line"

export default function MapComp({
    mapItems = [],
    map_id,
    height,
    defaultZoom,
    line,
    options,
    onMapClick,
    onLocationUpdate,
    followUser,
    clusterOptions,
    followMarkerId,
    followFitWith,
    zoomInTrigger,
    zoomInCenter,
}: MapProps) {
    const { currentUrl } = useUrl();
    const { resolvedTheme } = useTheme();
    const themeOverride = useMapThemeOverride();
    const theme: MapTheme = resolveMapTheme(themeOverride, resolvedTheme === "dark" ? "dark" : "light");

    const mapRef = useRef<maplibregl.Map | null>(null);
    const basemapRef = useRef<BasemapManager | null>(null);
    const markerManagerRef = useRef<MarkerManager | null>(null);
    const userRef = useRef<{ marker: maplibregl.Marker | null; control: maplibregl.IControl | null }>({ marker: null, control: null });
    const zoomButtonsRef = useRef<Record<string, maplibregl.IControl>>({});
    const readyRef = useRef(false);
    const [ready, setReady] = React.useState(false);

    // Kept current every render so the async callbacks below never need re-subscribing.
    const onLocationUpdateRef = useRef(onLocationUpdate);
    const followUserRef = useRef(followUser);
    const followFitWithRef = useRef(followFitWith);
    const themeRef = useRef(theme);
    const lineDataRef = useRef<FeatureCollection | null>(null);
    const waypointDataRef = useRef<FeatureCollection | null>(null);
    onLocationUpdateRef.current = onLocationUpdate;
    followUserRef.current = followUser;
    followFitWithRef.current = followFitWith;
    themeRef.current = theme;

    // --- map creation (once per map_id) --------------------------------------
    useEffect(() => {
        if (map_id.length < 3) throw new Error("Map ID is too short, must be at least 3 characters");
        if (mapRef.current) return;

        const buttonPos = options?.buttonPosition;
        const init = initialCamera(defaultZoom);

        const map = new maplibregl.Map({
            container: map_id,
            style: styleUrlForTheme(themeRef.current),
            attributionControl: { compact: true },
            fadeDuration: 0, // no 300ms tile cross-fade - show them as they arrive
            ...init.camera,
        });
        mapRef.current = map;

        if (init.locateUser) {
            getUserLocation()
                .then((r) => map.jumpTo({ center: toLngLat(r), zoom: 17 }))
                .catch(() => map.jumpTo({ center: toLngLat(init.locateUser as LatLng), zoom: 17 }));
        }

        const markerManager = new MarkerManager(map, {
            clusterThreshold: clusterOptions?.threshold,
            clusterRadius: clusterOptions?.maxClusterRadius,
        });
        markerManagerRef.current = markerManager;

        const basemap = new BasemapManager(map, themeRef.current, () => {
            // Runs after the first style load and after every theme swap - the
            // setStyle wipes every source/layer we added, so rebuild them.
            addLineLayers(map);
            if (lineDataRef.current) (map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(lineDataRef.current);
            if (waypointDataRef.current) (map.getSource(WAYPOINT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(waypointDataRef.current);
            markerManagerRef.current?.reattachSources();
        });
        basemapRef.current = basemap;

        // Controls need neither style nor tiles - add them now so the buttons are
        // there from the first frame instead of only after tiles finish loading.
        addZoomControls(map, buttonPos === "bottom" ? "bottom-left" : "top-left");
        basemap.addControl(buttonPos === "bottom" ? "bottom-right" : "top-right");
        if (onMapClick) map.on("click", (e) => onMapClick(e.lngLat.lat, e.lngLat.lng));

        // Gate marker/line setup on `style.load` (style parsed) rather than
        // `load` (which also waits for the first tiles) - markers are DOM
        // overlays and don't need to wait for imagery.
        let didFirstFit = false;
        map.on("style.load", () => {
            if (!didFirstFit && init.fitBounds && !init.fitBounds.isEmpty()) {
                didFirstFit = true;
                // The container may have been 0-sized when the constructor fit
                // the bounds (drawer/flex still settling), so redo it now.
                map.fitBounds(init.fitBounds, { padding: FIT_PADDING, animate: false });
            }
            readyRef.current = true;
            setReady(true);
        });

        // MapLibre's own trackResize only watches the window - the map container
        // here is flex-sized and often lands at its final height a frame after
        // creation, so keep watching it directly (this is what the old Leaflet
        // invalidateSize observer did). Only act on a real size change, or
        // resize() feeds the flex layout back into the observer in a loop.
        const container = document.getElementById(map_id);
        let lastW = container?.clientWidth ?? 0;
        let lastH = container?.clientHeight ?? 0;
        const resizeObserver = new ResizeObserver(() => {
            if (!container) return;
            if (container.clientWidth === lastW && container.clientHeight === lastH) return;
            lastW = container.clientWidth;
            lastH = container.clientHeight;
            map.resize();
        });
        if (container) resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            markerManagerRef.current?.destroy();
            basemapRef.current?.destroy();
            map.remove();
            mapRef.current = null;
            markerManagerRef.current = null;
            basemapRef.current = null;
            userRef.current = { marker: null, control: null };
            zoomButtonsRef.current = {};
            readyRef.current = false;
            setReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map_id]);

    // --- theme swap --------------------------------------------------------
    useEffect(() => {
        basemapRef.current?.setTheme(theme);
    }, [theme]);

    // --- geolocation polling (one 3s loop per map instance) ----------------
    useEffect(() => {
        if (!ready) return;
        const map = mapRef.current;
        if (!map) return;

        const controlPosition = options?.buttonPosition === "bottom" ? "bottom-right" : "top-right";
        let intervalId: NodeJS.Timeout | undefined;
        let cancelled = false;

        startLocationUpdates((latLng) => {
            addUserMarker(userRef.current, map, latLng, controlPosition);
            onLocationUpdateRef.current?.(latLng[0], latLng[1]);
            if (followUserRef.current) {
                map.panTo(toLngLat(latLng), { duration: 500 });
            }
        }).then((res) => {
            if (cancelled) {
                if (res) clearInterval(res);
                return;
            }
            if (res) intervalId = res;
        });

        return () => {
            cancelled = true;
            if (intervalId) clearInterval(intervalId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, options?.buttonPosition]);

    // --- markers ---------------------------------------------------------
    useEffect(() => {
        if (!ready) return;
        const map = mapRef.current;
        const markerManager = markerManagerRef.current;
        if (!map || !markerManager) return;

        markerManager.setOptions({
            clusterThreshold: clusterOptions?.threshold,
            clusterRadius: clusterOptions?.maxClusterRadius,
        });
        markerManager.setItems(mapItems);

        // Per-marker "zoom to" controls.
        const wantButtons = new Set(mapItems.filter((i) => i.zoomButton).map((i) => i.id));
        for (const [id, control] of Object.entries(zoomButtonsRef.current)) {
            if (!wantButtons.has(id)) {
                map.removeControl(control);
                delete zoomButtonsRef.current[id];
            }
        }
        for (const item of mapItems) {
            if (!item.zoomButton || zoomButtonsRef.current[item.id]) continue;
            const control = new ButtonControl(
                item.zoomButton,
                () => map.flyTo({ center: toLngLat([item.lat, item.lon]), zoom: 17 })
            );
            zoomButtonsRef.current[item.id] = control;
            map.addControl(control, "top-right");
        }

        // Follow a moving marker.
        if (followMarkerId) {
            const target = mapItems.find((i) => i.id === followMarkerId);
            if (target) {
                const fitWith = followFitWithRef.current;
                if (fitWith) {
                    map.fitBounds(boundsOf([target.lat, target.lon], [fitWith[0], fitWith[1]]), {
                        padding: 55,
                        maxZoom: 16,
                        duration: 500,
                    });
                } else {
                    map.panTo(toLngLat([target.lat, target.lon]), { duration: 500 });
                }
            }
        }

        // Waypoint connector line (history page).
        const waypoints = mapItems.filter((i) => i.type === "waypoint");
        const waypointFc = waypoints.length >= 2 ? buildWaypointLine(waypoints) : emptyFc();
        waypointDataRef.current = waypointFc;
        whenStyleReady(map, () => {
            addLineLayers(map);
            (map.getSource(WAYPOINT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(waypointFc);
        });
    }, [ready, mapItems, clusterOptions?.threshold, clusterOptions?.maxClusterRadius, followMarkerId]);

    // --- one-shot fly-in on zoomInTrigger false→true ---------------------
    const wasZoomInTriggered = useRef(false);
    useEffect(() => {
        const map = mapRef.current;
        if (ready && map && zoomInTrigger && !wasZoomInTriggered.current && zoomInCenter) {
            map.easeTo({ center: toLngLat(zoomInCenter), zoom: 16, duration: 500 });
        }
        wasZoomInTriggered.current = !!zoomInTrigger;
    }, [ready, zoomInTrigger, zoomInCenter]);

    // --- route line -----------------------------------------------------
    useEffect(() => {
        if (!ready) return;
        const map = mapRef.current;
        if (!map) return;

        const fc = line ? resolveLineFeatures(line.GeoJson, line.color, currentUrl.textColor) : emptyFc();
        lineDataRef.current = fc;
        whenStyleReady(map, () => {
            addLineLayers(map);
            (map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        });
    }, [ready, line, currentUrl.textColor]);

    return (
        <div
            id={map_id}
            style={{
                height: height,
                width: "100%",
                maxHeight: height ? "" : "50vh",
                zIndex: 1,
                borderRadius: "var(--radius)",
                overflow: "hidden",
                flexGrow: 1,
                // Match the eventual basemap ground colour so there's no white
                // flash while the style/tiles load.
                backgroundColor: theme === "dark" ? "#1b1b1b" : "#f2f1ee",
            }}
        />
    );
}

// --------------------------------------------------------------------------
// camera

type InitialCamera = {
    camera: { center: [number, number]; zoom: number } | { bounds: maplibregl.LngLatBounds; fitBoundsOptions: maplibregl.FitBoundsOptions };
    /** Re-applied once on `load`, when the container has its real size (a bounds
     * fit computed against a 0-height flex/drawer container comes out wrong). */
    fitBounds?: maplibregl.LngLatBounds;
    locateUser?: LatLng;
};

const FIT_PADDING = 40;

function initialCamera(defaultZoom: MapProps["defaultZoom"]): InitialCamera {
    if (
        !defaultZoom ||
        !Array.isArray(defaultZoom) ||
        defaultZoom.length < 1 ||
        (defaultZoom[0] !== "user" && !Array.isArray(defaultZoom[0]))
    ) {
        throw new Error("Missing or invalid defaultZoom");
    }

    if (defaultZoom[0] === "user") {
        const backup = defaultZoom[1] as LatLng;
        return { camera: { center: toLngLat(backup), zoom: 12 }, locateUser: backup };
    }
    if (defaultZoom.length === 2) {
        const bounds = boundsOf(defaultZoom[0] as LatLng, defaultZoom[1] as LatLng);
        return {
            camera: { bounds, fitBoundsOptions: { padding: FIT_PADDING } },
            fitBounds: bounds,
        };
    }
    return { camera: { center: toLngLat(defaultZoom[0] as LatLng), zoom: 17 } };
}

// --------------------------------------------------------------------------
// route + waypoint lines

function emptyFc(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function toFeatures(geojson: GeoJSON): Feature[] {
    const any = geojson as unknown as { type: string; features?: Feature[] };
    if (any.type === "FeatureCollection") return any.features ?? [];
    return [any as unknown as Feature];
}

/**
 * Ports the old Leaflet `geoJSON` per-feature style function: resolves each
 * feature's colour/weight/opacity from its `mode`/`segment`/`color` properties
 * (with the region brand colour and the blanket `line.color` as fallbacks) and
 * stashes the result in `_color`/`_weight`/`_opacity` for a data-driven paint.
 */
function resolveLineFeatures(geojson: GeoJSON, lineColor: string, textColor: string): FeatureCollection {
    const features = toFeatures(geojson).map((feature) => {
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const mode = props.mode as string | undefined;
        const segment = props.segment as string | undefined;

        let color: string;
        let weight: number;
        let opacity: number;

        if (segment === "before" || segment === "after") {
            color = "#9ca3af";
            weight = 5;
            opacity = 0.6;
        } else {
            const featureColor = props.color as string | undefined;
            color =
                featureColor ||
                (lineColor === ""
                    ? mode === "walk"
                        ? "#64748b"
                        : mode === "transit"
                          ? textColor || "#374151"
                          : "#6ec3db"
                    : lineColor);
            weight = 6;
            opacity = 0.95;
        }

        return {
            ...feature,
            properties: { ...props, _color: color, _weight: weight, _opacity: opacity },
        } as Feature;
    });

    return { type: "FeatureCollection", features };
}

/** Green→yellow→red by average segment speed - ported from the old polyline builder. */
function speedColor(avgSpeed: number): string {
    const ratio = Math.min(avgSpeed / 100, 1);
    if (ratio <= 0.5) {
        const r = Math.round(255 * (ratio * 2));
        return `rgb(${r},255,0)`;
    }
    const g = Math.round(255 * (1 - (ratio - 0.5) * 2));
    return `rgb(255,${g},0)`;
}

function buildWaypointLine(items: MapItem[]): FeatureCollection {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const features: Feature[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const avgSpeed = ((a.speedKmh ?? 0) + (b.speedKmh ?? 0)) / 2;
        features.push({
            type: "Feature",
            properties: { _color: speedColor(avgSpeed), _speed: `${avgSpeed.toFixed(1)} km/h` },
            geometry: {
                type: "LineString",
                coordinates: [toLngLat([a.lat, a.lon]), toLngLat([b.lat, b.lon])],
            } as LineString,
        });
    }
    return { type: "FeatureCollection", features };
}

function addLineLayers(map: maplibregl.Map) {
    if (!map.getSource(ROUTE_SOURCE)) map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyFc() });
    if (!map.getSource(WAYPOINT_SOURCE)) map.addSource(WAYPOINT_SOURCE, { type: "geojson", data: emptyFc() });

    if (!map.getLayer("route-line-casing")) {
        map.addLayer({
            id: "route-line-casing",
            type: "line",
            source: ROUTE_SOURCE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "#ffffff",
                "line-opacity": 0.55,
                "line-width": ["+", ["coalesce", ["get", "_weight"], 6], 2],
            },
        });
    }
    if (!map.getLayer("route-line-main")) {
        map.addLayer({
            id: "route-line-main",
            type: "line",
            source: ROUTE_SOURCE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": ["coalesce", ["get", "_color"], "#6ec3db"],
                "line-width": ["coalesce", ["get", "_weight"], 6],
                "line-opacity": ["coalesce", ["get", "_opacity"], 0.95],
            },
        });
    }
    if (!map.getLayer("waypoint-line")) {
        map.addLayer({
            id: "waypoint-line",
            type: "line",
            source: WAYPOINT_SOURCE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": ["coalesce", ["get", "_color"], "#22c55e"],
                "line-width": 6,
                "line-opacity": 0.95,
            },
        });
    }

    const flagged = map as unknown as { __waypointHoverBound?: boolean };
    if (!flagged.__waypointHoverBound) {
        flagged.__waypointHoverBound = true;
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        map.on("mousemove", "waypoint-line", (e) => {
            const f = e.features?.[0];
            const speed = f?.properties?._speed;
            if (!speed) return;
            map.getCanvas().style.cursor = "pointer";
            popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;font-weight:600;">${speed}</div>`).addTo(map);
        });
        map.on("mouseleave", "waypoint-line", () => {
            map.getCanvas().style.cursor = "";
            popup.remove();
        });
    }
}

// --------------------------------------------------------------------------
// controls

class ButtonControl implements maplibregl.IControl {
    private html: string;
    private onClick: () => void;
    private container?: HTMLDivElement;

    constructor(html: string, onClick: () => void) {
        this.html = html;
        this.onClick = onClick;
    }

    onAdd(): HTMLElement {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl";
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${buttonVariants({ variant: "default", size: "icon" })} map-control-button`;
        button.innerHTML = this.html;
        const stop = (e: Event) => {
            e.stopPropagation();
            if ("preventDefault" in e) e.preventDefault();
        };
        button.addEventListener("pointerup", (e) => {
            stop(e);
            this.onClick();
        });
        ["mousedown", "dblclick", "pointerdown", "click"].forEach((ev) => button.addEventListener(ev, stop));
        container.appendChild(button);
        this.container = container;
        return container;
    }

    onRemove(): void {
        this.container?.remove();
        this.container = undefined;
    }
}

const ZOOM_IN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
const ZOOM_OUT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-out"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
const LOCATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`;

function addZoomControls(map: maplibregl.Map, position: maplibregl.ControlPosition) {
    map.addControl(new ButtonControl(ZOOM_IN_SVG, () => map.zoomIn()), position);
    map.addControl(new ButtonControl(ZOOM_OUT_SVG, () => map.zoomOut()), position);
}

function addUserMarker(
    user: { marker: maplibregl.Marker | null; control: maplibregl.IControl | null },
    map: maplibregl.Map,
    userLocation: LatLng,
    position: maplibregl.ControlPosition
) {
    if (userLocation[0] === 0 && userLocation[1] === 0) return;

    if (user.marker) {
        user.marker.setLngLat(toLngLat(userLocation));
    } else {
        const el = document.createElement("div");
        el.className = "flex items-center justify-center";
        el.innerHTML = `<div style="position: relative; width: 24px; height: 24px;"><img class="user-marker-arrow" src="/vehicle_icons/location.png" style="width: 24px; height: 24px;"/></div>`;
        user.marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, 6] }).setLngLat(toLngLat(userLocation)).addTo(map);
    }

    if (!user.control) {
        const marker = user.marker;
        user.control = new ButtonControl(LOCATE_SVG, () => {
            if (marker) map.flyTo({ center: marker.getLngLat(), zoom: 15 });
        });
        map.addControl(user.control, position);
    }
}

// --------------------------------------------------------------------------
// geolocation (framework-agnostic - unchanged from the Leaflet version)

async function checkPermission(): Promise<boolean> {
    if (!navigator.permissions) return true;
    try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        return status.state === "granted" || status.state === "prompt";
    } catch {
        return true;
    }
}

async function startLocationUpdates(callback: (latLng: LatLng) => void): Promise<NodeJS.Timeout | null> {
    const hasPermission = await checkPermission();
    if (!hasPermission) {
        console.warn("Location permission denied or unavailable. Not starting location updates.");
        return null;
    }

    let requestId = 0;
    let appliedId = 0;

    try {
        const id = ++requestId;
        const latLng = await getUserLocation();
        appliedId = id;
        callback(latLng);
    } catch (error) {
        console.error("Failed to get initial location:", error);
        return null;
    }

    return setInterval(async () => {
        const id = ++requestId;
        try {
            const latLng = await getUserLocation();
            if (id < appliedId) return;
            appliedId = id;
            callback(latLng);
        } catch (error) {
            console.error("Failed to get location update:", error);
        }
    }, 3000);
}

async function getUserLocation(): Promise<LatLng> {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve([position.coords.latitude, position.coords.longitude]),
            (error) => {
                console.error("Error getting location:", error);
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
    });
}
