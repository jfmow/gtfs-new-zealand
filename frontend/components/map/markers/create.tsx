import leaflet, { MarkerClusterGroup } from "leaflet"
import "leaflet.markercluster";

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
    type: 'stop' | 'vehicle'
    zoomButton?: string
}

export function createNewMarker(MapItem: MapItem): leaflet.Marker {
    const customIcon = createMarkerIcon(MapItem.routeID, MapItem.icon || "bus", MapItem.description.text, MapItem.description.alwaysShow);

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

export function updateExistingMarker(MapItem: MapItem, marker: leaflet.Marker): leaflet.Marker {
    const customIcon = createMarkerIcon(
        MapItem.routeID,
        MapItem.icon || "bus",
        MapItem.description.text,
        MapItem.description.alwaysShow
    );


    // Update icon
    marker.setIcon(customIcon);

    // Update zIndex
    marker.setZIndexOffset(MapItem.zIndex ?? 0);

    // Remove all existing event listeners before reattaching
    marker.off();

    // Update click handler
    if (typeof MapItem.onClick === 'function' && MapItem.id !== "") {
        marker.on('click', () => MapItem.onClick(MapItem.id));
    }

    // Remove existing tooltip if any
    marker.unbindTooltip();

    // Re-bind tooltip if necessary
    if (MapItem.description.text !== "" && !MapItem.description.alwaysShow) {
        marker.bindTooltip(MapItem.description.text, {
            direction: 'top',
            offset: [0, -24],
            permanent: false,
            opacity: 0.9,
            className: 'custom-tooltip',
        });
    }

    // Update position
    animateMarkerTo(marker, MapItem.lat, MapItem.lon)

    return marker;
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
                    top: -12px;
                    left: 50%;
                    transform: translateX(-50%);
                    color: white;
                    font-size: 12px;
                    font-weight: bold;
                    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000,
                      1px 1px 0 #000;
                    white-space: nowrap;
                    padding: 0 5px;
                  "
                >
                  ${description}
                </span>
                <img
                  src="${iconUrl}"
                  style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 24px; height: 24px;"
                />
            </div>
        `,
            iconAnchor: [12, 30],
        });
    } else {
        // 💡 Convert to DivIcon without description
        customIcon = leaflet.divIcon({
            className: "flex items-center justify-center",
            html: `
            <div style="position: relative; width: 24px; height: 24px;">
                <img
                  src="${iconUrl}"
                  style="width: 24px; height: 24px;"
                />
            </div>
        `,
            iconAnchor: [12, 30],
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

export function createMapClusterGroup(): MarkerClusterGroup {
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


function animateMarkerTo(marker: L.Marker, newLat: number, newLng: number, duration = 500) {
    const start = marker.getLatLng();
    const end = leaflet.latLng(newLat, newLng);
    const startTime = performance.now();

    function animate(time: number) {
        const t = Math.min(1, (time - startTime) / duration);
        const lat = start.lat + (end.lat - start.lat) * t;
        const lng = start.lng + (end.lng - start.lng) * t;
        marker.setLatLng([lat, lng]);

        if (t < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}