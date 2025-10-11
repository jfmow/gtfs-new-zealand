import leaflet, { MarkerClusterGroup } from "leaflet"
import React, { useEffect, useRef } from "react"
import 'leaflet/dist/leaflet.css';
import { GeoJSON } from "./geojson-types";
import { buttonVariants } from "../ui/button";
import addMapVariantControlControl from "./tile-layer";
import { createMapClusterGroup, createNewMarker, MapItem, updateExistingMarker } from "./markers/create";

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
}

type ItemsOnMap = {
    mapItems: {
        clusters: Record<string, MarkerClusterGroup>
        markers: { id: string, marker: leaflet.Marker }[]
        zoomButtons: Record<string, leaflet.Control>
    }
    zoomButtons: {
        controls: leaflet.Control[] | null
    }
    user: {
        marker: leaflet.Marker | null
        control: leaflet.Control | null
    }
    compass: {
        control: leaflet.Control | null
    }
    line: {
        line: leaflet.GeoJSON | null
    }
}
export default function Map({
    mapItems = [],
    map_id,
    height,
    defaultZoom,
    line,
}: MapProps) {
    const mapRef = useRef<leaflet.Map | null>(null);
    const itemsOnMap = useRef<ItemsOnMap>({
        compass: { control: null },
        zoomButtons: { controls: [] },
        user: { marker: null, control: null },
        line: { line: null },
        mapItems: { clusters: {}, markers: [], zoomButtons: {} },
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
            addMapVariantControlControl(map);
            setDefaultZoom(map, defaultZoom);
            addZoomControls(map, itemsOnMap.current.zoomButtons);
            addUserCompassControl(itemsOnMap.current.compass, map);
        }

        // ⬇️ NEW: Resize observer to detect map container size changes
        const container = document.getElementById(map_id);
        const resizeObserver = new ResizeObserver(() => {
            if (map) {
                map.invalidateSize(); // Force Leaflet to recalculate map dimensions
            }
        });
        if (container) resizeObserver.observe(container);

        // Orientation tracking
        const handleOrientation = (e: DeviceOrientationEvent) => {
            let heading = null;

            if ("webkitCompassHeading" in e) {
                //eslint-disable-next-line @typescript-eslint/no-explicit-any
                heading = (e as any).webkitCompassHeading;
            } else if (e.alpha !== null) {
                heading = 360 - e.alpha;
            }

            if (typeof heading === "number" && !isNaN(heading)) {
                document.documentElement.style.setProperty(
                    "--user-arrow-rotation",
                    `${heading}deg`
                );
            }
        };

        window.addEventListener("deviceorientation", handleOrientation);

        return () => {
            window.removeEventListener("deviceorientation", handleOrientation);
            resizeObserver.disconnect(); // ⬅️ NEW cleanup
        };
    }, [defaultZoom, map_id]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | undefined;
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

        oldMarkers.forEach(({ marker }) => {
            map.removeLayer(marker);
        });
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
            const useCluster = items.length >= 100;
            const updatedMarkers: typeof activeMapItems.mapItems.markers = [];

            let clusterGroup: MarkerClusterGroup | null = null;
            if (useCluster) {
                clusterGroup = createMapClusterGroup();
                activeMapItems.mapItems.clusters[type] = clusterGroup;
            }

            items.forEach((item) => {
                const existing = oldMarkers.find((m) => m.id === item.id);
                let marker: leaflet.Marker;

                if (existing) {
                    marker = updateExistingMarker(item, existing.marker);
                } else {
                    marker = createNewMarker(item);
                }

                if (useCluster && clusterGroup) {
                    clusterGroup.addLayer(marker);
                } else {
                    marker.addTo(map);
                }

                updatedMarkers.push({ id: item.id, marker });

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
        });

        Object.keys(oldZoomControls).forEach((itemId) => {
            if (!mapItems.find((i) => i.id === itemId && i.zoomButton)) {
                map.removeControl(oldZoomControls[itemId]);
                delete oldZoomControls[itemId];
            }
        });

        itemsOnMap.current.mapItems = activeMapItems.mapItems;

        startLocationUpdates((latLng) => {
            addUserMarker(activeMapItems.user, map, latLng);
        }).then((res) => {
            if (res) intervalId = res;
        });

        return () => clearInterval(intervalId);
    }, [mapItems]);

    useEffect(() => {
        const activeMapItems = itemsOnMap.current;
        const map = mapRef.current;
        if (line && activeMapItems && map) {
            const activeNavigation = activeMapItems.line;
            if (activeNavigation.line) {
                map.removeLayer(activeNavigation.line);
            }
            const leafletLine = leaflet.geoJSON(line.GeoJson, {
                //@ts-expect-error: is real config value
                smoothFactor: 1.5,
                style: function () {
                    return {
                        color: line.color !== "" ? line.color : "#db6ecb",
                        weight: 4,
                    };
                },
            });
            activeMapItems.line.line = leafletLine;
            leafletLine.addTo(map);
        }
    }, [line]);

    return (
        <div
            id={map_id}
            style={{
                height: height,
                width: "100%",
                maxHeight: height ? "" : "50vh",
                zIndex: 1,
                borderRadius: "10px",
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
            map.setView(res, 15)
        }).catch(() => {
            map.setView(defaultZoom[1], 15)
        })
    } else if (defaultZoom.length === 2) {
        const bounds = leaflet.latLngBounds(defaultZoom[0], defaultZoom[1]);
        map.fitBounds(bounds);
    } else {
        map.setView(defaultZoom[0], 15)
    }
}

function addZoomControls(map: leaflet.Map, activeMapItemsZoom: ItemsOnMap["zoomButtons"]) {
    if (activeMapItemsZoom.controls && activeMapItemsZoom.controls.length > 0) {
        activeMapItemsZoom.controls.forEach((control) => map.removeControl(control));
    }

    function stopMapEvents(e: Event) {
        e.stopPropagation();
        if ("preventDefault" in e) e.preventDefault();
    }

    const zoomInControl = new leaflet.Control.Zoom({ position: 'topleft' });
    zoomInControl.onAdd = () => {
        const button = leaflet.DomUtil.create('button', buttonVariants({ variant: "default", size: "icon" }));
        button.type = "button";
        button.title = "Zoom in";
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
        button.addEventListener("pointerup", (e) => {
            stopMapEvents(e);
            map.zoomIn();
        });
        ["mousedown", "dblclick", "pointerdown"].forEach((event) => button.addEventListener(event, stopMapEvents));
        return button;
    };

    const zoomOutControl = new leaflet.Control({ position: 'topleft' });
    zoomOutControl.onAdd = () => {
        const button = leaflet.DomUtil.create('button', buttonVariants({ variant: "default", size: "icon" }));
        button.type = "button";
        button.title = "Zoom out";
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-out"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`;
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

function addUserMarker(activeMapItemsUser: ItemsOnMap["user"], map: leaflet.Map, userLocation: [number, number]) {
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
        const userLocationControl = new leaflet.Control({ position: "topright" });
        userLocationControl.onAdd = () => {
            const button = leaflet.DomUtil.create("button", buttonVariants({ variant: "default", size: "icon" }));
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
            button.onclick = () => {
                map.flyTo(userMarker.getLatLng(), 15);
            };
            return button;
        };
        activeMapItemsUser.control = userLocationControl;
        map.addControl(userLocationControl);
    }
}

function addUserCompassControl(activeMapItemsCompass: ItemsOnMap["compass"], map: leaflet.Map) {
    const oldCompassControl = activeMapItemsCompass.control
    if (oldCompassControl) {
        map.removeControl(oldCompassControl)
    }
    //@ts-expect-error it does infant exist
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        const compassControl = new leaflet.Control({ position: 'topright' });
        compassControl.onAdd = () => {
            const button = leaflet.DomUtil.create('button', buttonVariants({ variant: "default", size: "icon" }));
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-compass"><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/></svg>';
            button.onclick = async () => {
                //@ts-expect-error it does infant exist
                await DeviceOrientationEvent.requestPermission();
            };
            return button;
        };
        activeMapItemsCompass.control = compassControl;
        map.addControl(compassControl);
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

    try {
        // Try initial location fetch
        const latLng = await getUserLocation();
        callback(latLng);
    } catch (error) {
        console.error("Failed to get initial location:", error);
        // Don't start interval if initial location failed
        return null;
    }

    // Start interval for repeated location updates only if initial fetch succeeded
    return setInterval(async () => {
        try {
            const latLng = await getUserLocation();
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



