"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import { Navigation, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatTime } from "./helpers"
import { useActiveJourney, RESUME_PROMPT_DISMISSED_KEY, RESUME_GRACE_MS } from "./use-active-journey"

/**
 * App-wide "you're mid-journey" nudge. `/plan` and `/journey` surface the active
 * journey with their own UI, so the popup only shows on the other pages.
 * Rendered once from _app.tsx.
 */
export function ResumeJourneyPrompt() {
    const router = useRouter()
    const { activeJourney } = useActiveJourney()
    const [dismissed, setDismissed] = useState(true)
    // Ticks so the popup self-hides at the 45-min grace boundary without a nav.
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
    if (router.pathname === "/plan" || router.pathname === "/journey") return null
    if (Date.now() >= new Date(activeJourney.arrivalTime).getTime() + RESUME_GRACE_MS) return null

    const dismiss = () => {
        try { sessionStorage.setItem(RESUME_PROMPT_DISMISSED_KEY, "1") } catch { /* ignore */ }
        setDismissed(true)
    }

    return (
        <div className="fixed inset-x-0 bottom-16 z-50 flex justify-center px-3 sm:bottom-4">
            <div className="flex w-full max-w-sm items-center gap-2 rounded-xl border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur">
                <Navigation className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Journey to {activeJourney.endLabel}</p>
                    <p className="text-[11px] text-muted-foreground">arrives {formatTime(activeJourney.arrivalTime)}</p>
                </div>
                <Button size="sm" className="h-8 shrink-0 px-3 text-xs" onClick={() => router.push("/plan?resume=1")}>
                    Resume
                </Button>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={dismiss}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    )
}
