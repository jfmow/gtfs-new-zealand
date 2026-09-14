"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, BellRing, Bus, PartyPopper, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JourneyAlert, JourneyAlertVariant } from "./use-journey-alerts"

interface JourneyAlertOverlayProps {
    alerts: JourneyAlert[]
    onDismiss: (id: string) => void
    onDismissAll: () => void
}

// Matches the slide-out/zoom-out duration below - the card stays mounted this
// long after it leaves `alerts` so the exit animation can actually play,
// instead of the card just vanishing the instant its timer/dismiss fires.
const EXIT_MS = 180

const VARIANT: Record<JourneyAlertVariant, {
    Icon: typeof Bus
    /** Quiet, informational - neutral card, colour only in the icon chip and timer. */
    urgent: false
    iconWrap: string
    bar: string
} | {
    Icon: typeof Bus
    /** Needs action within roughly a walking pace - the whole card carries the colour, not just the icon, so it reads at a glance without having to focus on it. */
    urgent: true
    iconWrap: string
    bar: string
    card: string
}> = {
    info: {
        Icon: Bus,
        urgent: false,
        iconWrap: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
        bar: "bg-blue-500",
    },
    success: {
        Icon: PartyPopper,
        urgent: false,
        iconWrap: "bg-green-500/15 text-green-600 dark:text-green-400",
        bar: "bg-green-500",
    },
    action: {
        Icon: BellRing,
        urgent: true,
        iconWrap: "bg-amber-500 text-white",
        bar: "bg-amber-600",
        card: "border-amber-500/50 bg-amber-50 dark:bg-amber-950/40",
    },
    error: {
        Icon: AlertTriangle,
        urgent: true,
        iconWrap: "bg-destructive text-destructive-foreground",
        bar: "bg-destructive",
        card: "border-destructive/50 bg-destructive/5",
    },
}

/**
 * Centered, dedicated alert cards for live journey tracking - deliberately more
 * prominent than the app's top toasts. Renders over a slight screen dim (tap it
 * to dismiss all); each card also auto-dismisses when its timer bar runs out and
 * carries its own close button. Portalled to <body> so the drawer / dialog
 * stacking context can't trap it.
 *
 * Every dismissal path (timeout, the card's own X, tapping the dim, Escape, or
 * the hook clearing everything because tracking stopped) goes through the same
 * exit animation - a card here is never state-diffed straight out of the DOM.
 */
export function JourneyAlertOverlay({ alerts, onDismiss, onDismissAll }: JourneyAlertOverlayProps) {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    // What's actually rendered: lags behind `alerts` by EXIT_MS for any card
    // that just left the array, so it can animate out instead of popping off
    // instantly. Diffing (and its setTimeout side effect) happens directly in
    // the effect body against `renderedRef`, not inside the setRendered
    // updater - an updater can run more than once for the same update (e.g.
    // React StrictMode's double-invoke), which would double-schedule timers.
    const [rendered, setRendered] = useState<JourneyAlert[]>([])
    const renderedRef = useRef<JourneyAlert[]>([])
    const leavingRef = useRef<Set<string>>(new Set())
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    useEffect(() => {
        const incomingIds = new Set(alerts.map((a) => a.id))
        const next = [...renderedRef.current]
        for (const a of alerts) {
            if (!next.some((r) => r.id === a.id)) next.push(a)
        }
        for (const r of next) {
            if (!incomingIds.has(r.id) && !leavingRef.current.has(r.id)) {
                leavingRef.current.add(r.id)
                const t = setTimeout(() => {
                    leavingRef.current.delete(r.id)
                    timersRef.current.delete(r.id)
                    renderedRef.current = renderedRef.current.filter((x) => x.id !== r.id)
                    setRendered(renderedRef.current)
                }, EXIT_MS)
                timersRef.current.set(r.id, t)
            }
        }
        renderedRef.current = next
        setRendered(next)
    }, [alerts])

    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(clearTimeout)
            timers.clear()
        }
    }, [])

    useEffect(() => {
        if (rendered.length === 0) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onDismissAll()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [rendered.length, onDismissAll])

    if (!mounted || rendered.length === 0) return null

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-in fade-in duration-200"
                onClick={onDismissAll}
                aria-hidden="true"
            />
            <div
                className="relative flex w-full max-w-sm flex-col gap-3"
                role="alert"
                aria-live="assertive"
            >
                {rendered.map((alert) => {
                    const v = VARIANT[alert.variant]
                    const Icon = v.Icon
                    const isLeaving = leavingRef.current.has(alert.id)
                    return (
                        <div
                            key={alert.id}
                            className={cn(
                                "relative overflow-hidden rounded-2xl border p-4 pb-5 pr-10 shadow-xl duration-200",
                                v.urgent ? v.card : "bg-background",
                                isLeaving
                                    ? "animate-out fade-out zoom-out-95 slide-out-to-bottom-2 fill-mode-forwards"
                                    : "animate-in fade-in zoom-in-95 slide-in-from-bottom-2",
                            )}
                        >
                            <div className="flex gap-3">
                                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", v.iconWrap)}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <p className="font-semibold leading-tight">{alert.title}</p>
                                    {alert.body && (
                                        <p className={cn("mt-1 text-sm", v.urgent ? "text-foreground/70" : "text-muted-foreground")}>{alert.body}</p>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onDismiss(alert.id)}
                                aria-label="Dismiss"
                                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                            <div className="absolute inset-x-0 bottom-0 h-1 bg-muted">
                                <div
                                    className={cn("h-full w-full origin-left", v.bar)}
                                    style={isLeaving ? undefined : { animation: `journey-alert-bar ${alert.duration}ms linear forwards` }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>,
        document.body,
    )
}
