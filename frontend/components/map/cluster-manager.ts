import type { Annotation, Map as MKMap, MapKit } from "@apple/mapkit-loader";
import Supercluster from "supercluster";
import { createAnnotation, createClusterAnnotation, updateAnnotation, type MapItem } from "./markers/create";
import { currentZoom, setView, viewBBox } from "./geo";

interface MarkerManagerOptions {
    /** A marker `type` with at least this many items switches to clustered rendering. */
    clusterThreshold: number;
    clusterRadius: number;
}

const DEFAULT_THRESHOLD = 100;
const DEFAULT_RADIUS = 50;

type ClusterProps = { id: string };

/**
 * Keeps the map's annotations in sync with a list of `MapItem`s.
 *
 * Per marker `type`: below the cluster threshold each item just gets its own
 * annotation, diffed in place by id. At or above it the points go into a
 * Supercluster index and only what's in (or near) the viewport is put on the
 * map - cluster bubbles or leaf markers - which keeps the DOM node count
 * bounded on the ~6.5k-stop maps. MapKit's own clustering is not used: it
 * keeps every member annotation in the DOM.
 */
export class MarkerManager {
    private mk: MapKit;
    private map: MKMap;
    private opts: MarkerManagerOptions;

    private annotations = new Map<string, Annotation>();
    private clusterAnnotations = new Map<string, Annotation>();
    /** ids currently on the map (annotation.map is set). */
    private shown = new Set<string>();

    /** ids rendered as their own marker (plain mode). */
    private plainIds = new Set<string>();
    /** clustered type -> index + (id -> item). */
    private clustered = new Map<string, { index: Supercluster<ClusterProps>; lookup: Map<string, MapItem> }>();
    /** id -> minZoom, for the plain-mode declutter-on-zoom behaviour. */
    private minZoom = new Map<string, number>();

    constructor(mk: MapKit, map: MKMap, opts?: Partial<MarkerManagerOptions>) {
        this.mk = mk;
        this.map = map;
        this.opts = {
            clusterThreshold: opts?.clusterThreshold ?? DEFAULT_THRESHOLD,
            clusterRadius: opts?.clusterRadius ?? DEFAULT_RADIUS,
        };
        this.map.addEventListener("region-change-end", this.onRegionChange);
    }

    getAnnotation(id: string): Annotation | undefined {
        return this.annotations.get(id);
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
        const nextClustered = new Map<string, MapItem[]>();
        for (const [type, list] of byType) {
            if (list.length >= this.opts.clusterThreshold) nextClustered.set(type, list);
            else for (const item of list) nextPlain.set(item.id, item);
        }

        // Types that stopped being clustered: drop their leaves + bubbles.
        for (const type of [...this.clustered.keys()]) {
            if (!nextClustered.has(type)) this.teardownClusterType(type);
        }

        // Plain annotations: drop the ones that left, upsert the rest.
        for (const id of [...this.plainIds]) {
            if (!nextPlain.has(id)) {
                this.hide(id);
                this.annotations.delete(id);
                this.plainIds.delete(id);
            }
        }
        this.minZoom.clear();
        const zoom = currentZoom(this.map);
        for (const [id, item] of nextPlain) {
            if (item.minZoom !== undefined) this.minZoom.set(id, item.minZoom);
            this.upsert(item);
            this.plainIds.add(id);
            if (item.minZoom !== undefined && zoom < item.minZoom) this.hide(id);
            else this.show(id);
        }

        for (const [type, list] of nextClustered) {
            const index = new Supercluster<ClusterProps>({ radius: this.opts.clusterRadius, maxZoom: 16 });
            index.load(list.map((item) => ({
                type: "Feature",
                properties: { id: item.id },
                geometry: { type: "Point", coordinates: [item.lon, item.lat] },
            })));
            this.clustered.set(type, { index, lookup: new Map(list.map((i) => [i.id, i])) });
        }

        this.renderClustered();
    }

    destroy() {
        this.map.removeEventListener("region-change-end", this.onRegionChange);
        const all = [...this.annotations.values(), ...this.clusterAnnotations.values()].filter((a) => a.map);
        if (all.length) this.map.removeAnnotations(all);
        this.annotations.clear();
        this.clusterAnnotations.clear();
        this.shown.clear();
        this.clustered.clear();
    }

    private upsert(item: MapItem): Annotation {
        const existing = this.annotations.get(item.id);
        if (existing) return updateAnnotation(this.mk, item, existing);
        const a = createAnnotation(this.mk, item);
        this.annotations.set(item.id, a);
        return a;
    }

    private show(id: string) {
        const a = this.annotations.get(id);
        if (!a || this.shown.has(id)) return;
        this.map.addAnnotation(a);
        this.shown.add(id);
    }

    private hide(id: string) {
        const a = this.annotations.get(id);
        if (a && this.shown.has(id)) this.map.removeAnnotation(a);
        this.shown.delete(id);
    }

    private onRegionChange = () => {
        if (this.minZoom.size > 0) {
            const zoom = currentZoom(this.map);
            for (const [id, min] of this.minZoom) {
                if (zoom >= min) this.show(id);
                else this.hide(id);
            }
        }
        this.renderClustered();
    };

    private teardownClusterType(type: string) {
        const entry = this.clustered.get(type);
        for (const id of entry?.lookup.keys() ?? []) {
            this.hide(id);
            this.annotations.delete(id);
        }
        for (const [key, a] of [...this.clusterAnnotations]) {
            if (key.startsWith(`cl_${type}_`)) {
                if (a.map) this.map.removeAnnotation(a);
                this.clusterAnnotations.delete(key);
            }
        }
        this.clustered.delete(type);
    }

    private renderClustered = () => {
        if (this.clustered.size === 0) return;
        // Supercluster's radius is in pixels of 512px tiles - the same zoom scale as geo.ts.
        // MapKit lands a hair under the zoom asked for (17 → 16.99).
        const zoom = Math.floor(currentZoom(this.map) + 0.02);
        const bbox = viewBBox(this.map);

        const keepLeaves = new Set<string>();
        const keepClusters = new Set<string>();
        const addClusters: Annotation[] = [];

        for (const [type, { index, lookup }] of this.clustered) {
            for (const f of index.getClusters(bbox, zoom)) {
                const [lon, lat] = f.geometry.coordinates;
                const props = f.properties as Partial<Supercluster.ClusterProperties> & Partial<ClusterProps>;
                if (props.cluster) {
                    const clusterId = props.cluster_id as number;
                    const count = props.point_count ?? 0;
                    const key = `cl_${type}_${clusterId}_${count}`;
                    keepClusters.add(key);
                    if (this.clusterAnnotations.has(key)) continue;
                    const a = createClusterAnnotation(this.mk, lat, lon, count, () => {
                        const z = Math.min(index.getClusterExpansionZoom(clusterId), 18);
                        setView(this.mk, this.map, [lat, lon], z);
                    });
                    this.clusterAnnotations.set(key, a);
                    addClusters.push(a);
                } else {
                    const item = lookup.get(props.id ?? "");
                    if (!item) continue;
                    keepLeaves.add(item.id);
                    this.upsert(item);
                    this.show(item.id);
                }
            }
        }

        const removeClusters: Annotation[] = [];
        for (const [key, a] of [...this.clusterAnnotations]) {
            if (!keepClusters.has(key)) {
                if (a.map) removeClusters.push(a);
                this.clusterAnnotations.delete(key);
            }
        }
        if (removeClusters.length) this.map.removeAnnotations(removeClusters);
        if (addClusters.length) this.map.addAnnotations(addClusters);

        for (const { lookup } of this.clustered.values()) {
            for (const id of lookup.keys()) {
                if (!keepLeaves.has(id) && this.shown.has(id)) {
                    this.hide(id);
                    this.annotations.delete(id);
                }
            }
        }
    };
}
