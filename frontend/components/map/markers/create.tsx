import maplibregl from "maplibre-gl";
import { toLngLat } from "../geo";

export interface MapItem {
    lat: number;
    lon: number;
    icon: "bus" | "train" | "ferry" | "school bus" | "dot" | "dot gray" | "pin" | "user" | "stop marker" | "end marker" | "marked stop marker" | "next stop marker" | "start marker" | "current stop marker" | "hidden" | "train stop marker" | "bus stop marker" | "ferry stop marker";
    id: string;
    routeID: string;
    zIndex: number;
    onClick: (id: string) => void;
    /**
     * Always-visible label under the marker. Only use for a map showing many
     * unrelated vehicles at once with no side list to cross-reference (e.g. the
     * /vehicles overview map) - everywhere else, use `popup` instead.
     */
    visibleLabel?: string;
    /** Direction of travel in degrees (0-360). Vehicles only; rotates the icon. */
    bearing?: number;
    /** Dim a marker (0-1) e.g. to de-emphasise non-selected vehicles in focused mode. */
    opacity?: number;
    /** Only shown once the map is zoomed to at least this level - declutters minor markers (e.g. in-between stops) at a wide view. */
    minZoom?: number;
    /** Click opens an in-place popup instead of navigating away. */
    popup?: {
        title: string;
        /** Secondary line below the title, e.g. an arrival time. */
        subtitle?: string;
        linkText?: string;
        linkHref?: string;
    }
    /** Speed at this point, used to color waypoint line segments. */
    speedKmh?: number;
    type: 'stop' | 'vehicle' | 'waypoint'
    zoomButton?: string
}

/**
 * MapLibre `Marker`s are just DOM elements the map keeps positioned, so - like
 * Leaflet's `divIcon` before it - the icon is plain HTML we render into a
 * `<div>`. `anchor`/`offset` reproduce Leaflet's old `iconAnchor` pixel points.
 */
type MarkerStyle = { anchor: maplibregl.PositionAnchor; offset: [number, number] };

function markerStyle(item: MapItem): MarkerStyle {
    if (item.icon === "hidden") return { anchor: "center", offset: [0, 0] };
    // Dots mark an exact point, so they sit centred on it; every other icon
    // reads as a pin and hangs above the point by its bottom edge.
    if (item.icon === "dot" || item.icon === "dot gray") return { anchor: "center", offset: [0, 0] };
    return { anchor: "bottom", offset: [0, 0] };
}

function iconInnerHtml(item: MapItem): string {
    const { routeID, icon, visibleLabel, bearing, opacity } = item;

    if (icon === "hidden") {
        return `<div style="width: 0px; height: 0px;"></div>`;
    }

    const iconUrl = routesWithIcons.includes(routeID)
        ? `/route_icons/${routeID}.png`
        : getIconUrl(icon);

    // Bearing 0 is indistinguishable from "no data" (proto3 default) - only
    // custom route logos are skipped, since rotating a logo looks wrong.
    const rotation = bearing !== undefined && bearing !== 0 && !routesWithIcons.includes(routeID)
        ? `rotate(${bearing}deg)`
        : "";

    if (visibleLabel) {
        return `
            <div style="position: relative; width: 28px; height: 28px; opacity: ${opacity ?? 1};">
            <span
              style="
                position: absolute;
                bottom: 32px;
                left: 50%;
                transform: translateX(-50%);
                color: #1d4ed8;
                font-size: 12px;
                font-weight: 700;
                white-space: nowrap;
                padding: 4px 10px;
                background-color: rgba(255, 255, 255, 0.96);
                border-radius: 9999px;
                border: 1px solid rgba(148, 163, 184, 0.55);
                box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
              "
            >
              ${visibleLabel}
            </span>
            <img
              src="${iconUrl}" alt=""
              style="position: absolute; inset: 0; width: 28px; height: 28px; transform: ${rotation};"
            />
            </div>
        `;
    }

    return `
        <div style="position: relative; width: 28px; height: 28px; opacity: ${opacity ?? 1};">
            <img
              src="${iconUrl}" alt=""
              style="width: 28px; height: 28px; transform: ${rotation};"
            />
        </div>
    `;
}

/** The click listener is bound once and reads the marker's current item, which
 * `updateExistingMarker` swaps in place on every poll - so the handler always
 * fires against the latest data without ever being re-subscribed. */
type MarkerWithItem = maplibregl.Marker & { __item: MapItem; __popupKey?: string };

/**
 * The marker's outer element is owned by MapLibre (it manages its class list
 * and transform for positioning), so all our styling goes on an inner wrapper.
 * Overwriting the outer element's className would strip `maplibregl-marker` and
 * its `position: absolute`, and the markers then drift on pan/zoom.
 */
function paintContent(item: MapItem, content: HTMLDivElement) {
    if (!item.icon) {
        throw new Error("Icon is undefined, must be bus, train, ferry, etc.");
    }
    content.style.cursor = typeof item.onClick === "function" && item.id !== "" ? "pointer" : "";
    content.innerHTML = iconInnerHtml(item);
}

function syncPopup(item: MapItem, marker: MarkerWithItem) {
    const key = item.popup ? JSON.stringify(item.popup) : "";
    if (key === marker.__popupKey) return;
    marker.__popupKey = key;
    marker.setPopup(
        item.popup
            ? new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(createPopupHtml(item.popup))
            : undefined
    );
}

function contentOf(marker: maplibregl.Marker): HTMLDivElement {
    return marker.getElement().firstElementChild as HTMLDivElement;
}

export function createNewMarker(item: MapItem): maplibregl.Marker {
    const style = markerStyle(item);
    const root = document.createElement("div");
    const content = document.createElement("div");
    root.appendChild(content);
    paintContent(item, content);

    const marker = new maplibregl.Marker({
        element: root,
        anchor: style.anchor,
        offset: style.offset,
    }).setLngLat(toLngLat([item.lat, item.lon])) as MarkerWithItem;

    root.style.zIndex = String(item.zIndex ?? 0);
    marker.__item = item;
    content.addEventListener("click", () => {
        const it = marker.__item;
        if (typeof it.onClick === "function" && it.id !== "") it.onClick(it.id);
    });

    syncPopup(item, marker);
    return marker;
}

export function updateExistingMarker(item: MapItem, marker: maplibregl.Marker): maplibregl.Marker {
    const m = marker as MarkerWithItem;
    m.__item = item;
    m.setOffset(markerStyle(item).offset);
    m.getElement().style.zIndex = String(item.zIndex ?? 0);
    paintContent(item, contentOf(m));
    syncPopup(item, m);
    animateMarkerTo(m, item.lat, item.lon);
    return m;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function createPopupHtml(popup: NonNullable<MapItem["popup"]>): string {
    const title = `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(popup.title)}</div>`
    const subtitle = popup.subtitle
        ? `<div style="color:#64748b;margin-bottom:4px;">${escapeHtml(popup.subtitle)}</div>`
        : ""
    const link = popup.linkHref
        ? `<a href="${escapeHtml(popup.linkHref)}" style="color:#2563eb;text-decoration:underline;font-size:12px;">${escapeHtml(popup.linkText || "View departures")}</a>`
        : ""
    return `<div style="font-size:13px;min-width:120px;">${title}${subtitle}${link}</div>`
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
        "start marker": '/vehicle_icons/stop_dot_start.png',
        "train stop marker": "/vehicle_icons/train stop marker.png",
        "bus stop marker": "/vehicle_icons/bus stop marker.png",
        "ferry stop marker": "/vehicle_icons/ferry stop marker.png",
    };
    return iconMap[icon.toLowerCase()] || icon; // Return icon URL or use the provided custom URL
}

/** Cluster-bubble marker element - ported from the old markercluster iconCreateFunction. */
export function createClusterElement(count: number): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "custom-cluster-icon";
    el.style.cursor = "pointer";
    el.innerHTML = `<div style="position: relative; width: 32px; height: 32px;">
         <img src="/vehicle_icons/blank.png" style="width: 100%; height: 100%;" />
         <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: black;">
           ${count}
         </div>
       </div>`;
    return el;
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

function animateMarkerTo(marker: maplibregl.Marker, newLat: number, newLng: number, duration = 500) {
    const start = marker.getLngLat();
    const endLng = newLng;
    const endLat = newLat;
    const startTime = performance.now();

    function animate(time: number) {
        const t = Math.min(1, (time - startTime) / duration);
        const lng = start.lng + (endLng - start.lng) * t;
        const lat = start.lat + (endLat - start.lat) * t;
        marker.setLngLat([lng, lat]);

        if (t < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}
