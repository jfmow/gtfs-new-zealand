import type { Map as MKMap, MapKit } from "@apple/mapkit-loader";
import { Button } from "@/components/ui/button";
import { Globe, Repeat, Satellite } from "lucide-react";
import { useState } from "react";
import { currentZoom } from "./geo";

const AUTO_SATELLITE_MIN_ZOOM = 17;

export type MapTheme = "light" | "dark";
export type MapVariant = "satellite" | "default" | "auto";

/**
 * Owns the Apple basemap: light/dark colour scheme, and the map variant -
 * standard, hybrid (satellite + labels), or "auto" (hybrid once zoomed right in).
 * Points of interest are off, as on iOS, so they don't compete with the stops.
 */
export class BasemapManager {
    private mk: MapKit;
    private map: MKMap;
    private variant: MapVariant;
    private listeners = new Set<(v: MapVariant) => void>();

    constructor(mk: MapKit, map: MKMap, theme: MapTheme) {
        this.mk = mk;
        this.map = map;
        this.variant = getMapVariant();
        this.map.showsPointsOfInterest = false;
        this.setTheme(theme);
        this.apply();
        this.map.addEventListener("region-change-end", this.handleAutoZoom);
    }

    setTheme(theme: MapTheme) {
        this.map.colorScheme = theme === "dark" ? this.mk.ColorScheme.Dark : this.mk.ColorScheme.Light;
    }

    setVariant(variant: MapVariant) {
        this.variant = setMapVariant(variant);
        this.apply();
        this.listeners.forEach((l) => l(variant));
    }

    getVariant(): MapVariant {
        return this.variant;
    }

    subscribe(listener: (v: MapVariant) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    destroy() {
        this.map.removeEventListener("region-change-end", this.handleAutoZoom);
        this.listeners.clear();
    }

    private apply() {
        const satellite =
            this.variant === "satellite" ||
            (this.variant === "auto" && currentZoom(this.map) >= AUTO_SATELLITE_MIN_ZOOM);
        const type = satellite ? this.mk.MapType.Hybrid : this.mk.MapType.Standard;
        if (this.map.mapType !== type) this.map.mapType = type;
    }

    private handleAutoZoom = () => {
        if (this.variant === "auto") this.apply();
    };
}

const mapVariantIcons = {
    default: <Globe className="w-4 h-4" />,
    auto: <Repeat className="w-4 h-4" />,
    satellite: <Satellite className="w-4 h-4" />,
};
const mapVariantOrder: MapVariant[] = ["default", "auto", "satellite"];

export function MapVariantToggle({ manager }: { manager: BasemapManager }) {
    const [currentVariant, setCurrentVariant] = useState<MapVariant>(manager.getVariant());
    const nextVariant = mapVariantOrder[(mapVariantOrder.indexOf(currentVariant) + 1) % mapVariantOrder.length];

    return (
        <Button
            size="icon"
            variant="default"
            title={`Switch map style (${nextVariant})`}
            onClick={() => {
                manager.setVariant(nextVariant);
                setCurrentVariant(nextVariant);
            }}
            className="map-control-button"
        >
            {mapVariantIcons[currentVariant]}
        </Button>
    );
}

function setMapVariant(variant: MapVariant): MapVariant {
    try {
        window.localStorage.setItem("map:variant", variant);
    } catch { /* storage blocked */ }
    return variant;
}

function getMapVariant(): MapVariant {
    let val: string | null = null;
    try {
        val = window.localStorage.getItem("map:variant");
    } catch { /* storage blocked */ }
    return val && (mapVariantOrder as string[]).includes(val) ? (val as MapVariant) : "default";
}
