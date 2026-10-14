import type { Annotation, MapKit } from "@apple/mapkit-loader";
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

/** What our MapKit annotations carry in `data`. */
export type AnnotationData =
    | { kind: "item"; item: MapItem }
    | { kind: "cluster" };

/**
 * MapKit hit-tests an annotation by its element's box, and ours are 0x0 (see
 * `pointElement`), so its `select` event never fires for them - clicks are
 * handled on the artwork itself. Stops the click reaching the map, which would
 * otherwise treat it as a tap on empty map (deselecting / onMapClick).
 */
function onTap(content: HTMLElement, handler: () => void) {
    content.addEventListener("click", (e) => {
        e.stopPropagation();
        handler();
    });
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
        content.addEventListener(ev, (e) => e.stopPropagation());
    }
}

/**
 * MapKit JS anchors an annotation's element by its bottom centre and sizes
 * collisions/callouts from it. Our artwork comes in two kinds (centred dots and
 * vehicles; pins that hang above the point by their tail), so the element itself
 * is a 0x0 box sitting exactly on the coordinate and the artwork inside is
 * translated to the right spot - no measuring needed.
 */
function anchorTransform(item: MapItem): string {
    const centred = item.type === "vehicle" || isCentredIcon(item.icon);
    return centred ? "translate(-50%, -50%)" : "translate(-50%, -100%)";
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

/** A 0x0 element on the coordinate; `content` is positioned relative to it. */
export function pointElement(): { root: HTMLDivElement; content: HTMLDivElement } {
    const root = document.createElement("div");
    root.style.width = "0px";
    root.style.height = "0px";
    root.style.overflow = "visible";
    const content = document.createElement("div");
    content.style.position = "absolute";
    content.style.left = "0";
    content.style.top = "0";
    content.style.width = "max-content";
    root.appendChild(content);
    return { root, content };
}

function paintContent(item: MapItem, content: HTMLElement) {
    if (!item.icon) {
        throw new Error("Icon is undefined, must be bus, train, ferry, etc.");
    }
    content.style.transform = anchorTransform(item);
    content.style.cursor = typeof item.onClick === "function" && item.id !== "" ? "pointer" : "";
    const html = iconInnerHtml(item);
    // Skip identical repaints - vehicle polls re-send every item every few seconds.
    if ((content as HTMLElement & { __html?: string }).__html !== html) {
        (content as HTMLElement & { __html?: string }).__html = html;
        content.innerHTML = html;
    }
}

function contentOf(annotation: Annotation): HTMLElement {
    return annotation.element.firstElementChild as HTMLElement;
}

function popupCallout(): { calloutElementForAnnotation(a: Annotation): HTMLElement } {
    return {
        calloutElementForAnnotation(a: Annotation) {
            const data = a.data as AnnotationData;
            const el = document.createElement("div");
            el.className = "map-popup";
            if (data.kind === "item" && data.item.popup) el.innerHTML = createPopupHtml(data.item.popup);
            return el;
        },
    };
}

function syncAnnotationOptions(item: MapItem, annotation: Annotation) {
    annotation.calloutEnabled = !!item.popup;
    // Only callout-bearing annotations are ever selected (by our tap handler).
    annotation.enabled = !!item.popup;
    annotation.element.style.zIndex = String(item.zIndex ?? 0);
}

export function createAnnotation(mk: MapKit, item: MapItem): Annotation {
    const { root, content } = pointElement();
    paintContent(item, content);
    const data: AnnotationData = { kind: "item", item };
    const annotation = new mk.Annotation(new mk.Coordinate(item.lat, item.lon), () => root, {
        data,
        // We do our own clustering and decluttering - never let MapKit hide one.
        displayPriority: mk.AnnotationDisplayPriority.Required,
        collisionMode: mk.AnnotationCollisionMode.None,
        animates: false,
        callout: popupCallout(),
        calloutOffset: new DOMPoint(0, -20),
    });
    syncAnnotationOptions(item, annotation);
    onTap(content, () => {
        const it = (annotation.data as AnnotationData & { kind: "item" }).item;
        if (typeof it.onClick === "function" && it.id !== "") it.onClick(it.id);
        if (it.popup && annotation.map) annotation.map.selectedAnnotation = annotation;
    });
    return annotation;
}

export function updateAnnotation(mk: MapKit, item: MapItem, annotation: Annotation): Annotation {
    (annotation.data as AnnotationData & { kind: "item" }).item = item;
    syncAnnotationOptions(item, annotation);
    paintContent(item, contentOf(annotation));
    animateAnnotationTo(mk, annotation, item.lat, item.lon);
    return annotation;
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

/** Cluster bubble (a count in a ringed circle), centred on the cluster. */
export function createClusterAnnotation(mk: MapKit, lat: number, lon: number, count: number, onSelect: () => void): Annotation {
    const { root, content } = pointElement();
    content.style.transform = "translate(-50%, -50%)";
    content.style.cursor = "pointer";
    content.innerHTML = `<div style="width: 32px; height: 32px; border-radius: 9999px; background: #fff; border: 2px solid #18181b; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.35); box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #18181b;">${count}</div>`;
    onTap(content, onSelect);
    const data: AnnotationData = { kind: "cluster" };
    return new mk.Annotation(new mk.Coordinate(lat, lon), () => root, {
        data,
        displayPriority: mk.AnnotationDisplayPriority.Required,
        collisionMode: mk.AnnotationCollisionMode.None,
        animates: false,
        calloutEnabled: false,
    });
}

const animations = new WeakMap<Annotation, number>();

function animateAnnotationTo(mk: MapKit, annotation: Annotation, newLat: number, newLng: number, duration = 500) {
    const start = annotation.coordinate;
    if (start.latitude === newLat && start.longitude === newLng) return;
    const prev = animations.get(annotation);
    if (prev) cancelAnimationFrame(prev);
    const startTime = performance.now();

    function animate(time: number) {
        const t = Math.min(1, (time - startTime) / duration);
        annotation.coordinate = new mk.Coordinate(
            start.latitude + (newLat - start.latitude) * t,
            start.longitude + (newLng - start.longitude) * t,
        );
        if (t < 1) animations.set(annotation, requestAnimationFrame(animate));
        else animations.delete(annotation);
    }

    animations.set(annotation, requestAnimationFrame(animate));
}
