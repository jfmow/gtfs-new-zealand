import type { TravelMode } from "@transit/shared/endpoints"
import { stored, useStored } from "./storage"

/**
 * The Planner's "when" and options - shared by the Planner tab and its
 * "Leave now ▾" and "Options" sheets. Options persist (iOS keeps them);
 * the time resets to "now" each launch.
 */
export interface PlannerWhen {
    mode: "now" | "departat" | "arriveat"
    /** Epoch ms for departat / arriveat. */
    at: number | null
}

export interface PlannerOptions {
    maxWalkKm: number
    maxTransfers: number
    modes: TravelMode[]
    onlyRoutes: { id: string; name: string }[]
    /** Easier access: short walks, changes within a stop or station, more time to change. */
    accessible: boolean
}

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = { maxWalkKm: 1, maxTransfers: 5, modes: [], onlyRoutes: [], accessible: false }

let when: PlannerWhen = { mode: "now", at: null }
const whenListeners = new Set<() => void>()
export const plannerWhenStore = {
    get: () => when,
    set(next: PlannerWhen) {
        when = next
        whenListeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
        whenListeners.add(l)
        return () => whenListeners.delete(l)
    },
}

export const plannerOptionsStore = stored<PlannerOptions>("planner-options", DEFAULT_PLANNER_OPTIONS, (raw) => ({ ...DEFAULT_PLANNER_OPTIONS, ...(raw as Partial<PlannerOptions>) }))

export function usePlannerOptions(): [PlannerOptions, (patch: Partial<PlannerOptions>) => void] {
    const [o, set] = useStored(plannerOptionsStore)
    return [o, (patch) => set((prev) => ({ ...prev, ...patch }))]
}

/** "Leave now", "Leave 6:45pm", "Arrive by 9:00am". */
export function whenLabel(w: PlannerWhen, clock: (d: Date) => string): string {
    if (w.mode === "now" || !w.at) return "Leave now"
    return `${w.mode === "arriveat" ? "Arrive by" : "Leave"} ${clock(new Date(w.at))}`
}

export function optionsChanged(o: PlannerOptions): boolean {
    return o.maxWalkKm !== DEFAULT_PLANNER_OPTIONS.maxWalkKm || o.maxTransfers !== DEFAULT_PLANNER_OPTIONS.maxTransfers || o.modes.length > 0 || o.onlyRoutes.length > 0 || o.accessible
}

/** A destination the rider searched for and picked - the Planner's "Recent" list. */
export interface RecentDestination {
    region: string
    label: string
    lat: number
    lon: number
    at: number
}

const recentStore = stored<RecentDestination[]>("planner-recent", [])
const MAX_RECENT = 5

/** The last few destinations picked in this region, newest first (same spot = same entry). */
export function useRecentDestinations(region: string) {
    const [all, set] = useStored(recentStore)
    const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4
    return {
        recent: all.filter((r) => r.region === region).sort((a, b) => b.at - a.at).slice(0, MAX_RECENT),
        add: (p: { label: string; lat: number; lon: number }) =>
            set((prev) => {
                const mine = [{ region, label: p.label, lat: p.lat, lon: p.lon, at: Date.now() }, ...prev.filter((r) => r.region === region && !same(r, p))].slice(0, MAX_RECENT)
                return [...prev.filter((r) => r.region !== region), ...mine]
            }),
        clear: () => set((prev) => prev.filter((r) => r.region !== region)),
    }
}
