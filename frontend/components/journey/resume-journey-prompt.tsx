"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/router"
import { Navigation, X } from "lucide-react"
import { formatTime } from "./helpers"
import { useActiveJourney, RESUME_PROMPT_DISMISSED_KEY, RESUME_GRACE_MS } from "./use-active-journey"

/**
 * "You're mid-journey" - the iOS app's resume card: docked just above the tab
 * bar on phones (bottom of the screen on desktop). Stays until it's
 * dismissed, the journey arrives (+45 min), or a new journey replaces it
 * (use-active-journey clears the dismiss flag on write). Hidden on /journey,
 * while a full-screen map is up (`data-hide-immersive`), and while a
 * journey's detail is open on any layout (`data-resume-prompt`). Rendered
 * once from _app.tsx.
 */
export function ResumeJourneyPrompt() {
    const router = useRouter()
    const { activeJourney } = useActiveJourney()
    const [dismissed, setDismissed] = useState(true)
    // Ticks so the card self-hides at the 45-min grace boundary without a nav.
    const [, setTick] = useState(0)
    const reportHeight = useReportedHeight("--resume-h")

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

    const arrives = formatTime(activeJourney.arrivalTime)

    return (
        // z-40 keeps it below dialogs, sheets and menus (z-50).
        <div
            ref={reportHeight}
            data-hide-immersive
            data-resume-prompt
            className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.75rem)] z-40 flex justify-center px-4"
        >
            <div className="pointer-events-auto flex w-full max-w-[440px] items-center gap-2 rounded-2xl border border-border bg-card py-2.5 pl-3.5 pr-2 shadow-lg animate-in fade-in slide-in-from-bottom-2">
                <button
                    type="button"
                    onClick={() => router.push("/plan?resume=1")}
                    aria-label={`Resume journey to ${activeJourney.endLabel}, arrives ${arrives}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950" aria-hidden>
                        <Navigation className="h-3.5 w-3.5 fill-current" />
                    </span>
                    <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold leading-tight text-foreground">
                            Journey to {activeJourney.endLabel}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-green-600 dark:bg-green-400" aria-hidden />
                            <span className="truncate">Arrives {arrives} · Tap to resume</span>
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={dismiss}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    )
}

/**
 * Publishes an element's height (plus the gap under it) as a CSS variable on
 * <html> while it's mounted, so overlays pinned to the bottom of a full-bleed
 * map can sit above it (the iOS app insets each tab for its resume card).
 */
function useReportedHeight(variable: string) {
    const observer = useRef<ResizeObserver | null>(null)
    return useCallback((el: HTMLElement | null) => {
        observer.current?.disconnect()
        observer.current = null
        const root = document.documentElement
        if (!el) {
            root.style.removeProperty(variable)
            return
        }
        const card = el.firstElementChild as HTMLElement | null
        if (!card) return
        observer.current = new ResizeObserver(() => {
            root.style.setProperty(variable, `${card.offsetHeight + 12}px`)
        })
        observer.current.observe(card)
    }, [variable])
}
