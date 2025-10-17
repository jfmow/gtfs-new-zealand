import leaflet from "leaflet"
import { Button } from "@/components/ui/button";
import { Globe, Repeat, Satellite } from "lucide-react";
import { useState } from "react";
import ReactDOM from "react-dom/client";

const SATELLITE_TILELAYER = "https://trainapi.suddsy.dev/nz/tiles/{z}/{x}/{y}"
const PLAIN_TILELAYER = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
const LABELS_TILELAYER = "https://{s}.basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}{r}.png"

type MapVariant = "satellite" | "default" | "auto"


export default function addMapVariantControlControl(map: leaflet.Map, position: leaflet.ControlPosition = "topright") {
    //Set default layer
    setTileLayer(getMapVariant(), map)

    const variantControl = new leaflet.Control({ position });
    variantControl.onAdd = () => {
        const container = leaflet.DomUtil.create('div');
        container.style.background = "none";
        container.style.border = "none";
        container.style.display = "flex";
        container.style.alignItems = "center";

        // Prevent map events when interacting with the select
        container.addEventListener("mousedown", e => e.stopPropagation());
        container.addEventListener("pointerdown", e => e.stopPropagation());
        container.addEventListener("dblclick", e => e.stopPropagation());

        // Render the shadcn select menu into the container
        const root = ReactDOM.createRoot(container);
        root.render(
            <MapVariantToggle
                value={getMapVariant()}
                onChange={variant => {
                    setMapVariant(variant);
                    setTileLayer(variant, map)
                    return variant
                }}
            />
        );
        return container;
    };
    map.addControl(variantControl);

    // Helper to get the current tile layer URL template
    function getCurrentTileLayerTemplate(map: leaflet.Map): string | null {
        let found: string | null = null;
        map.eachLayer((layer) => {
            type TileLayerWithUrl = leaflet.TileLayer & { _url: string };
            if (
                layer instanceof leaflet.TileLayer &&
                typeof (layer as TileLayerWithUrl)._url === "string"
            ) {
                const url = (layer as TileLayerWithUrl)._url;
                // Ignore the labels only layer
                if (url === LABELS_TILELAYER) return;
                found = url;
            }
        });
        return found;
    }

    const handler = () => {
        if (getMapVariant() === "auto") {
            const zoom = map.getZoom();
            const currentTemplate = getCurrentTileLayerTemplate(map);
            const defaultTemplate = PLAIN_TILELAYER;
            const satelliteTemplate = SATELLITE_TILELAYER;

            if (zoom >= 17 && currentTemplate !== satelliteTemplate) {
                setTileLayer("satellite", map);
            } else if (zoom < 17 && currentTemplate !== defaultTemplate) {
                setTileLayer("default", map);
            }
        }
    };
    map.on("zoomend", handler);
    handler();
}

function setTileLayer(variant: MapVariant, map: leaflet.Map) {
    // Remove all existing tile layers
    map.eachLayer((layer) => {
        // Only remove tile layers (not markers, overlays, etc.)
        if (layer instanceof leaflet.TileLayer) {
            try {
                map.removeLayer(layer);
            } catch { }
        }
    });

    switch (variant) {
        case "default":
            leaflet.tileLayer(PLAIN_TILELAYER, {
                maxZoom: 19,
                minZoom: 8,
                attribution: '&copy; <a href="https://www.carto.com/attributions">CARTO</a>'
            }).addTo(map);
            break;
        case "satellite":
            leaflet.tileLayer(SATELLITE_TILELAYER, {
                maxZoom: 19,
                minZoom: 8,
                attribution: `&copy; <a href="https://www.linz.govt.nz">Toitū Te Whenua Land Information New Zealand</a>, imagery © Maxar Technologies, Copernicus Sentinel, and GEBCO. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.`
            }).addTo(map);
            break;
        default:
            leaflet.tileLayer(PLAIN_TILELAYER, {
                maxZoom: 19,
                minZoom: 8,
                attribution: '&copy; <a href="https://www.carto.com/attributions">CARTO</a>'
            }).addTo(map);
            break;
    }

    //Labels only
    leaflet.tileLayer(LABELS_TILELAYER, {
        maxZoom: 19,
        minZoom: 8,
        attribution: '&copy; <a href="https://www.carto.com/attributions">CARTO</a>',
        pane: 'overlayPane'
    }).addTo(map);
}

function MapVariantToggle({ value, onChange }: { value: MapVariant, onChange: (v: MapVariant) => MapVariant }) {
    const [currentVariant, setCurrentVariant] = useState<MapVariant>(value);
    const mapVariantIcons = {
        default: <Globe className="w-4 h-4" />,
        auto: <Repeat className="w-4 h-4" />,
        satellite: <Satellite className="w-4 h-4" />,
    };
    const mapVariantOrder: MapVariant[] = ["default", "auto", "satellite"];

    // Determine the next variant in the cycle
    const currentIndex = mapVariantOrder.indexOf(currentVariant);
    const nextVariant = mapVariantOrder[(currentIndex + 1) % mapVariantOrder.length];

    return (
        <Button
            size="icon"
            variant="default"
            title={`Switch map style (${nextVariant})`
            }
            onClick={() => {
                const newVal = onChange(nextVariant);
                setCurrentVariant(newVal);
            }}
            className="border-none"
        >
            {mapVariantIcons[currentVariant]}
        </Button>
    );
}

function setMapVariant(variant: MapVariant) {
    window.localStorage.setItem("map:variant", variant)
    return variant
}

function getMapVariant(): MapVariant {
    const val = window.localStorage.getItem("map:variant")
    const validVariants: MapVariant[] = ["satellite", "default", "auto"];
    if (!val || val === "" || !validVariants.includes(val as MapVariant)) {
        return "default"
    } else {
        return val as MapVariant
    }
}