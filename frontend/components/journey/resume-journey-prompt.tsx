"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import { Navigation, X } from "lucide-react"
import { formatTime } from "./helpers"
import { useActiveJourney, RESUME_PROMPT_DISMISSED_KEY, RESUME_GRACE_MS } from "./use-active-journey"

/**
 * Persistent, unobtrusive "you're mid-journey" pill pinned just under the nav.
 * Stays put on every page until it's dismissed, the journey arrives, or a new
 * journey replaces it (use-active-journey clears the dismiss flag on write).
 * Suppressed only on /journey, which is the full-screen view of the journey
 * itself. Rendered once from _app.tsx.
 */
export function ResumeJourneyPrompt() {
    const router = useRouter()
    const { activeJourney } = useActiveJourney()
    const [dismissed, setDismissed] = useState(true)
    // Ticks so the pill self-hides at the 45-min grace boundary without a nav.
    const [, setTick] = useState(0)

    useEffect(() => {
        try {
            setDismissed(sessionStorage.getItem(RESUME_PROMPT_DISMISSED_KEY) === "1")
        } catch {
            setDismissed(false)
        }
        const id = setInterval(() => setTick((t) => t + 1), 30_000)
        return () => clearInterval(id)
    }, [activeJourney])

    if (!activeJourney || dismissed) return null
    if (router.pathname === "/journey") return null
    if (Date.now() >= new Date(activeJourney.arrivalTime).getTime() + RESUME_GRACE_MS) return null

    const dismiss = () => {
        try { sessionStorage.setItem(RESUME_PROMPT_DISMISSED_KEY, "1") } catch { /* ignore */ }
        setDismissed(true)
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3">
            <div className="pointer-events-auto flex w-full max-w-sm items-center gap-1.5 rounded-full border bg-background/95 py-1 pl-3 pr-1 text-sm shadow-lg backdrop-blur">
                <button
                    type="button"
                    onClick={() => router.push("/plan?resume=1")}
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                >
                    <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate font-medium">Resume journey to {activeJourney.endLabel}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">· {formatTime(activeJourney.arrivalTime)}</span>
                </button>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={dismiss}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}
