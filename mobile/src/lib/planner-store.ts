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
}

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = { maxWalkKm: 1, maxTransfers: 5, modes: [], onlyRoutes: [] }

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
    return o.maxWalkKm !== DEFAULT_PLANNER_OPTIONS.maxWalkKm || o.maxTransfers !== DEFAULT_PLANNER_OPTIONS.maxTransfers || o.modes.length > 0 || o.onlyRoutes.length > 0
}
