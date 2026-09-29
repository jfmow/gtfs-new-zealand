import maplibregl from "maplibre-gl";
import { toLngLat } from "../geo";
import { isCentredIcon, staticMarkerHtml, vehicleMarkerHtml, type MarkerIcon } from "./icons";

export interface MapItem {
    lat: number;
    lon: number;
    icon: MarkerIcon;
    id: string;
    routeID: string;
    /** Route colour ("RRGGBB" or "#RRGGBB") - fills a vehicle's badge. */
    color?: string;
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
    // Dots and vehicles mark an exact point, so they sit centred on it; the
    // pins hang above the point by their tail.
    if (item.type === "vehicle" || isCentredIcon(item.icon)) return { anchor: "center", offset: [0, 0] };
    return { anchor: "bottom", offset: [0, 0] };
}

const VEHICLE_SIZE = 30;

function iconInnerHtml(item: MapItem): string {
    const { icon, color, visibleLabel, bearing, opacity } = item;

    if (icon === "hidden") {
        return `<div style="width: 0px; height: 0px;"></div>`;
    }

    const artwork = item.type === "vehicle" || icon === "bus" || icon === "train" || icon === "ferry" || icon === "school bus"
        ? vehicleMarkerHtml(icon, color, bearing, VEHICLE_SIZE)
        : staticMarkerHtml(icon);

    const label = visibleLabel
        ? `<span
              style="
                position: absolute;
                bottom: calc(100% + 6px);
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
            </span>`
        : "";

    return `<div style="position: relative; opacity: ${opacity ?? 1};">${label}${artwork}</div>`;
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

/** Cluster-bubble marker element - ported from the old markercluster iconCreateFunction. */
export function createClusterElement(count: number): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "custom-cluster-icon";
    el.style.cursor = "pointer";
    el.innerHTML = `<div style="width: 32px; height: 32px; border-radius: 9999px; background: #fff; border: 2px solid #18181b; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.35); box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #18181b;">
         ${count}
       </div>`;
    return el;
}

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
