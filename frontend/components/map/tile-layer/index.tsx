import maplibregl from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { Globe, Repeat, Satellite } from "lucide-react";
import { useState } from "react";
import ReactDOM from "react-dom/client";
import { whenStyleReady } from "../geo";

// CARTO's free vector GL styles - Positron for light, Dark Matter for dark.
// No API key required. Voyager (the old raster basemap) has no matching dark
// variant, which is why the theme-aware pair is used instead.
const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Unchanged raster satellite endpoint - now a MapLibre raster source layered
// on top of (just under the labels of) the vector basemap.
const SATELLITE_TILES = "https://trainapi.suddsy.dev/nz/tiles/{z}/{x}/{y}";
const SATELLITE_ATTRIBUTION =
    '&copy; <a href="https://www.linz.govt.nz">Toitū Te Whenua Land Information New Zealand</a>, imagery © Maxar Technologies, Copernicus Sentinel, and GEBCO. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.';

const SAT_SOURCE_ID = "satellite-raster";
const SAT_LAYER_ID = "satellite-raster-layer";
const AUTO_SATELLITE_MIN_ZOOM = 17;

export type MapTheme = "light" | "dark";
export type MapVariant = "satellite" | "default" | "auto";

export function styleUrlForTheme(theme: MapTheme): string {
    return theme === "dark" ? STYLE_DARK : STYLE_LIGHT;
}

// This module is in the lazily-loaded map chunk, so the moment the map code
// arrives we start pulling both style JSONs into the HTTP cache - in parallel
// with maplibre-gl parsing - so `new maplibregl.Map({ style: url })` resolves
// them instantly. (_document.tsx additionally preloads the light one.)
if (typeof window !== "undefined") {
    for (const url of [STYLE_LIGHT, STYLE_DARK]) {
        void fetch(url, { mode: "cors", credentials: "omit" }).catch(() => {});
    }
}

/**
 * Owns the basemap: the theme-aware vector style, the optional satellite raster
 * overlay, and the little style-cycle control. A `setStyle` call (theme change)
 * wipes every non-basemap source/layer the app added, so `onStyleReady` fires
 * after each (re)load to let the map component re-add its route lines etc.
 */
const OWN_LAYER_PREFIXES = ["route-line", "waypoint-line", "cluster-probe-"];

export class BasemapManager {
    private map: maplibregl.Map;
    private theme: MapTheme;
    private variant: MapVariant;
    private onStyleReady: () => void;
    private destroyed = false;
    /**
     * Base-style layers (buildings, roads, water, landuse, background) that we
     * hide while the satellite raster is showing, so the imagery isn't buried
     * under the vector fills. Labels (symbol layers) and our own overlays stay.
     * Recaptured on every style (re)load.
     */
    private hideableBaseLayers: string[] = [];

    constructor(map: maplibregl.Map, theme: MapTheme, onStyleReady: () => void) {
        this.map = map;
        this.theme = theme;
        this.variant = getMapVariant();
        this.onStyleReady = onStyleReady;

        this.map.on("zoomend", this.handleAutoZoom);
        whenStyleReady(this.map, () => this.afterStyleLoad());
    }

    setTheme(theme: MapTheme) {
        if (this.theme === theme || this.destroyed) return;
        this.theme = theme;
        this.map.setStyle(styleUrlForTheme(theme));
        whenStyleReady(this.map, () => this.afterStyleLoad());
    }

    setVariant(variant: MapVariant) {
        this.variant = setMapVariant(variant);
        this.applySatellite();
    }

    destroy() {
        this.destroyed = true;
        this.map.off("zoomend", this.handleAutoZoom);
    }

    addControl(position: maplibregl.ControlPosition) {
        this.map.addControl(new MapVariantControl(this), position);
    }

    getVariant(): MapVariant {
        return this.variant;
    }

    private afterStyleLoad() {
        if (this.destroyed) return;
        this.captureHideableBaseLayers();
        this.ensureSatelliteSource();
        this.applySatellite();
        this.onStyleReady();
    }

    private captureHideableBaseLayers() {
        // Snapshot before we (or the map component) add any of our own layers.
        this.hideableBaseLayers = [];
        for (const layer of this.map.getStyle().layers ?? []) {
            if (layer.id === SAT_LAYER_ID) continue;
            if (layer.type === "symbol") continue; // keep place/road labels over imagery
            if (OWN_LAYER_PREFIXES.some((p) => layer.id.startsWith(p))) continue;
            // Don't touch layers the style ships hidden.
            if (this.map.getLayoutProperty(layer.id, "visibility") === "none") continue;
            this.hideableBaseLayers.push(layer.id);
        }
    }

    private ensureSatelliteSource() {
        if (!this.map.getSource(SAT_SOURCE_ID)) {
            this.map.addSource(SAT_SOURCE_ID, {
                type: "raster",
                tiles: [SATELLITE_TILES],
                tileSize: 256,
                minzoom: 8,
                maxzoom: 19,
                attribution: SATELLITE_ATTRIBUTION,
            });
        }
        if (!this.map.getLayer(SAT_LAYER_ID)) {
            // Sit under the first symbol layer so the vector place/road labels
            // stay legible on top of the imagery (the old setup's labels layer).
            const firstSymbol = this.map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
            this.map.addLayer(
                {
                    id: SAT_LAYER_ID,
                    type: "raster",
                    source: SAT_SOURCE_ID,
                    layout: { visibility: "none" },
                },
                firstSymbol
            );
        }
    }

    private applySatellite() {
        if (!this.map.getLayer(SAT_LAYER_ID)) return;
        const visible =
            this.variant === "satellite" ||
            (this.variant === "auto" && this.map.getZoom() >= AUTO_SATELLITE_MIN_ZOOM);
        this.map.setLayoutProperty(SAT_LAYER_ID, "visibility", visible ? "visible" : "none");
        // With imagery showing, the vector buildings/roads/fills just obscure it -
        // drop them and leave only the labels + our overlays.
        for (const id of this.hideableBaseLayers) {
            if (this.map.getLayer(id)) {
                this.map.setLayoutProperty(id, "visibility", visible ? "none" : "visible");
            }
        }
    }

    private handleAutoZoom = () => {
        if (this.variant === "auto") this.applySatellite();
    };
}

function MapVariantControlToggle({ manager }: { manager: BasemapManager }) {
    const [currentVariant, setCurrentVariant] = useState<MapVariant>(manager.getVariant());
    const mapVariantIcons = {
        default: <Globe className="w-4 h-4" />,
        auto: <Repeat className="w-4 h-4" />,
        satellite: <Satellite className="w-4 h-4" />,
    };
    const mapVariantOrder: MapVariant[] = ["default", "auto", "satellite"];

    const currentIndex = mapVariantOrder.indexOf(currentVariant);
    const nextVariant = mapVariantOrder[(currentIndex + 1) % mapVariantOrder.length];

    return (
        <Button
            size="icon"
            variant="default"
            title={`Switch map style (${nextVariant})`}
            onClick={() => {
                manager.setVariant(nextVariant);
                setCurrentVariant(nextVariant);
            }}
            className="border-none map-control-button"
        >
            {mapVariantIcons[currentVariant]}
        </Button>
    );
}

class MapVariantControl implements maplibregl.IControl {
    private manager: BasemapManager;
    private container?: HTMLDivElement;
    private root?: ReactDOM.Root;

    constructor(manager: BasemapManager) {
        this.manager = manager;
    }

    onAdd(): HTMLElement {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl";
        container.style.background = "none";
        container.style.border = "none";
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.addEventListener("mousedown", (e) => e.stopPropagation());
        container.addEventListener("pointerdown", (e) => e.stopPropagation());
        container.addEventListener("dblclick", (e) => e.stopPropagation());

        this.root = ReactDOM.createRoot(container);
        this.root.render(<MapVariantControlToggle manager={this.manager} />);
        this.container = container;
        return container;
    }

    onRemove(): void {
        // Defer so React isn't unmounting synchronously from inside a render.
        const root = this.root;
        setTimeout(() => root?.unmount(), 0);
        this.container?.remove();
        this.container = undefined;
        this.root = undefined;
    }
}

function setMapVariant(variant: MapVariant): MapVariant {
    window.localStorage.setItem("map:variant", variant);
    return variant;
}

function getMapVariant(): MapVariant {
    const val = window.localStorage.getItem("map:variant");
    const validVariants: MapVariant[] = ["satellite", "default", "auto"];
    if (!val || val === "" || !validVariants.includes(val as MapVariant)) {
        return "default";
    }
    return val as MapVariant;
}
