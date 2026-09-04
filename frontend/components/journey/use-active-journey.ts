import { useCallback, useEffect, useState } from "react"
import type { JourneyType, Location } from "./types"

/**
 * The journey a rider is currently tracking, persisted to localStorage so a
 * closed/reloaded tab can offer to resume it. Same-device only (matches
 * use-saved-trips.ts: localStorage + a CustomEvent + SSR-safe empty init).
 * Auto-expires once the journey is well past its scheduled arrival.
 */
export interface ActiveJourney {
    /** The ORIGINAL planned route (keeps plan.ID; not the live-time-shifted copy). */
    route: JourneyType
    startedAt: string
    endLabel: string
    /** route.ArrivalTime ISO - drives the stale check. */
    arrivalTime: string
    startLocation: Location | null
    endLocation: Location | null
    /** plan.ID, for an opportunistic server rehydrate when the plan store is available. */
    planId?: string
}

const STORAGE_KEY = "activeJourney"
const EVENT = "activeJourneyUpdated"
export const RESUME_GRACE_MS = 45 * 60 * 1000
/** Set by the app-wide resume popup's dismiss button; cleared when a new journey is tracked. */
export const RESUME_PROMPT_DISMISSED_KEY = "resumePromptDismissed"

function read(): ActiveJourney | null {
    if (typeof window === "undefined") return null
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as ActiveJourney
        if (!parsed?.route || !parsed?.arrivalTime) return null
        return parsed
    } catch {
        return null
    }
}

function write(j: ActiveJourney | null) {
    try {
        if (j) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(j))
            // A newly tracked journey should re-prompt even if a prior one was dismissed.
            sessionStorage.removeItem(RESUME_PROMPT_DISMISSED_KEY)
        } else {
            localStorage.removeItem(STORAGE_KEY)
        }
    } catch {
        // storage unavailable - resume just won't persist
    }
    window.dispatchEvent(new CustomEvent(EVENT))
}

function isFresh(j: ActiveJourney | null): j is ActiveJourney {
    return !!j && Date.now() < new Date(j.arrivalTime).getTime() + RESUME_GRACE_MS
}

export function useActiveJourney() {
    const [activeJourney, setActiveJourneyState] = useState<ActiveJourney | null>(null)

    useEffect(() => {
        const refresh = () => {
            const j = read()
            if (j && !isFresh(j)) {
                write(null)
                setActiveJourneyState(null)
            } else {
                setActiveJourneyState(j)
            }
        }
        refresh()
        window.addEventListener(EVENT, refresh)
        return () => window.removeEventListener(EVENT, refresh)
    }, [])

    const setActiveJourney = useCallback((j: ActiveJourney) => write(j), [])
    const clearActiveJourney = useCallback(() => write(null), [])

    return { activeJourney: isFresh(activeJourney) ? activeJourney : null, setActiveJourney, clearActiveJourney }
}
