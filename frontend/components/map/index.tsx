import { memo, useEffect, useRef } from "react";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
import L, { Map, Marker, MarkerClusterGroup } from 'leaflet';
import "leaflet.markercluster";
import { buttonVariants } from "../ui/button";
import { ShapesResponse, GeoJSON } from "./geojson-types";
import 'leaflet/dist/leaflet.css';
import { TrainsApiResponse } from "../services/types";
import { ApiFetch } from "@/lib/url-context";
import { getUserLocation, useUserLocation } from "@/lib/userLocation";

interface MapItem {
    lat: number;
    lon: number;
    icon: string;
    id: string;
    routeID: string;
    zIndex: number;
    onClick?: () => void;
    description: string;
    showDiscriptionAlways?: boolean
}

interface MapWithVariantProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navPoints?: GeoJSON; // Define a more specific type if available
    mapItems?: MapItem[];
    mapID: string;
    onMapItemClick?: (id: string) => void;
    routeLine?: {
        routeId: string;
        tripId: string;
    };
    height: string;
    zoom?: number;
    variant: "userLocation" | "userAndFirstPoint" | "firstAndSecondItem" | "firstItem";
}

const LeafletMap = memo(function LeafletMap({
    navPoints,
    mapItems,
    mapID = "map-abc",
    onMapItemClick = () => { },
    routeLine,
    height = "500px",
    zoom = 13,
    variant
}: MapWithVariantProps) {
    const mapRef = useRef<Map | null>(null);
    const markersRef = useRef<Marker[]>([]);
    const clusterGroupRef = useRef<MarkerClusterGroup | null>(null);
    const userLocationMarkerRef = useRef<Marker[]>([]);
    const routeLineLayerRef = useRef<L.GeoJSON | null>(null)
    const vehicleFlyControlRef = useRef<L.Control | null>(null)
    const userLocationFlyControlRef = useRef<L.Control | null>(null)
    const { location, error, loading } = useUserLocation(true)

    useEffect(() => {
        if (loading) return
        const userLocation: [number, number] = location[0] === 0 ? [-36.85971694520651, 174.76042890091796] : location
        const hasUserLocation = error ? false : true

        let map: Map;
        if (!mapRef.current) {
            map = L.map(mapID);
            mapRef.current = map;

            switch (variant) {
                case "userLocation":
                    if (!hasUserLocation) {
                        if (mapItems && mapItems.length > 0) setMapView(map, zoom, [mapItems[0].lat, mapItems[0].lon]);
                    } else {
                        setMapView(map, zoom, userLocation);
                    }
                    break;
                case "userAndFirstPoint":
                    if (!hasUserLocation) {
                        if (mapItems && mapItems.length > 0) setMapView(map, zoom, [mapItems[0].lat, mapItems[0].lon]);
                    } else {
                        if (mapItems && mapItems.length > 0) setMapView(map, zoom, userLocation, [mapItems[0].lat, mapItems[0].lon]);
                    }
                    break;
                case "firstAndSecondItem":
                    if (mapItems && mapItems.length > 1) setMapView(map, zoom, [mapItems[0].lat, mapItems[0].lon], [mapItems[1].lat, mapItems[1].lon]);
                    break;
                case "firstItem":
                    if (mapItems && mapItems.length > 0) setMapView(map, zoom, [mapItems[0].lat, mapItems[0].lon]);
                    break;
            }

        } else {
            map = mapRef.current;
        }

        setMapTileTheme(map, "light");

        if (routeLine && routeLine.routeId) {
            showRouteLine(map, routeLine.routeId, routeLine.tripId, routeLineLayerRef);
        }

        if (navPoints) {
            showNavigationRouteLineWalking(map, navPoints);
        }

        if (hasUserLocation) {
            userLocationMarkerRef.current.forEach(marker => map.removeLayer(marker));
            userLocationMarkerRef.current = [];
            addMarkerToMap(userLocationMarkerRef.current, map, null, userLocation, "user", "", "user", () => console.log("Stop clicking yourself you fool"), 9999, "You");
            addUserLocationButton(map, userLocation, userLocationFlyControlRef);
        }
    }, [error, loading, location, mapID, mapItems, navPoints, routeLine, variant, zoom]);

    useEffect(() => {
        const map = mapRef.current;
        let Interval: NodeJS.Timeout | null = null;
        if (map && !error && !loading) {
            const fetchLocation = async () => {
                try {
                    const location = await getUserLocation()
                    userLocationMarkerRef.current.forEach(marker => map.removeLayer(marker));
                    userLocationMarkerRef.current = [];
                    addMarkerToMap(userLocationMarkerRef.current, map, null, location, "user", "", "user", () => console.log("Stop clicking yourself you fool"), 9999, "You");
                    addUserLocationButton(map, location, userLocationFlyControlRef);
                } catch {
                    console.error("Error fetching location:", error)
                }
            }
            Interval = setInterval(fetchLocation, 3000);
        }
        return () => {
            if (Interval) {
                clearInterval(Interval)
            }
        }
    }, [error, loading])


    useEffect(() => {
        const map = mapRef.current;

        if (map && mapItems && typeof onMapItemClick === 'function' && variant) {
            renderMapItems(map, markersRef, clusterGroupRef, mapItems, onMapItemClick);

            if (variant === "firstItem" || variant === "userAndFirstPoint") {
                addSingleVehicleLocationButton(map, [mapItems[0].lat, mapItems[0].lon], vehicleFlyControlRef);
            }
        }
    }, [mapItems, onMapItemClick, variant]);


    return (
        <div id={mapID} style={{ height: height, width: '100%', maxHeight: height ? "" : "50vh", zIndex: 1, borderRadius: "10px" }}></div>
    );
})

export default LeafletMap;

function renderMapItems(
    map: Map,
    markersRef: React.MutableRefObject<Marker[]>,
    clusterGroupRef: React.MutableRefObject<MarkerClusterGroup | null>,
    mapItems: MapItem[],
    onMapItemClick: (id: string) => void
) {
    if (!map || !markersRef.current) return;

    const visibleItems = mapItems
    debugger
    const clusterGroup = clusterGroupRef.current || createMapClusterGroup();
    clusterGroup.clearLayers();
    clusterGroupRef.current = clusterGroup;
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current.length = 0;

    if (visibleItems.length > 0) {
        const useCluster = visibleItems.length > 100 ? clusterGroup : null;
        visibleItems.forEach(item => {
            addMarkerToMap(
                markersRef.current,
                map,
                useCluster,
                [item.lat, item.lon],
                item.icon,
                item.routeID,
                item.id,
                item.onClick ? item.onClick : onMapItemClick,
                item.zIndex,
                item.description,
                item.showDiscriptionAlways
            );
        });
    }

    if (visibleItems.length > 100) map.addLayer(clusterGroup);
}


function addMarkerToMap(
    markersRef: Marker[],
    map: Map,
    markerClusterGroup: MarkerClusterGroup | null,
    location: [number, number],
    icon = "",
    routeID: string,
    itemID: string,
    onClick: (id: string) => void,
    zIndex: number,
    hoverMessage: string,
    displayHoverAlways?: boolean
) {
    if (!icon) {
        throw new Error("Icon is undefined, must be bus, train, ferry, etc.");
    }
    if (location.length !== 2) {
        return;
    }

    const iconUrl = routesWithIcons.includes(routeID)
        ? `/route_icons/${routeID}.png`
        : getIconUrl(icon);

    let customIcon

    if (displayHoverAlways) {

        customIcon = L.divIcon({
            className: "flex items-center justify-center",
            html: `
                  <div style="position: relative; width: max-content; height: 36px;">
                    <span
                      style="
                        position: absolute;
                        top: -12px; /* Adjust to control distance above icon */
                        left: 50%;
                        transform: translateX(-50%);
                        color: white;
                        font-size: 12px;
                        font-weight: bold;
                        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000,
                          1px 1px 0 #000;
                        white-space: nowrap; /* Prevent text wrapping */
                        padding: 0 5px; /* Add padding to prevent text touching edges */
                      "
                    >
                      ${hoverMessage}
                    </span>
                    <img
                      className="w-4 h-4"
                      src="${iconUrl}"
                      style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 24px; height: 24px;"
                    />
                  </div>
                `,
            iconAnchor: [12, 30],
        });
    } else {
        customIcon = L.icon({
            iconUrl,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24]
        });
    }


    const marker = L.marker(location, { icon: customIcon, zIndexOffset: zIndex });

    if (onClick && typeof onClick === 'function' && itemID && itemID !== "") {
        marker.on('click', () => onClick(itemID));
    }

    // Add a hover message (tooltip) above the marker
    if (hoverMessage !== "" && !displayHoverAlways) {
        marker.bindTooltip(hoverMessage, {
            direction: 'top',       // Positions the tooltip above the marker
            offset: [0, -24],       // Adjusts the tooltip position
            permanent: false,       // Tooltip only appears on hover
            opacity: 0.9,           // Adjust opacity if needed
            className: 'custom-tooltip' // Optional: Add a custom class for styling
        });
    }

    markersRef.push(marker);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    markerClusterGroup ? markerClusterGroup.addLayer(marker) : marker.addTo(map);
}

function getIconUrl(icon: string): string {
    const iconMap: Record<string, string> = {
        bus: "/vehicle_icons/bus.png",
        train: "/vehicle_icons/train.png",
        ferry: "/vehicle_icons/ferry.png",
        "school bus": "/vehicle_icons/school bus.png",
        dot: "/vehicle_icons/stop_dot.png",
        pin: "/vehicle_icons/pin.png",
        user: "/vehicle_icons/location.png",
        "stop marker": "/vehicle_icons/stop marker.png",
        "end marker": "/vehicle_icons/end marker.png",
        "marked stop marker": "/vehicle_icons/marked stop marker.png",
    };
    return iconMap[icon.toLowerCase()] || icon; // Return icon URL or use the provided custom URL
}

function setMapView(map: Map, zoom: number, firstItem: [number, number], secondItem?: [number, number]) {
    if (firstItem && !secondItem) {
        map.setView(firstItem, zoom);
    } else if (firstItem && secondItem) {
        const bounds = L.latLngBounds(firstItem, secondItem);
        map.fitBounds(bounds);
    } else if (secondItem && !firstItem) {
        map.setView(secondItem, zoom);
    }
}

function setMapTileTheme(map: Map, theme: string) {
    const tileUrl = theme === "light"
        ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    L.tileLayer(tileUrl, {
        maxZoom: 19,
        minZoom: 10,
        attribution: '&copy; <a href="https://www.carto.com/attributions">CARTO</a>'
    }).addTo(map);
}

function showRouteLine(map: Map, routeId: string, tripId: string, routeLineRef: React.MutableRefObject<L.GeoJSON | null>) {
    if (routeId) {
        const showRouteLineOnMap = async (map: Map) => {
            try {
                const form = new FormData()
                form.set("tripId", tripId)
                form.set("routeId", routeId)
                const response = await ApiFetch(`map/geojson/shapes`, {
                    method: "POST",
                    body: form
                });
                const data: TrainsApiResponse<ShapesResponse> = await response.json();

                if (!response.ok) {
                    console.error(data.message)
                    return
                }

                const filteredData = data.data.geojson;
                // Add GeoJSON data to the map with a smooth line
                const routeLine = L.geoJSON(filteredData, {
                    //@ts-expect-error: is real config value
                    smoothFactor: 1.5, // Adjust the smoothness level
                    style: function () {
                        return { color: data.data.color !== "" ? `#${data.data.color}` : '#393939', weight: 4 }; // Customize the line color and thickness
                    }
                })
                map.addLayer(routeLine)
                if (routeLineRef.current) {
                    map.removeLayer(routeLineRef.current)
                }
                routeLineRef.current = routeLine
            } catch (error) {
                console.error(error)
            }

        };

        showRouteLineOnMap(map);
    }
}

function showNavigationRouteLineWalking(map: Map, navPoints: GeoJSON) {
    if (!navPoints || navPoints.features.length < 1) return
    const showNavLineOnMap = async (map: L.Map) => {
        // Add GeoJSON data to the map with a smooth line
        L.geoJSON(navPoints, {
            //@ts-expect-error: is real config value
            smoothFactor: 1.5, // Adjust the smoothness level
            style: function () {
                return { color: '#db6ecb', weight: 4 }; // Customize the line color and thickness
            }
        }).addTo(map);
    };

    showNavLineOnMap(map);
}

function addUserLocationButton(map: Map, userLocation: [number, number], controlRef: React.MutableRefObject<L.Control | null>) {
    if (controlRef.current !== null) {
        map.removeControl(controlRef.current)
    }
    const userLocationControl = new L.Control({ position: 'topright' });
    userLocationControl.onAdd = () => {
        const button = L.DomUtil.create('button', ` ${buttonVariants({ variant: "default", size: "icon" })}`);
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>'; // Example icon
        button.onclick = () => {
            map.flyTo(userLocation, 15);
        };
        return button;
    };
    controlRef.current = userLocationControl
    map.addControl(userLocationControl)
}

function addSingleVehicleLocationButton(map: Map, vehicleLocation: [number, number], controlRef: React.MutableRefObject<L.Control | null>) {
    if (controlRef.current !== null) {
        map.removeControl(controlRef.current)
    }
    const vehicleControlLocation = new L.Control({ position: 'topright' });
    vehicleControlLocation.onAdd = () => {
        const button = L.DomUtil.create('button', ` ${buttonVariants({ variant: "default", size: "icon" })}`);
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rocket"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>'; // Example icon
        button.onclick = () => {
            map.flyTo(vehicleLocation, 15);
        };
        return button;
    };
    controlRef.current = vehicleControlLocation
    map.addControl(vehicleControlLocation);
}

function createMapClusterGroup(): MarkerClusterGroup {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-expect-error
    return L.markerClusterGroup({
        maxClusterRadius: 40, // Adjust this value to make the group expand earlier. A smaller value causes earlier expansion.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-expect-error        
        iconCreateFunction: function (cluster) {
            // Define a custom cluster icon using /blank.png and the number of markers
            const count = cluster.getChildCount();
            return L.divIcon({
                html: `<div style="position: relative; width: 32px; height: 32px;">
                     <img src="/vehicle_icons/blank.png" style="width: 100%; height: 100%;" />
                     <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: black;">
                       ${count}
                     </div>
                   </div>`,
                className: "custom-cluster-icon",
                iconSize: [32, 32],
            });
        },
    });
}

const routesWithIcons = [
    //Buses
    "TMK-202",
    "RBW-402",
    "RBSX-402",
    "RBS-402",
    "RBO-402",
    "RBE-402",
    "OUT-202",
    "MEX-403",
    "INN-202",
    "CTY-202",
    "AIR-221",
    //Ferry's
    "HOBS-209",
    "HMB-209",
    "DEV-209",
    "GULF-209",
    //Trains
    "ONE-201",
    "EAST-201",
    "STH-201",
    "WEST-201",
]
