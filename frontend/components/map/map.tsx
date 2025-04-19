import leaflet, { MarkerClusterGroup } from "leaflet"
import React, { useEffect, useRef, useState } from "react"
import 'leaflet/dist/leaflet.css';
import "leaflet.markercluster";
import { TrainsApiResponse } from "../services/types";
import { ShapesResponse, GeoJSON } from "./geojson-types";
import { ApiFetch } from "@/lib/url-context";
import { buttonVariants } from "../ui/button";

export interface MapItem {
    lat: number;
    lon: number;
    icon: "bus" | "train" | "ferry" | "school bus" | "dot" | "pin" | "user" | "stop marker" | "end marker" | "marked stop marker" | string;
    id: string;
    routeID: string;
    zIndex: number;
    onClick: (id: string) => void;
    description: {
        text: string;
        alwaysShow: boolean;
    }
}

interface MapProps {
    line?: GeoJSON
    trip?: {
        routeId: string
        tripId: string
    }
    vehicles?: MapItem[]
    stops?: MapItem[]
    map_id: string
    userLocation: {
        found: boolean
        lat: number
        lon: number
    }
    height: string
    alwaysFitBoundsWithoutUser?: boolean
}

type ItemsOnMap = {
    stops: {
        clusterGroup: MarkerClusterGroup | null
        markers: { id: string, marker: leaflet.Marker }[]
    }
    vehicles: {
        clusterGroup: MarkerClusterGroup | null
        markers: { id: string, marker: leaflet.Marker }[]
        control: leaflet.Control | null
    }
    user: {
        marker: leaflet.Marker | null
        control: leaflet.Control | null
    }
    routeLine: {
        line: leaflet.GeoJSON | null
        routeId: string
        tripId: string
    }
    navigation: {
        line: leaflet.GeoJSON | null
    }
}

export default function Map(Props: MapProps) {
    const mapRef = useRef<leaflet.Map | null>(null)
    const [mapZoomSet, setMapZoomState] = useState(false)
    const itemsOnMap = useRef<ItemsOnMap>({ vehicles: { clusterGroup: null, markers: [], control: null }, stops: { clusterGroup: null, markers: [] }, user: { marker: null, control: null }, routeLine: { line: null, tripId: "", routeId: "" }, navigation: { line: null } })

    //Stuff on the map, like markers  and the map itself
    useEffect(() => {
        let map: leaflet.Map | null = mapRef.current
        if (!map) {
            map = createNewMap(mapRef, Props)
        }

        const userLocation = Props.userLocation
        const vehicles = Props.vehicles || []
        const stops = Props.stops || []

        if (!mapZoomSet) {
            //User and only vehicle - tracker modal
            setDefaultZoom(map, userLocation, vehicles, stops, Props.alwaysFitBoundsWithoutUser || false);
            setMapZoomState(true)
        }

        const activeMapItems = itemsOnMap.current

        const activeStops = activeMapItems.stops
        const activeVehicles = activeMapItems.vehicles
        const activeNavigation = activeMapItems.navigation

        addUserMarker(activeMapItems.user, map, userLocation)

        if (stops.length > 0) {
            if (!activeStops.clusterGroup) {
                activeStops.clusterGroup = createMapClusterGroup()
            }
            if (activeStops.clusterGroup) {
                activeStops.clusterGroup.clearLayers()
            }
            activeStops.markers.forEach((item) => {
                map.removeLayer(item.marker)
            })
            stops.forEach((stop) => {
                //Add the stop to the map
                const marker = createNewMarker(stop)
                //Only make the cluster if theres more than 100 stops, otherwise just add the marker
                if (activeStops.clusterGroup && stops.length > 100) {
                    activeStops.clusterGroup.addLayer(marker)
                } else {
                    map.addLayer(marker)
                }
                activeStops.markers.push({ id: stop.id, marker })
            })
            if (activeStops.clusterGroup && stops.length > 100) {
                map.addLayer(activeStops.clusterGroup as leaflet.Layer)
            }
            itemsOnMap.current.stops = activeStops
        }

        if (vehicles.length > 0) {
            if (activeVehicles.clusterGroup) {
                activeVehicles.clusterGroup.clearLayers()
            }
            activeVehicles.markers.forEach((item) => {
                map.removeLayer(item.marker)
            })
            vehicles.forEach((vehicle) => {
                //Add the vehicle to the map
                const marker = createNewMarker(vehicle)
                if (!activeVehicles.clusterGroup) {
                    activeVehicles.clusterGroup = createMapClusterGroup()
                }
                activeVehicles.clusterGroup.addLayer(marker)
                activeVehicles.markers.push({ id: vehicle.id, marker })
            })
            if (vehicles.length === 1) {
                addVehicleZoomControl(map, [vehicles[0].lat, vehicles[0].lon], activeVehicles)
            }
            map.addLayer(activeVehicles.clusterGroup as leaflet.Layer)
            itemsOnMap.current.vehicles = activeVehicles
        }

        if (Props.line) {
            if (activeNavigation.line) {
                map.removeLayer(activeNavigation.line)
            }
            const line = createNavigationLine(Props.line)
            activeMapItems.navigation.line = line
            line.addTo(map)

        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Props.vehicles, Props.userLocation, Props.stops, Props.map_id, Props.line, mapRef])

    //Route line
    useEffect(() => {
        const map: leaflet.Map | null = mapRef.current
        if (!map) return

        const routeId = Props.trip ? Props.trip.routeId : ""
        const tripId = Props.trip ? Props.trip.tripId : ""

        const hasTrip = routeId !== "" && tripId !== "" ? true : false
        if (!hasTrip) return

        if (itemsOnMap.current.routeLine.line && itemsOnMap.current.routeLine.routeId !== routeId && itemsOnMap.current.routeLine.tripId !== tripId) {
            //Remove old route line if there is one
            map.removeLayer(itemsOnMap.current.routeLine.line)
        } else if (itemsOnMap.current.routeLine.line && itemsOnMap.current.routeLine.routeId === routeId && itemsOnMap.current.routeLine.tripId === tripId) {
            return
        }
        //Add route line to map
        const getRouteLine = async () => {
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
                const routeLine = leaflet.geoJSON(filteredData, {
                    //@ts-expect-error: is real config value
                    smoothFactor: 1.5, // Adjust the smoothness level
                    style: function () {
                        return { color: data.data.color !== "" ? `#${data.data.color}` : '#393939', weight: 4 }; // Customize the line color and thickness
                    }
                })
                map.addLayer(routeLine)
                //Save the route line to the ref
                itemsOnMap.current.routeLine.line = routeLine
                itemsOnMap.current.routeLine.routeId = routeId
                itemsOnMap.current.routeLine.tripId = tripId
            } catch (error) {
                console.error(error)
            }
        }
        getRouteLine()
    }, [Props.trip, mapRef])


    return (
        <>
            <div id={Props.map_id} style={{ height: Props.height, width: '100%', maxHeight: Props.height ? "" : "50vh", zIndex: 1, borderRadius: "10px" }} />
        </>
    )
}



function createNewMap(ref: React.MutableRefObject<leaflet.Map | null>, Props: MapProps): leaflet.Map {
    let map: leaflet.Map | null = ref.current
    if (!map || Props.map_id === "") {
        if (Props.map_id.length < 3) throw new Error("Map ID is too short, must be at least 3 characters")
        if (document.getElementById(Props.map_id) === null) throw new Error("Element with Map ID does NOT exist in the DOM")
        //Create the map
        map = leaflet.map(Props.map_id);
        ref.current = map;
        leaflet.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            minZoom: 8,
            attribution: '&copy; <a href="https://www.carto.com/attributions">CARTO</a>'
        }).addTo(map);
    }
    return map
}

function setDefaultZoom(map: leaflet.Map, userLocation: { found: boolean; lat: number; lon: number; }, vehicles: MapItem[], stops: MapItem[], alwaysFitBoundsWithoutUser: boolean) {
    if (userLocation.found && vehicles.length === 1) {
        const bounds = leaflet.latLngBounds([userLocation.lat, userLocation.lon], [vehicles[0].lat, vehicles[0].lon]);
        map.fitBounds(bounds);
    } else if (userLocation.found && stops.length === 1) {
        //User and only stop - nav modal
        const bounds = leaflet.latLngBounds([userLocation.lat, userLocation.lon], [stops[0].lat, stops[0].lon]);
        map.fitBounds(bounds);
        //User and multiple vehicles/stops - vehicle map/stops map
    } else if (userLocation.found) {
        map.setView([userLocation.lat, userLocation.lon], 13);
    } else {
        if (vehicles.length > 0) {
            if (alwaysFitBoundsWithoutUser) {
                const bounds = leaflet.latLngBounds([vehicles[0].lat, vehicles[0].lon], [vehicles[vehicles.length - 1].lat, vehicles[vehicles.length - 1].lon]);
                map.fitBounds(bounds);
            } else {
                map.setView([vehicles[0].lat, vehicles[0].lon], 13);
            }
        } else if (stops.length > 0) {
            if (alwaysFitBoundsWithoutUser) {
                const bounds = leaflet.latLngBounds([stops[0].lat, stops[0].lon], [stops[stops.length - 1].lat, stops[stops.length - 1].lon]);
                map.fitBounds(bounds);
            } else {
                map.setView([stops[0].lat, stops[0].lon], 13);
            }
        } else {
            //otherwise your toast
            throw new Error("No vehicles or stops or user location found");
        }
    }
}

function addVehicleZoomControl(map: leaflet.Map, vehicleLocation: [number, number], activeMapItemsVehicle: ItemsOnMap["vehicles"]) {
    const vehicleControl = activeMapItemsVehicle.control
    if (vehicleControl) {
        map.removeControl(vehicleControl)
    }
    const vehicleLocationControl = new leaflet.Control({ position: 'topright' });
    vehicleLocationControl.onAdd = () => {
        const button = leaflet.DomUtil.create('button', ` ${buttonVariants({ variant: "default", size: "icon" })}`);
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bus-front-icon lucide-bus-front"><path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/></svg>';
        button.onclick = () => {
            map.flyTo(vehicleLocation, 15);
        };
        return button;
    };
    activeMapItemsVehicle.control = vehicleLocationControl
    map.addControl(vehicleLocationControl)
}

function addUserMarker(activeMapItemsUser: ItemsOnMap["user"], map: leaflet.Map, userLocation: MapProps["userLocation"]) {
    const userMarker = activeMapItemsUser.marker
    const userControl = activeMapItemsUser.control
    if (userMarker) {
        map.removeLayer(userMarker)
    }
    if (userControl) {
        map.removeControl(userControl)
    }
    if (userLocation.found) {
        const userMarker = createNewMarker({
            lat: userLocation.lat,
            lon: userLocation.lon,
            icon: "user",
            id: "user_location",
            routeID: "",
            zIndex: 1000,
            onClick: () => { },
            description: {
                text: "Your location",
                alwaysShow: false
            }
        })
        activeMapItemsUser.marker = userMarker
        userMarker.addTo(map)
        const userLocationControl = new leaflet.Control({ position: 'topright' });
        userLocationControl.onAdd = () => {
            const button = leaflet.DomUtil.create('button', ` ${buttonVariants({ variant: "default", size: "icon" })}`);
            button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-navigation"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>'; // Example icon
            button.onclick = () => {
                map.flyTo([userLocation.lat, userLocation.lon], 15);
            };
            return button;
        };
        activeMapItemsUser.control = userLocationControl
        map.addControl(userLocationControl)
    }
}

function createNewMarker(MapItem: MapItem): leaflet.Marker {
    const customIcon = createMarkerIcon(MapItem.routeID, MapItem.icon, MapItem.description.text, MapItem.description.alwaysShow);

    const marker = leaflet.marker([MapItem.lat, MapItem.lon], { icon: customIcon, zIndexOffset: MapItem.zIndex });

    if (typeof MapItem.onClick === 'function' && MapItem.id !== "") {
        marker.on('click', () => MapItem.onClick(MapItem.id));
    }

    // Add a hover message (tooltip) above the marker
    if (MapItem.description.text !== "" && !MapItem.description.alwaysShow) {
        marker.bindTooltip(MapItem.description.text, {
            direction: 'top',       // Positions the tooltip above the marker
            offset: [0, -24],       // Adjusts the tooltip position
            permanent: false,       // Tooltip only appears on hover
            opacity: 0.9,           // Adjust opacity if needed
            className: 'custom-tooltip' // Optional: Add a custom class for styling
        });
    }

    return marker
}

function createMarkerIcon(routeId: string, icon: string, description: string, alwaysShowDiscription: boolean): leaflet.Icon<leaflet.IconOptions> | leaflet.DivIcon {
    if (!icon) {
        throw new Error("Icon is undefined, must be bus, train, ferry, etc.");
    }

    const iconUrl = routesWithIcons.includes(routeId)
        ? `/route_icons/${routeId}.png`
        : getIconUrl(icon);

    let customIcon

    if (alwaysShowDiscription) {

        customIcon = leaflet.divIcon({
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
                      ${description}
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
        customIcon = leaflet.icon({
            iconUrl,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24]
        });
    }

    return customIcon
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
        "dot gray": "/vehicle_icons/stop_dot_passed.png",
        "current stop marker": "/vehicle_icons/stop_dot_currently_at.png",
    };
    return iconMap[icon.toLowerCase()] || icon; // Return icon URL or use the provided custom URL
}

function createMapClusterGroup(): MarkerClusterGroup {
    return leaflet.markerClusterGroup({
        maxClusterRadius: 50, // Adjust this value to make the group expand earlier. A smaller value causes earlier expansion. 
        iconCreateFunction: function (cluster) {
            // Define a custom cluster icon using /blank.png and the number of markers
            const count = cluster.getChildCount();
            return leaflet.divIcon({
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

function createNavigationLine(geoJson: GeoJSON) {
    const line = leaflet.geoJSON(geoJson, {
        //@ts-expect-error: is real config value
        smoothFactor: 1.5, // Adjust the smoothness level
        style: function () {
            return { color: '#db6ecb', weight: 4 }; // Customize the line color and thickness
        }
    })

    return line
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
