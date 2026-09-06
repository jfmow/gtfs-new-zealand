import maplibregl from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { createClusterElement, createNewMarker, updateExistingMarker, type MapItem } from "./markers/create";
import { toLngLat, whenStyleReady } from "./geo";

interface MarkerManagerOptions {
    /** A marker `type` with at least this many items switches to clustered rendering. */
    clusterThreshold: number;
    clusterRadius: number;
}

const DEFAULT_THRESHOLD = 100;
const DEFAULT_RADIUS = 50;

/**
 * Keeps the map's HTML markers in sync with a list of `MapItem`s.
 *
 * Per marker `type`: below the cluster threshold each item just gets its own
 * marker, diffed in place by id (the old Leaflet behaviour). At or above it the
 * points go into a MapLibre GeoJSON source with native clustering, and only
 * what's in the current viewport is rendered as markers - cluster bubbles or
 * leaf markers - which keeps the DOM node count bounded the way
 * Leaflet.markercluster did. Item ids are unique across the whole list, so a
 * single id-keyed marker map serves both modes.
 */
export class MarkerManager {
    private map: maplibregl.Map;
    private opts: MarkerManagerOptions;

    private markers = new Map<string, maplibregl.Marker>();
    private clusterMarkers = new Map<string, maplibregl.Marker>();

    /** ids currently rendered as their own marker (plain mode). */
    private plainIds = new Set<string>();
    /** clustered type -> (id -> item) for leaf lookup during viewport render. */
    private clusteredTypes = new Map<string, Map<string, MapItem>>();
    /** id -> minZoom, for the plain-mode declutter-on-zoom behaviour. */
    private minZoom = new Map<string, number>();

    constructor(map: maplibregl.Map, opts?: Partial<MarkerManagerOptions>) {
        this.map = map;
        this.opts = {
            clusterThreshold: opts?.clusterThreshold ?? DEFAULT_THRESHOLD,
            clusterRadius: opts?.clusterRadius ?? DEFAULT_RADIUS,
        };
        this.map.on("moveend", this.renderClustered);
        this.map.on("sourcedata", this.onSourceData);
        this.map.on("zoom", this.onZoom);
    }

    getMarker(id: string): maplibregl.Marker | undefined {
        return this.markers.get(id);
    }

    setOptions(opts: Partial<MarkerManagerOptions>) {
        this.opts = {
            clusterThreshold: opts.clusterThreshold ?? this.opts.clusterThreshold,
            clusterRadius: opts.clusterRadius ?? this.opts.clusterRadius,
        };
    }

    setItems(items: MapItem[]) {
        const byType = new Map<string, MapItem[]>();
        for (const item of items) {
            const list = byType.get(item.type) ?? [];
            list.push(item);
            byType.set(item.type, list);
        }

        const nextPlain = new Map<string, MapItem>();
        const nextClusteredTypes = new Set<string>();
        for (const [type, list] of byType) {
            if (list.length >= this.opts.clusterThreshold) nextClusteredTypes.add(type);
            else for (const item of list) nextPlain.set(item.id, item);
        }

        // Tear down cluster sources for types that are no longer clustered.
        for (const type of [...this.clusteredTypes.keys()]) {
            if (!nextClusteredTypes.has(type)) this.teardownClusterSource(type);
        }

        // Plain markers: drop the ones that left, upsert the rest.
        for (const id of [...this.plainIds]) {
            if (!nextPlain.has(id)) {
                this.markers.get(id)?.remove();
                this.markers.delete(id);
                this.plainIds.delete(id);
            }
        }
        this.minZoom.clear();
        const zoom = this.map.getZoom();
        for (const [id, item] of nextPlain) {
            if (item.minZoom !== undefined) this.minZoom.set(id, item.minZoom);
            const belowMinZoom = item.minZoom !== undefined && zoom < item.minZoom;
            const existing = this.markers.get(id);
            if (existing) {
                updateExistingMarker(item, existing);
                if (belowMinZoom) existing.remove();
                else existing.addTo(this.map);
            } else {
                const marker = createNewMarker(item);
                this.markers.set(id, marker);
                if (!belowMinZoom) marker.addTo(this.map);
            }
            this.plainIds.add(id);
        }

        // Clustered types: (re)fill their GeoJSON sources.
        for (const type of nextClusteredTypes) {
            this.syncClusterSource(type, byType.get(type) ?? []);
        }

        this.renderClustered();
    }

    destroy() {
        this.map.off("moveend", this.renderClustered);
        this.map.off("sourcedata", this.onSourceData);
        this.map.off("zoom", this.onZoom);
        for (const m of this.markers.values()) m.remove();
        for (const m of this.clusterMarkers.values()) m.remove();
        this.markers.clear();
        this.clusterMarkers.clear();
        for (const type of [...this.clusteredTypes.keys()]) this.teardownClusterSource(type);
    }

    /** Re-add cluster sources after a basemap style reload wiped them. */
    reattachSources() {
        const snapshot = [...this.clusteredTypes.entries()].map(([type, lookup]) => ({
            type,
            list: [...lookup.values()],
        }));
        this.clusteredTypes.clear();
        for (const { type, list } of snapshot) this.syncClusterSource(type, list);
        this.renderClustered();
    }

    private onZoom = () => {
        if (this.minZoom.size === 0) return;
        const zoom = this.map.getZoom();
        for (const [id, min] of this.minZoom) {
            const marker = this.markers.get(id);
            if (!marker) continue;
            const shown = marker.getElement().isConnected;
            const shouldShow = zoom >= min;
            if (shouldShow && !shown) marker.addTo(this.map);
            else if (!shouldShow && shown) marker.remove();
        }
    };

    // ---- clustered mode -------------------------------------------------

    private sourceId(type: string) {
        return `cluster-src-${type}`;
    }

    private probeLayerId(type: string) {
        return `cluster-probe-${type}`;
    }

    private syncClusterSource(type: string, list: MapItem[]) {
        this.clusteredTypes.set(type, new Map(list.map((i) => [i.id, i])));

        const data: FeatureCollection = {
            type: "FeatureCollection",
            features: list.map((item) => ({
                type: "Feature",
                properties: { id: item.id },
                geometry: { type: "Point", coordinates: toLngLat([item.lat, item.lon]) as [number, number] },
            })),
        };

        // addSource/addLayer throw if the style isn't fully parsed (initial load,
        // or mid theme swap), so defer until it is.
        whenStyleReady(this.map, () => {
            if (!this.clusteredTypes.has(type)) return; // no longer clustered
            const src = this.map.getSource(this.sourceId(type)) as maplibregl.GeoJSONSource | undefined;
            if (src) {
                src.setData(data);
            } else {
                this.map.addSource(this.sourceId(type), {
                    type: "geojson",
                    data,
                    cluster: true,
                    clusterRadius: this.opts.clusterRadius,
                    clusterMaxZoom: 16,
                });
            }

            // MapLibre only tiles a source that at least one layer references, and
            // querySourceFeatures reads from those tiles - so add an invisible
            // circle layer purely to make the cluster index build and be queryable.
            if (!this.map.getLayer(this.probeLayerId(type))) {
                this.map.addLayer({
                    id: this.probeLayerId(type),
                    type: "circle",
                    source: this.sourceId(type),
                    paint: { "circle-radius": 0, "circle-opacity": 0 },
                });
            }
            this.renderClustered();
        });
    }

    private teardownClusterSource(type: string) {
        const lookup = this.clusteredTypes.get(type);
        for (const id of lookup?.keys() ?? []) {
            this.markers.get(id)?.remove();
            this.markers.delete(id);
        }
        this.clusteredTypes.delete(type);
        for (const [key, m] of [...this.clusterMarkers]) {
            if (key.startsWith(`cl_${type}_`)) {
                m.remove();
                this.clusterMarkers.delete(key);
            }
        }
        try {
            if (this.map.getLayer(this.probeLayerId(type))) this.map.removeLayer(this.probeLayerId(type));
            if (this.map.getSource(this.sourceId(type))) this.map.removeSource(this.sourceId(type));
        } catch {
            /* style already gone */
        }
    }

    private onSourceData = (e: maplibregl.MapSourceDataEvent) => {
        if (e.sourceId?.startsWith("cluster-src-") && e.isSourceLoaded) this.renderClustered();
    };

    private renderClustered = () => {
        if (this.clusteredTypes.size === 0) return;

        const keepLeaves = new Set<string>();
        const keepClusters = new Set<string>();
        // Only cull a type's markers once we've actually read its source this
        // pass - querySourceFeatures returns [] for a fraction of a second while
        // the cluster index (re)builds, and culling on that would flush every
        // marker off the map only to re-add it a frame later (visible flicker).
        const culledTypes = new Set<string>();

        for (const [type, lookup] of this.clusteredTypes) {
            const srcId = this.sourceId(type);
            if (!this.map.getSource(srcId)) continue;
            const source = this.map.getSource(srcId) as maplibregl.GeoJSONSource;

            let features: maplibregl.GeoJSONFeature[];
            try {
                features = this.map.querySourceFeatures(srcId);
            } catch {
                continue;
            }

            if (features.length === 0 && lookup.size > 0 && !this.map.isSourceLoaded(srcId)) {
                continue;
            }
            culledTypes.add(type);

            const seen = new Set<string>();
            for (const f of features) {
                const props = f.properties ?? {};
                const coords = (f.geometry as Point).coordinates as [number, number];

                if (props.cluster) {
                    const key = `cl_${type}_${props.cluster_id}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    keepClusters.add(key);
                    const count = Number(props.point_count) || 0;
                    const existing = this.clusterMarkers.get(key);
                    if (existing) {
                        existing.setLngLat(coords);
                        const label = existing.getElement().querySelector("div > div");
                        if (label && label.textContent?.trim() !== String(count)) {
                            label.textContent = String(count);
                        }
                    } else {
                        const el = createClusterElement(count);
                        el.addEventListener("click", () => {
                            source
                                .getClusterExpansionZoom(Number(props.cluster_id))
                                .then((z) => this.map.easeTo({ center: coords, zoom: z, duration: 400 }))
                                .catch(() => {});
                        });
                        this.clusterMarkers.set(
                            key,
                            new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(this.map)
                        );
                    }
                } else {
                    const id = String(props.id ?? "");
                    const item = lookup.get(id);
                    if (!item || seen.has(id)) continue;
                    seen.add(id);
                    keepLeaves.add(id);
                    const existing = this.markers.get(id);
                    if (existing) {
                        updateExistingMarker(item, existing);
                        existing.addTo(this.map);
                    } else {
                        const marker = createNewMarker(item);
                        this.markers.set(id, marker);
                        marker.addTo(this.map);
                    }
                }
            }
        }

        for (const [key, m] of [...this.clusterMarkers]) {
            const type = key.slice(3, key.lastIndexOf("_"));
            if (culledTypes.has(type) && !keepClusters.has(key)) {
                m.remove();
                this.clusterMarkers.delete(key);
            }
        }
        for (const [id, m] of [...this.markers]) {
            if (this.plainIds.has(id) || keepLeaves.has(id)) continue;
            const type = this.typeOfClusteredId(id);
            if (type && culledTypes.has(type)) {
                m.remove();
                this.markers.delete(id);
            }
        }
    };

    private typeOfClusteredId(id: string): string | undefined {
        for (const [type, lookup] of this.clusteredTypes) {
            if (lookup.has(id)) return type;
        }
        return undefined;
    }
}
