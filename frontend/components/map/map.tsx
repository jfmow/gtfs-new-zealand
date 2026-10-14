'use client';

import type { Annotation, Map as MKMap, MapKit, Overlay } from "@apple/mapkit-loader";
import React, { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Navigation, ZoomIn, ZoomOut } from "lucide-react";
import type { Feature } from "geojson"
import { GeoJSON } from "./geojson-types";
import { Button } from "../ui/button";
import { BasemapManager, MapVariantToggle, type MapTheme } from "./basemap";
import { resolveMapTheme, useMapThemeOverride } from "./map-theme";
import { MapItem, pointElement } from "./markers/create";
import { USER_LOCATION_HTML } from "./markers/icons";
import { MarkerManager } from "./cluster-manager";
import { useUrl } from "@/lib/url-context";
import { fitPoints, setView, zoomBy, type Insets, type LatLng } from "./geo";
import { hasMapKitToken, loadMapKit } from "./mapkit";
import { MAP_REGIONS, MIN_CAMERA_DISTANCE, maxCameraDistance } from "./regions";
import { getRegionSlug } from "@/lib/url-store";

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
    /** No +/- buttons (phones pinch - the iOS map has none either). */
    hideZoomControls?: boolean
    /** Square corners, for a map that fills the page edge to edge. Default rounded. */
    square?: boolean
    /**
     * Frame these points whenever `key` changes (e.g. the rider picks another
     * journey) - `defaultZoom` only applies when the map is first created.
     * `padding` keeps them clear of overlays such as a bottom drawer.
     */
    fitTo?: { key: string; points: LatLng[]; padding?: { top?: number; right?: number; bottom?: number; left?: number } }
    /** Stop auto-panning to `followMarkerId` (the rider moved the map); set back to false to resume. */
    followPaused?: boolean
    /** The rider panned or zoomed the map themselves. */
    onUserMove?: () => void
    /** Screen space covered by overlays (e.g. a side panel) - the camera centres, follows and fits within the rest. */
    padding?: { top?: number; right?: number; bottom?: number; left?: number }
}

interface MapOptions {
    buttonPosition: "top" | "bottom"
}

const FIT_PADDING = 40;

function insets(pad: number, extra?: Partial<Insets>): Insets {
    return {
        top: pad + (extra?.top ?? 0),
        right: pad + (extra?.right ?? 0),
        bottom: pad + (extra?.bottom ?? 0),
        left: pad + (extra?.left ?? 0),
    };
}

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
    hideZoomControls,
    square,
    padding,
    followPaused,
    onUserMove,
    fitTo,
}: MapProps) {
    const { currentUrl } = useUrl();
    const { resolvedTheme } = useTheme();
    const themeOverride = useMapThemeOverride();
    const theme: MapTheme = resolveMapTheme(themeOverride, resolvedTheme === "dark" ? "dark" : "light");

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [mk, setMk] = useState<MapKit | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const mapRef = useRef<MKMap | null>(null);
    const basemapRef = useRef<BasemapManager | null>(null);
    const markerManagerRef = useRef<MarkerManager | null>(null);
    const routeOverlaysRef = useRef<Overlay[]>([]);
    const waypointOverlaysRef = useRef<Overlay[]>([]);
    const speedTipRef = useRef<Annotation | null>(null);
    const userAnnotationRef = useRef<Annotation | null>(null);
    const [ready, setReady] = useState(false);
    const [hasUserLocation, setHasUserLocation] = useState(false);

    // Kept current every render so the async callbacks below never need re-subscribing.
    const onLocationUpdateRef = useRef(onLocationUpdate);
    const onUserMoveRef = useRef(onUserMove);
    const onMapClickRef = useRef(onMapClick);
    const followUserRef = useRef(followUser);
    const followFitWithRef = useRef(followFitWith);
    const themeRef = useRef(theme);
    onLocationUpdateRef.current = onLocationUpdate;
    onUserMoveRef.current = onUserMove;
    onMapClickRef.current = onMapClick;
    followUserRef.current = followUser;
    followFitWithRef.current = followFitWith;
    themeRef.current = theme;

    // --- load MapKit JS (once per page) ----------------------------------------
    useEffect(() => {
        if (!hasMapKitToken()) {
            setLoadError("Map unavailable - no MapKit token configured.");
            return;
        }
        let cancelled = false;
        loadMapKit()
            .then((m) => { if (!cancelled) setMk(m); })
            .catch((err) => {
                console.error("MapKit JS failed to load", err);
                if (!cancelled) setLoadError("Map failed to load.");
            });
        return () => { cancelled = true; };
    }, []);

    // --- map creation (once per map_id) --------------------------------------
    useEffect(() => {
        if (map_id.length < 3) throw new Error("Map ID is too short, must be at least 3 characters");
        const container = containerRef.current;
        if (!mk || !container || mapRef.current) return;

        const map = new mk.Map(container, {
            showsZoomControl: false,
            showsMapTypeControl: false,
            showsUserLocationControl: false,
            showsScale: mk.FeatureVisibility.Hidden,
            showsCompass: mk.FeatureVisibility.Adaptive,
            showsPointsOfInterest: false,
            isRotationEnabled: true,
        });
        mapRef.current = map;
        basemapRef.current = new BasemapManager(mk, map, themeRef.current);
        markerManagerRef.current = new MarkerManager(mk, map, {
            clusterThreshold: clusterOptions?.threshold,
            clusterRadius: clusterOptions?.maxClusterRadius,
        });

        const initial = initialCamera(defaultZoom);
        const applyInitial = () => {
            if (initial.kind === "fit") fitPoints(mk, map, initial.points, insets(FIT_PADDING), { animate: false });
            else setView(mk, map, initial.center, initial.zoom, false);
        };
        applyInitial();
        if (initial.kind === "user") {
            getUserLocation()
                .then((r) => setView(mk, map, r, 17, false))
                .catch(() => setView(mk, map, initial.center, 17, false));
        }

        // Marker taps are handled on the markers themselves (markers/create.tsx);
        // the only selectable overlays are the history page's speed segments.
        map.addEventListener("select", (e: Event) => {
            const overlay = (e as Event & { overlay?: Overlay }).overlay;
            const info = (overlay?.data ?? {}) as { speed?: string; mid?: LatLng };
            if (info.speed && info.mid) showSpeedTip(mk, map, speedTipRef, info.mid, info.speed);
        });
        map.addEventListener("deselect", (e: Event) => {
            if ((e as Event & { overlay?: Overlay }).overlay && speedTipRef.current) {
                map.removeAnnotation(speedTipRef.current);
                speedTipRef.current = null;
            }
        });
        map.addEventListener("single-tap", (e: Event) => {
            const cb = onMapClickRef.current;
            if (!cb) return;
            const c = map.convertPointOnPageToCoordinate((e as Event & { pointOnPage: DOMPoint }).pointOnPage);
            cb(c.latitude, c.longitude);
        });
        // scroll-start / zoom-start only fire for user gestures, not our own camera moves.
        const userMoved = () => onUserMoveRef.current?.();
        map.addEventListener("scroll-start", userMoved);
        map.addEventListener("zoom-start", userMoved);

        // The container is flex/drawer-sized and is often still 0 tall when the
        // map is created - redo the initial framing once it has a real size.
        let framed = container.clientWidth > 0 && container.clientHeight > 0;
        const resizeObserver = new ResizeObserver(() => {
            if (!framed && container.clientWidth > 0 && container.clientHeight > 0) {
                framed = true;
                applyInitial();
            }
        });
        resizeObserver.observe(container);

        setReady(true);

        return () => {
            resizeObserver.disconnect();
            markerManagerRef.current?.destroy();
            basemapRef.current?.destroy();
            map.destroy();
            mapRef.current = null;
            markerManagerRef.current = null;
            basemapRef.current = null;
            routeOverlaysRef.current = [];
            waypointOverlaysRef.current = [];
            speedTipRef.current = null;
            userAnnotationRef.current = null;
            setHasUserLocation(false);
            setReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mk, map_id]);

    // --- camera padding (overlays covering part of the map) --------------
    const padTop = padding?.top ?? 0;
    const padRight = padding?.right ?? 0;
    const padBottom = padding?.bottom ?? 0;
    const padLeft = padding?.left ?? 0;
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !mk) return;
        // MapKit keeps the inset frame's centre and scale when padding changes,
        // so whatever was centred stays centred in the new free area.
        map.padding = new mk.Padding({ top: padTop, right: padRight, bottom: padBottom, left: padLeft });
    }, [ready, mk, padTop, padRight, padBottom, padLeft]);

    // --- keep the camera inside the current region ------------------------
    const regionSlug = getRegionSlug(currentUrl);
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !mk) return;
        const region = MAP_REGIONS[regionSlug];
        if (!region) {
            map.cameraBoundary = null;
            map.cameraZoomRange = new mk.CameraZoomRange(MIN_CAMERA_DISTANCE, 40_000_000);
            return;
        }
        map.cameraBoundary = new mk.CoordinateRegion(
            new mk.Coordinate(region.center[0], region.center[1]),
            new mk.CoordinateSpan(region.span[0], region.span[1]),
        );
        map.cameraZoomRange = new mk.CameraZoomRange(MIN_CAMERA_DISTANCE, maxCameraDistance(region));
    }, [ready, mk, regionSlug]);

    // --- refit when the thing being shown changes (fitTo.key) -------------
    const fittedKey = useRef<string | null>(null);
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !mk || !fitTo || fitTo.points.length === 0 || fittedKey.current === fitTo.key) return;
        const first = fittedKey.current === null;
        fittedKey.current = fitTo.key;
        // The first fit lands straight away; switching journeys glides.
        fitPoints(mk, map, fitTo.points, insets(FIT_PADDING, fitTo.padding), { maxZoom: 16, animate: !first });
    }, [ready, mk, fitTo]);

    // --- theme swap --------------------------------------------------------
    useEffect(() => {
        basemapRef.current?.setTheme(theme);
    }, [theme]);

    // --- geolocation polling (one 3s loop per map instance) ----------------
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !mk) return;

        let intervalId: NodeJS.Timeout | undefined;
        let cancelled = false;

        startLocationUpdates((latLng) => {
            if (cancelled || (latLng[0] === 0 && latLng[1] === 0)) return;
            const coord = new mk.Coordinate(latLng[0], latLng[1]);
            if (userAnnotationRef.current) {
                userAnnotationRef.current.coordinate = coord;
            } else {
                const { root, content } = pointElement();
                content.style.transform = "translate(-50%, -50%)";
                content.innerHTML = USER_LOCATION_HTML;
                const a = new mk.Annotation(coord, () => root, {
                    enabled: false,
                    displayPriority: mk.AnnotationDisplayPriority.Required,
                    collisionMode: mk.AnnotationCollisionMode.None,
                    animates: false,
                });
                userAnnotationRef.current = a;
                map.addAnnotation(a);
                setHasUserLocation(true);
            }
            onLocationUpdateRef.current?.(latLng[0], latLng[1]);
            if (followUserRef.current) setView(mk, map, latLng);
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
    }, [ready, mk]);

    // --- markers ---------------------------------------------------------
    useEffect(() => {
        const map = mapRef.current;
        const markerManager = markerManagerRef.current;
        if (!ready || !map || !mk || !markerManager) return;

        markerManager.setOptions({
            clusterThreshold: clusterOptions?.threshold,
            clusterRadius: clusterOptions?.maxClusterRadius,
        });
        markerManager.setItems(mapItems);

        // Follow a moving marker.
        if (followMarkerId && !followPaused) {
            const target = mapItems.find((i) => i.id === followMarkerId);
            if (target) {
                const fitWith = followFitWithRef.current;
                if (fitWith) {
                    fitPoints(mk, map, [[target.lat, target.lon], [fitWith[0], fitWith[1]]], insets(55), { maxZoom: 16 });
                } else {
                    setView(mk, map, [target.lat, target.lon]);
                }
            }
        }

        // Waypoint connector line (history page).
        const waypoints = mapItems.filter((i) => i.type === "waypoint");
        const next = waypoints.length >= 2 ? buildWaypointOverlays(mk, waypoints) : [];
        if (waypointOverlaysRef.current.length) map.removeOverlays(waypointOverlaysRef.current);
        waypointOverlaysRef.current = next;
        if (next.length) map.addOverlays(next);
    }, [ready, mk, mapItems, clusterOptions?.threshold, clusterOptions?.maxClusterRadius, followMarkerId, followPaused]);

    // --- one-shot fly-in on zoomInTrigger false→true ---------------------
    const wasZoomInTriggered = useRef(false);
    useEffect(() => {
        const map = mapRef.current;
        if (ready && map && mk && zoomInTrigger && !wasZoomInTriggered.current && zoomInCenter) {
            setView(mk, map, zoomInCenter, 16);
        }
        wasZoomInTriggered.current = !!zoomInTrigger;
    }, [ready, mk, zoomInTrigger, zoomInCenter]);

    // --- route line -----------------------------------------------------
    useEffect(() => {
        const map = mapRef.current;
        if (!ready || !map || !mk) return;
        const next = line ? buildRouteOverlays(mk, line.GeoJson, line.color, currentUrl.textColor) : [];
        if (routeOverlaysRef.current.length) map.removeOverlays(routeOverlaysRef.current);
        routeOverlaysRef.current = next;
        // Lines go under the annotations regardless of add order.
        if (next.length) map.addOverlays(next);
    }, [ready, mk, line, currentUrl.textColor]);

    // --- controls --------------------------------------------------------
    const bottom = options?.buttonPosition === "bottom";
    const zoomTargets = mapItems.filter((i) => i.zoomButton);
    const map = mapRef.current;
    const withMap = (fn: (mk: MapKit, map: MKMap) => void) => () => {
        if (mk && mapRef.current) fn(mk, mapRef.current);
    };
    // Per-marker "zoom to" buttons (always top-right).
    const zoomTargetButtons = zoomTargets.map((item) => (
        <Button
            key={item.id}
            size="icon"
            className="map-control-button"
            onClick={withMap((m, mp) => setView(m, mp, [item.lat, item.lon], 17))}
            dangerouslySetInnerHTML={{ __html: item.zoomButton as string }}
        />
    ));

    return (
        <div
            style={{
                position: "relative",
                height: height,
                width: "100%",
                maxHeight: height ? "" : "50vh",
                zIndex: 1,
                borderRadius: square ? 0 : "var(--radius)",
                overflow: "hidden",
                flexGrow: 1,
                // Match the basemap ground colour so there's no white flash while it loads.
                backgroundColor: theme === "dark" ? "#1b1b1b" : "#f2f1ee",
            }}
        >
            <div id={map_id} ref={containerRef} style={{ position: "absolute", inset: 0 }} />
            {loadError && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
                    {loadError}
                </div>
            )}
            {ready && map && (
                <>
                    {!hideZoomControls && (
                        <div className={`map-ctrl ${bottom ? "map-ctrl-bottom-left" : "map-ctrl-top-left"}`}>
                            <Button size="icon" className="map-control-button" title="Zoom in" onClick={withMap((m, mp) => zoomBy(m, mp, 1))}>
                                <ZoomIn />
                            </Button>
                            <Button size="icon" className="map-control-button" title="Zoom out" onClick={withMap((m, mp) => zoomBy(m, mp, -1))}>
                                <ZoomOut />
                            </Button>
                        </div>
                    )}
                    <div className={`map-ctrl ${bottom ? "map-ctrl-bottom-right" : "map-ctrl-top-right"}`}>
                        {basemapRef.current && <MapVariantToggle manager={basemapRef.current} />}
                        {hasUserLocation && (
                            <Button
                                size="icon"
                                className="map-control-button"
                                title="Show my location"
                                onClick={withMap((m, mp) => {
                                    const c = userAnnotationRef.current?.coordinate;
                                    if (c) setView(m, mp, [c.latitude, c.longitude], 15);
                                })}
                            >
                                <Navigation />
                            </Button>
                        )}
                        {!bottom && zoomTargetButtons}
                    </div>
                    {bottom && zoomTargets.length > 0 && <div className="map-ctrl map-ctrl-top-right">{zoomTargetButtons}</div>}
                </>
            )}
        </div>
    );
}

// --------------------------------------------------------------------------
// camera

type InitialCamera =
    | { kind: "fit"; points: LatLng[] }
    | { kind: "point"; center: LatLng; zoom: number }
    | { kind: "user"; center: LatLng; zoom: number };

function initialCamera(defaultZoom: MapProps["defaultZoom"]): InitialCamera {
    if (
        !defaultZoom ||
        !Array.isArray(defaultZoom) ||
        defaultZoom.length < 1 ||
        (defaultZoom[0] !== "user" && !Array.isArray(defaultZoom[0]))
    ) {
        throw new Error("Missing or invalid defaultZoom");
    }

    if (defaultZoom[0] === "user") return { kind: "user", center: defaultZoom[1] as LatLng, zoom: 12 };
    if (defaultZoom.length === 2) return { kind: "fit", points: [defaultZoom[0] as LatLng, defaultZoom[1] as LatLng] };
    return { kind: "point", center: defaultZoom[0] as LatLng, zoom: 17 };
}

// --------------------------------------------------------------------------
// route + waypoint lines

function toFeatures(geojson: GeoJSON): Feature[] {
    const any = geojson as unknown as { type: string; features?: Feature[] };
    if (any.type === "FeatureCollection") return any.features ?? [];
    return [any as unknown as Feature];
}

/** A feature's line parts as [lat, lon] paths (LineString / MultiLineString). */
function lineParts(feature: Feature): LatLng[][] {
    const g = feature.geometry as { type: string; coordinates: unknown } | null;
    if (!g) return [];
    const toPath = (coords: number[][]) => coords.map(([lon, lat]) => [lat, lon] as LatLng);
    if (g.type === "LineString") return [toPath(g.coordinates as number[][])];
    if (g.type === "MultiLineString") return (g.coordinates as number[][][]).map(toPath);
    return [];
}

/**
 * Each feature's colour/weight/opacity from its `mode`/`segment`/`color`
 * properties, with the region brand colour and the blanket `line.color` as
 * fallbacks. Every line gets a translucent white casing drawn under it.
 */
function buildRouteOverlays(mk: MapKit, geojson: GeoJSON, lineColor: string, textColor: string): Overlay[] {
    const casings: Overlay[] = [];
    const mains: Overlay[] = [];
    for (const feature of toFeatures(geojson)) {
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

        for (const path of lineParts(feature)) {
            const coords = path.map(([lat, lon]) => new mk.Coordinate(lat, lon));
            casings.push(new mk.PolylineOverlay(coords, {
                enabled: false,
                style: new mk.Style({ strokeColor: "#ffffff", strokeOpacity: 0.55, lineWidth: weight + 2, lineCap: "round", lineJoin: "round" }),
            }));
            mains.push(new mk.PolylineOverlay(coords, {
                enabled: false,
                style: new mk.Style({ strokeColor: color, strokeOpacity: opacity, lineWidth: weight, lineCap: "round", lineJoin: "round" }),
            }));
        }
    }
    return [...casings, ...mains];
}

/** Green→yellow→red by average segment speed. */
function speedColor(avgSpeed: number): string {
    const ratio = Math.min(avgSpeed / 100, 1);
    if (ratio <= 0.5) {
        const r = Math.round(255 * (ratio * 2));
        return `rgb(${r},255,0)`;
    }
    const g = Math.round(255 * (1 - (ratio - 0.5) * 2));
    return `rgb(255,${g},0)`;
}

function buildWaypointOverlays(mk: MapKit, items: MapItem[]): Overlay[] {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const overlays: Overlay[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const avgSpeed = ((a.speedKmh ?? 0) + (b.speedKmh ?? 0)) / 2;
        overlays.push(new mk.PolylineOverlay(
            [new mk.Coordinate(a.lat, a.lon), new mk.Coordinate(b.lat, b.lon)],
            {
                // Tapping a segment shows its speed.
                data: { speed: `${avgSpeed.toFixed(1)} km/h`, mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2] },
                style: new mk.Style({ strokeColor: speedColor(avgSpeed), lineWidth: 6, strokeOpacity: 0.95, lineCap: "round", lineJoin: "round" }),
            },
        ));
    }
    return overlays;
}

function showSpeedTip(mk: MapKit, map: MKMap, ref: React.MutableRefObject<Annotation | null>, at: LatLng, text: string) {
    if (ref.current) map.removeAnnotation(ref.current);
    const { root, content } = pointElement();
    content.style.transform = "translate(-50%, calc(-100% - 8px))";
    content.className = "map-popup";
    content.innerHTML = `<div style="font-size:12px;font-weight:600;">${text}</div>`;
    ref.current = new mk.Annotation(new mk.Coordinate(at[0], at[1]), () => root, {
        enabled: false,
        displayPriority: mk.AnnotationDisplayPriority.Required,
        collisionMode: mk.AnnotationCollisionMode.None,
        animates: false,
    });
    map.addAnnotation(ref.current);
}

// --------------------------------------------------------------------------
// geolocation

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

