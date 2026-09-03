'use client';

import leaflet, { MarkerClusterGroup } from "leaflet"
import React, { useEffect, useRef } from "react"
import 'leaflet/dist/leaflet.css';
import { GeoJSON } from "./geojson-types";
import { buttonVariants } from "../ui/button";
import addMapVariantControlControl from "./tile-layer";
import { createMapClusterGroup, createNewMarker, MapItem, updateExistingMarker } from "./markers/create";
import { useUrl } from "@/lib/url-context";

export type LatLng = [number, number];
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

type ItemsOnMap = {
    mapItems: {
        clusters: Record<string, MarkerClusterGroup>
        markers: { id: string, marker: leaflet.Marker, minZoom?: number }[]
        zoomButtons: Record<string, leaflet.Control>
        waypointLines: leaflet.Polyline[]
    }
    zoomButtons: {
        controls: leaflet.Control[] | null
    }
    user: {
        marker: leaflet.Marker | null
        control: leaflet.Control | null
    }
    line: {
        line: leaflet.GeoJSON | null
    }
}

interface MapOptions {
    buttonPosition: "top" | "bottom"
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
}: MapProps) {
    const { currentUrl } = useUrl();
    const mapRef = useRef<leaflet.Map | null>(null);
    const onLocationUpdateRef = useRef(onLocationUpdate);
    const followUserRef = useRef(followUser);
    const followFitWithRef = useRef(followFitWith);
    onLocationUpdateRef.current = onLocationUpdate;
    followUserRef.current = followUser;
    followFitWithRef.current = followFitWith;
    const itemsOnMap = useRef<ItemsOnMap>({
        zoomButtons: { controls: [] },
        user: { marker: null, control: null },
        line: { line: null },
        mapItems: { clusters: {}, markers: [], zoomButtons: {}, waypointLines: [] },
    });

    useEffect(() => {
        if (
            !defaultZoom ||
            !Array.isArray(defaultZoom) ||
            defaultZoom.length < 1 ||
            (defaultZoom[0] !== "user" && !Array.isArray(defaultZoom[0]))
        ) {
            throw new Error("Missing or invalid defaultZoom");
        }

        let map: leaflet.Map | null = mapRef.current;
        if (!map) {
            map = createNewMap(mapRef, map_id);
            addMapVariantControlControl(map, options?.buttonPosition === "bottom" ? "bottomright" : "topright");
            setDefaultZoom(map, defaultZoom);
            addZoomControls(map, itemsOnMap.current.zoomButtons, options?.buttonPosition === "bottom" ? "bottomleft" : "topleft");

            // Add map click handler
            if (onMapClick) {
                map.on('click', (e) => {
                    onMapClick(e.latlng.lat, e.latlng.lng);
                });
            }
        }

        // ⬇️ NEW: Resize observer to detect map container size changes
        const container = document.getElementById(map_id);
        const resizeObserver = new ResizeObserver(() => {
            if (map) {
                map.invalidateSize(); // Force Leaflet to recalculate map dimensions
            }
        });
        if (container) resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [defaultZoom, map_id, options?.buttonPosition]);

    // Geolocation polling lives in its own effect (keyed on the stable map
    // identity, not on mapItems) so it starts exactly one 3s loop per map
    // instance. It used to sit in the mapItems effect below, where its interval
    // id was assigned inside a .then() after the cleanup had already captured
    // `undefined` - so every re-render (3s GPS tick, 10s vehicle poll, 30s
    // useNow tick) leaked another getCurrentPosition loop until the main thread
    // seized up. onLocationUpdateRef/followUserRef are kept current every
    // render, so the callback never needs re-subscribing.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const activeUser = itemsOnMap.current.user;
        const controlPosition = options?.buttonPosition === "bottom" ? "bottomright" : "topright";

        let intervalId: NodeJS.Timeout | undefined;
        let cancelled = false;

        startLocationUpdates((latLng) => {
            addUserMarker(activeUser, map, latLng, controlPosition);
            onLocationUpdateRef.current?.(latLng[0], latLng[1]);
            if (followUserRef.current) {
                map.panTo(latLng, { animate: true, duration: 0.5 });
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
    }, [map_id, options?.buttonPosition]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const activeMapItems = itemsOnMap.current;

        if (!activeMapItems.mapItems.clusters) {
            activeMapItems.mapItems.clusters = {};
        }
        if (!activeMapItems.mapItems.zoomButtons) {
            activeMapItems.mapItems.zoomButtons = {};
        }

        const oldMarkers = activeMapItems.mapItems.markers;
        const oldClusters = activeMapItems.mapItems.clusters;
        const oldZoomControls = activeMapItems.mapItems.zoomButtons;
        const oldMarkerById = new Map(oldMarkers.map((m) => [m.id, m.marker]));

        // Only markers no longer present in the new list are actually
        // removed; markers that persist are updated in place further down
        // (position/icon/popup) instead of being torn down and re-added,
        // which previously made every marker visibly flicker on each poll.
        const newIds = new Set(mapItems.map((i) => i.id));
        oldMarkers.forEach(({ id, marker }) => {
            if (!newIds.has(id)) map.removeLayer(marker);
        });

        // Cluster groups are rebuilt wholesale per type - only relevant past
        // clusterOptions.threshold, which no current caller's marker counts
        // reach, so this isn't a flicker concern in practice.
        Object.values(oldClusters).forEach((cluster) => {
            map.removeLayer(cluster);
        });

        Object.values(oldZoomControls).forEach((control) => {
            map.removeControl(control);
        });

        activeMapItems.mapItems.markers = [];
        activeMapItems.mapItems.clusters = {};
        activeMapItems.mapItems.zoomButtons = {};

        const groupedByType: Record<string, MapItem[]> = {};
        mapItems.forEach((item) => {
            if (!groupedByType[item.type]) groupedByType[item.type] = [];
            groupedByType[item.type].push(item);
        });

        Object.entries(groupedByType).forEach(([type, items]) => {
            const useCluster = items.length >= (clusterOptions?.threshold ?? 100);
            const updatedMarkers: typeof activeMapItems.mapItems.markers = [];

            let clusterGroup: MarkerClusterGroup | null = null;
            if (useCluster) {
                clusterGroup = createMapClusterGroup(clusterOptions?.maxClusterRadius);
                activeMapItems.mapItems.clusters[type] = clusterGroup;
            }

            items.forEach((item) => {
                const existing = oldMarkerById.get(item.id);
                let marker: leaflet.Marker;

                if (existing) {
                    marker = updateExistingMarker(item, existing);
                } else {
                    marker = createNewMarker(item);
                }

                // Below its minZoom, the marker is built (so it's ready to
                // add instantly once the rider zooms in - see the zoomend
                // listener below) but kept off the map until then.
                const belowMinZoom = item.minZoom !== undefined && map.getZoom() < item.minZoom;

                if (useCluster && clusterGroup) {
                    clusterGroup.addLayer(marker);
                } else if (belowMinZoom) {
                    if (map.hasLayer(marker)) map.removeLayer(marker);
                } else if (!existing || !map.hasLayer(marker)) {
                    marker.addTo(map);
                }

                updatedMarkers.push({ id: item.id, marker, minZoom: item.minZoom });

                if (followMarkerId && item.id === followMarkerId) {
                    const fitWith = followFitWithRef.current;
                    if (fitWith) {
                        map.fitBounds(
                            leaflet.latLngBounds([item.lat, item.lon], fitWith),
                            { padding: [55, 55], maxZoom: 16, animate: true, duration: 0.5 }
                        );
                    } else {
                        map.panTo([item.lat, item.lon], { animate: true, duration: 0.5 });
                    }
                }

                if (oldZoomControls[item.id]) {
                    map.removeControl(oldZoomControls[item.id]);
                    delete oldZoomControls[item.id];
                }

                if (item.zoomButton) {
                    const zoomControl = new leaflet.Control({ position: "topright" });
                    zoomControl.onAdd = () => {
                        const button = leaflet.DomUtil.create(
                            "button",
                            buttonVariants({ variant: "default", size: "icon" })
                        );
                        button.innerHTML = item.zoomButton ?? "Zoom";
                        button.onclick = () => {
                            map.flyTo(marker.getLatLng(), 17);
                        };
                        return button;
                    };
                    zoomControl.addTo(map);
                    activeMapItems.mapItems.zoomButtons[item.id] = zoomControl;
                }
            });

            if (useCluster && clusterGroup) {
                map.addLayer(clusterGroup);
            }

            activeMapItems.mapItems.markers.push(...updatedMarkers);

            // Handle waypoints connection line
            if (type === 'waypoint') {
                // Remove every previously-drawn segment (all of them, not
                // just one) before drawing the new set.
                activeMapItems.mapItems.waypointLines.forEach((segment) => {
                    map.removeLayer(segment);
                });
                activeMapItems.mapItems.waypointLines = [];

                // Create new waypoint line if there are at least 2 points
                if (items.length >= 2) {
                    // Sort items by id to maintain consistent order
                    const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));

                    // Create segments between consecutive points
                    const segments: leaflet.Polyline[] = [];
                    for (let i = 0; i < sortedItems.length - 1; i++) {
                        const point1 = sortedItems[i];
                        const point2 = sortedItems[i + 1];

                        const avgSpeed = ((point1.speedKmh ?? 0) + (point2.speedKmh ?? 0)) / 2;

                        // Calculate color based on speed
                        // Green (slow) to Yellow (medium) to Red (fast)
                        const maxSpeed = 100; // Adjust based on your speed range
                        const speedRatio = Math.min(avgSpeed / maxSpeed, 1);

                        let color;
                        if (speedRatio <= 0.5) {
                            // Green to Yellow
                            const ratio = speedRatio * 2;
                            const red = Math.round(255 * ratio);
                            const green = 255;
                            const blue = 0;
                            color = `rgb(${red},${green},${blue})`;
                        } else {
                            // Yellow to Red
                            const ratio = (speedRatio - 0.5) * 2;
                            const red = 255;
                            const green = Math.round(255 * (1 - ratio));
                            const blue = 0;
                            color = `rgb(${red},${green},${blue})`;
                        }

                        const segment = leaflet.polyline(
                            [[point1.lat, point1.lon], [point2.lat, point2.lon]],
                            {
                                color,
                                weight: 6,
                                opacity: 0.95,
                                smoothFactor: 1.5,
                                className: "map-route-line",
                            }
                        );

                        // Add tooltip showing speed
                        segment.bindTooltip(`${avgSpeed.toFixed(1)} km/h`, {
                            permanent: false,
                            direction: 'top'
                        });

                        segment.addTo(map);
                        segments.push(segment);
                    }

                    // Store every segment so all of them can be removed later.
                    activeMapItems.mapItems.waypointLines = segments;
                    // Apply rounded corners to all line segments
                    const existingSegments = map.getPane('overlayPane')?.getElementsByClassName('leaflet-interactive') || [];
                    Array.from(existingSegments).forEach(el => {
                        if (el instanceof SVGPathElement) {
                            el.setAttribute('stroke-linecap', 'round');
                            el.setAttribute('stroke-linejoin', 'round');
                        }
                    });
                }
            }
        });

        Object.keys(oldZoomControls).forEach((itemId) => {
            if (!mapItems.find((i) => i.id === itemId && i.zoomButton)) {
                map.removeControl(oldZoomControls[itemId]);
                delete oldZoomControls[itemId];
            }
        });

        itemsOnMap.current.mapItems = activeMapItems.mapItems;
    }, [mapItems, options?.buttonPosition, clusterOptions?.threshold, clusterOptions?.maxClusterRadius, followMarkerId]);

    // Markers with a minZoom are built above but only actually added to the
    // map once zoomed in enough - toggle them on/off as the rider pans and
    // zooms, without waiting for mapItems to change again.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const handleZoom = () => {
            const zoom = map.getZoom();
            itemsOnMap.current.mapItems.markers.forEach(({ marker, minZoom }) => {
                if (minZoom === undefined) return;
                const shouldShow = zoom >= minZoom;
                const isShown = map.hasLayer(marker);
                if (shouldShow && !isShown) marker.addTo(map);
                else if (!shouldShow && isShown) map.removeLayer(marker);
            });
        };
        map.on("zoomend", handleZoom);
        return () => {
            map.off("zoomend", handleZoom);
        };
    }, [map_id]);

    // One-shot fly-in on the false→true edge of zoomInTrigger (e.g. the
    // moment live tracking starts) - not a held state, so a stale/missing
    // center or a re-render with the same true value does nothing further.
    // setView, not flyTo: flyTo animates _zoom progressively frame-by-frame,
    // so a followUser/followMarkerId panTo landing a moment later (its own
    // internal setView reads the CURRENT _zoom) would catch it still mid-flight
    // and snap back to the old zoom. setView applies the target zoom to
    // _zoom immediately (only the visual pan/tile-fade animates), so a panTo
    // straight after sees the new zoom already in place and just pans within it.
    const wasZoomInTriggered = useRef(false);
    useEffect(() => {
        const map = mapRef.current;
        if (map && zoomInTrigger && !wasZoomInTriggered.current && zoomInCenter) {
            map.setView(zoomInCenter, 16, { animate: true, duration: 0.5 });
        }
        wasZoomInTriggered.current = !!zoomInTrigger;
    }, [zoomInTrigger, zoomInCenter]);

    useEffect(() => {
        const activeMapItems = itemsOnMap.current;
        const map = mapRef.current;
        if (line && activeMapItems && map) {
            const activeNavigation = activeMapItems.line;
            if (activeNavigation.line) {
                map.removeLayer(activeNavigation.line);
            }
            const leafletLine = leaflet.geoJSON(line.GeoJson, {
                //@ts-expect-error it does exist
                smoothFactor: 1.5,
                style: function (feature) {
                    const mode = feature?.properties?.mode;
                    // Tracked-vehicle mode splits the trip's full shape into
                    // before-boarding / active / after-alighting segments -
                    // the parts outside the rider's own leg are grayed out
                    // even though the vehicle itself continues past them.
                    const segment = feature?.properties?.segment;
                    if (segment === "before" || segment === "after") {
                        return {
                            color: "#9ca3af",
                            weight: 5,
                            opacity: 0.6,
                            className: "map-route-line",
                        };
                    }

                    // A feature can carry its own route color (e.g. each
                    // transit leg colored like its own badge) - takes
                    // priority over the single blanket line.color/brand color.
                    const featureColor = feature?.properties?.color as string | undefined
                    const baseColor =
                        featureColor ||
                        (line.color === "" ? mode === "walk"
                            ? "#64748b"   // neutral slate, matches the app's own theme
                            : mode === "transit"
                                ? currentUrl.textColor || "#374151"   // this region's own brand color
                                : "#6ec3db"  // fallback
                            : line.color);

                    return {
                        color: baseColor,
                        weight: 6,
                        opacity: 0.95,
                        className: "map-route-line",
                    };
                },
            });

            activeMapItems.line.line = leafletLine;
            leafletLine.addTo(map);
        }
    }, [line, currentUrl.textColor, map_id]);

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
            }}
        />
    );
}

function createNewMap(ref: React.MutableRefObject<leaflet.Map | null>, map_id: string): leaflet.Map {
    let map: leaflet.Map | null = ref.current
    if (!map || map_id === "") {
        if (map_id.length < 3) throw new Error("Map ID is too short, must be at least 3 characters")
        if (document.getElementById(map_id) === null) throw new Error("Element with Map ID does NOT exist in the DOM")
        map = leaflet.map(map_id, { zoomControl: false });
        ref.current = map;
    }
    return map
}

function setDefaultZoom(map: leaflet.Map, defaultZoom: [LatLng] | [LatLng, LatLng] | ["user", BackupLatLng]) {
    if (defaultZoom[0] === "user") {
        getUserLocation().then((res) => {
            map.setView(res, 17)
        }).catch(() => {
            map.setView(defaultZoom[1], 17)
        })
    } else if (defaultZoom.length === 2) {
        const bounds = leaflet.latLngBounds(defaultZoom[0], defaultZoom[1]);
        map.fitBounds(bounds);
    } else {
        map.setView(defaultZoom[0], 17)
    }
}

function addZoomControls(map: leaflet.Map, activeMapItemsZoom: ItemsOnMap["zoomButtons"], position: leaflet.ControlPosition = "topleft") {
    if (activeMapItemsZoom.controls && activeMapItemsZoom.controls.length > 0) {
        activeMapItemsZoom.controls.forEach((control) => map.removeControl(control));
    }

    function stopMapEvents(e: Event) {
        e.stopPropagation();
        if ("preventDefault" in e) e.preventDefault();
    }

    const zoomInControl = new leaflet.Control.Zoom({ position });
    zoomInControl.onAdd = () => {
        const button = leaflet.DomUtil.create('button', buttonVariants({ variant: "default", size: "icon" }));
        button.type = "button";
        button.title = "Zoom in";
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-zoom-in"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
        button.addEventListener("pointerup", (e) => {
            stopMapEvents(e);
            map.zoomIn();
        });
        ["mousedown", "dblclick", "pointerdown"].forEach((event) => button.addEventListener(event, stopMapEvents));
        return button;
    };

    const zoomOutControl = new leaflet.Control({ position });
    zoomOutControl.onAdd = () => {
        const button = leaflet.DomUtil.create('button', buttonVariants({ variant: "default", size: "icon" }));
        button.type = "button";
        button.title = "Zoom out";
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-zoom-out"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
        button.addEventListener("pointerup", (e) => {
            stopMapEvents(e);
            map.zoomOut();
        });
        ["mousedown", "dblclick", "pointerdown"].forEach((event) => button.addEventListener(event, stopMapEvents));
        return button;
    };

    map.addControl(zoomInControl);
    map.addControl(zoomOutControl);
    activeMapItemsZoom.controls = [zoomInControl, zoomOutControl];
}

function addUserMarker(activeMapItemsUser: ItemsOnMap["user"], map: leaflet.Map, userLocation: [number, number], position: leaflet.ControlPosition = "topright") {
    let userMarker = activeMapItemsUser.marker;
    const userControl = activeMapItemsUser.control;

    if (userLocation[0] === 0 && userLocation[1] === 0) return;

    if (userMarker) {
        userMarker.setLatLng(userLocation);
    } else {
        userMarker = leaflet.marker(userLocation, {
            icon: leaflet.divIcon({
                className: "flex items-center justify-center",
                html: `<div style="position: relative; width: 24px; height: 24px;"><img class="user-marker-arrow" src="/vehicle_icons/location.png" style="width: 24px; height: 24px;"/></div>`,
                iconAnchor: [12, 30],
            }),
            zIndexOffset: 1000,
        });

        userMarker.addTo(map);
        activeMapItemsUser.marker = userMarker;
    }

    if (!userControl) {
        const userLocationControl = new leaflet.Control({ position });
        userLocationControl.onAdd = () => {
            const button = leaflet.DomUtil.create("button", buttonVariants({ variant: "default", size: "icon" }));
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-navigation"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
            button.onclick = () => {
                map.flyTo(userMarker.getLatLng(), 15);
            };
            return button;
        };
        activeMapItemsUser.control = userLocationControl;
        map.addControl(userLocationControl);
    }
}

async function checkPermission(): Promise<boolean> {
    if (!navigator.permissions) {
        // Permissions API not supported, fallback to trying getCurrentPosition
        return true;
    }
    try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        return status.state === "granted" || status.state === "prompt";
    } catch {
        // If permissions API fails, assume prompt or granted
        return true;
    }
}

async function startLocationUpdates(callback: (latLng: LatLng) => void): Promise<NodeJS.Timeout | null> {
    // First check permission
    const hasPermission = await checkPermission();
    if (!hasPermission) {
        console.warn("Location permission denied or unavailable. Not starting location updates.");
        return null;
    }

    // Guards against out-of-order fixes: getCurrentPosition can take up to its
    // 10s timeout while the interval ticks every 3s, so an earlier call can
    // resolve after a later one and would otherwise overwrite a fresher fix
    // with a stale one. Only apply the most recently *issued* fix that resolves.
    let requestId = 0;
    let appliedId = 0;

    try {
        // Try initial location fetch
        const id = ++requestId;
        const latLng = await getUserLocation();
        appliedId = id;
        callback(latLng);
    } catch (error) {
        console.error("Failed to get initial location:", error);
        // Don't start interval if initial location failed
        return null;
    }

    // Start interval for repeated location updates only if initial fetch succeeded
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
            (position) => {
                resolve([position.coords.latitude, position.coords.longitude]);
            },
            (error) => {
                console.error("Error getting location:", error);
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000,
            }
        );
    });
}



