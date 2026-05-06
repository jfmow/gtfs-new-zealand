import leaflet, { MarkerClusterGroup } from "leaflet"
import "leaflet.markercluster";

export interface MapItem {
    lat: number;
    lon: number;
    icon: "bus" | "train" | "ferry" | "school bus" | "dot" | "dot gray" | "pin" | "user" | "stop marker" | "end marker" | "marked stop marker" | "next stop marker" | "start marker" | "current stop marker" | "hidden";
    id: string;
    routeID: string;
    zIndex: number;
    onClick: (id: string) => void;
    description: {
        text: string;
        alwaysShow: boolean;
    }
    type: 'stop' | 'vehicle' | 'waypoint'
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
        MapItem.icon,
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
    if (icon === "hidden") {
        return leaflet.divIcon({
            className: "hidden-icon",
            html: `<div style="width: 0px; height: 0px;"></div>`,
            iconAnchor: [0, 0],
        });
    }

    const iconUrl = routesWithIcons.includes(routeId)
        ? `/route_icons/${routeId}.png`
        : getIconUrl(icon);

    let customIcon

    if (alwaysShowDiscription) {
        customIcon = leaflet.divIcon({
            className: "flex items-center justify-center",
            html: `
            <div style="position: relative; width: max-content; height: 52px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span
                style="
                  display: block;
                  color: #0f172a;
                  font-size: 11px;
                  font-weight: 700;
                  letter-spacing: 0.01em;
                  white-space: nowrap;
                  padding: 3px 10px;
                  background-color: rgba(255, 255, 255, 0.98);
                  border-radius: 9999px;
                  border: 1.5px solid rgba(100, 116, 139, 0.3);
                  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(255,255,255,0.6);
                  line-height: 1.4;
                "
              >
                ${description}
              </span>
              <div style="
                width: 34px;
                height: 34px;
                border-radius: 9999px;
                border: 2.5px solid #ffffff;
                box-shadow: 0 2px 8px rgba(15, 23, 42, 0.28), 0 0 0 1.5px rgba(100,116,139,0.25);
                overflow: hidden;
                background: #f1f5f9;
                flex-shrink: 0;
              ">
                <img
                  src="${iconUrl}" alt=""
                  style="width: 100%; height: 100%; object-fit: cover;"
                />
              </div>
            </div>
        `,
            iconAnchor: [17, 52],
        });
    } else {
        customIcon = leaflet.divIcon({
            className: "flex items-center justify-center",
            html: `
            <div style="
              width: 34px;
              height: 34px;
              border-radius: 9999px;
              border: 2.5px solid #ffffff;
              box-shadow: 0 2px 8px rgba(15, 23, 42, 0.28), 0 0 0 1.5px rgba(100,116,139,0.2);
              overflow: hidden;
              background: #f1f5f9;
            ">
              <img
                src="${iconUrl}" alt=""
                style="width: 100%; height: 100%; object-fit: cover;"
              />
            </div>
        `,
            iconAnchor: [17, 17],
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
        "next stop marker": "/vehicle_icons/next stop marker.png",
        "end marker": "/vehicle_icons/end marker.png",
        "marked stop marker": "/vehicle_icons/marked stop marker.png",
        "dot gray": "/vehicle_icons/stop_dot_passed.png",
        "current stop marker": "/vehicle_icons/stop_dot_currently_at.png",
        "start marker": '/vehicle_icons/stop_dot_start.png'
    };
    return iconMap[icon.toLowerCase()] || icon; // Return icon URL or use the provided custom URL
}

export function createMapClusterGroup(): MarkerClusterGroup {
    return leaflet.markerClusterGroup({
        maxClusterRadius: 50, // Adjust this value to make the group expand earlier. A smaller value causes earlier expansion. 
        iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();
            const size = count >= 100 ? 42 : count >= 10 ? 38 : 34;
            return leaflet.divIcon({
                html: `<div style="
                  width: ${size}px;
                  height: ${size}px;
                  border-radius: 9999px;
                  background: rgba(255,255,255,0.97);
                  border: 2.5px solid #ffffff;
                  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.3), 0 0 0 1.5px rgba(100,116,139,0.25);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: ${count >= 100 ? 11 : 12}px;
                  font-weight: 800;
                  color: #0f172a;
                  letter-spacing: -0.02em;
                  font-family: system-ui, -apple-system, sans-serif;
                ">
                  ${count}
                </div>`,
                className: "custom-cluster-icon",
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
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
