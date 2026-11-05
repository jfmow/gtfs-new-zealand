import { stored, useStored } from "./storage"

/** The Map tab's filters - shared with the "Find a route…" sheet. Kept between launches, like iOS. */
export interface MapFilter {
    kind: "all" | "bus" | "train" | "ferry"
    /** Vehicles: only these routes (route ids); empty = every route. */
    routes: { id: string; name: string }[]
    /** Vehicles: show stops underneath. */
    showStops: boolean
    threeD: boolean
}

export const mapFilterStore = stored<MapFilter>("map-filter", { kind: "all", routes: [], showStops: false, threeD: false })

export function useMapFilter(): [MapFilter, (patch: Partial<MapFilter>) => void] {
    const [f, set] = useStored(mapFilterStore)
    return [f, (patch) => set((prev) => ({ ...prev, ...patch }))]
}
