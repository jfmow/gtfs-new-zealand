import { useCallback, useEffect, useState } from "react"

/** Settings -> Planner: the full planner, or four simple questions (the iOS `PlannerStyle`). */
export type PlannerStyle = "standard" | "stepByStep"

const KEY = "plannerStyle"
const EVENT = "plannerStyleChanged"

function read(): PlannerStyle {
    try {
        return localStorage.getItem(KEY) === "stepByStep" ? "stepByStep" : "standard"
    } catch {
        return "standard"
    }
}

/** The chosen planner style, and a setter that updates every page using it. `null` until read on the client. */
export function usePlannerStyle(): [PlannerStyle | null, (style: PlannerStyle) => void] {
    const [style, setStyleState] = useState<PlannerStyle | null>(null)

    useEffect(() => {
        setStyleState(read())
        const sync = () => setStyleState(read())
        window.addEventListener(EVENT, sync)
        window.addEventListener("storage", sync)
        return () => {
            window.removeEventListener(EVENT, sync)
            window.removeEventListener("storage", sync)
        }
    }, [])

    const setStyle = useCallback((next: PlannerStyle) => {
        try { localStorage.setItem(KEY, next) } catch { /* private mode - just this session */ }
        setStyleState(next)
        window.dispatchEvent(new Event(EVENT))
    }, [])

    return [style, setStyle]
}
