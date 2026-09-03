"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, BellRing, Bus, PartyPopper, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JourneyAlert, JourneyAlertVariant } from "./use-journey-alerts"

interface JourneyAlertOverlayProps {
    alerts: JourneyAlert[]
    onDismiss: (id: string) => void
    onDismissAll: () => void
}

const VARIANT: Record<JourneyAlertVariant, {
    Icon: typeof Bus
    iconWrap: string
    bar: string
}> = {
    info: {
        Icon: Bus,
        iconWrap: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
        bar: "bg-blue-500",
    },
    action: {
        Icon: BellRing,
        iconWrap: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        bar: "bg-amber-500",
    },
    success: {
        Icon: PartyPopper,
        iconWrap: "bg-green-500/15 text-green-600 dark:text-green-400",
        bar: "bg-green-500",
    },
    error: {
        Icon: AlertTriangle,
        iconWrap: "bg-destructive/15 text-destructive",
        bar: "bg-destructive",
    },
}

/**
 * Centered, dedicated alert cards for live journey tracking - deliberately more
 * prominent than the app's top toasts. Renders over a slight screen dim (tap it
 * to dismiss all); each card also auto-dismisses when its timer bar runs out and
 * carries its own close button. Portalled to <body> so the drawer / dialog
 * stacking context can't trap it.
 */
export function JourneyAlertOverlay({ alerts, onDismiss, onDismissAll }: JourneyAlertOverlayProps) {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    useEffect(() => {
        if (alerts.length === 0) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onDismissAll()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [alerts.length, onDismissAll])

    if (!mounted || alerts.length === 0) return null

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
                onClick={onDismissAll}
                aria-hidden="true"
            />
            <div
                className="relative flex w-full max-w-sm flex-col gap-3"
                role="alert"
                aria-live="assertive"
            >
                {alerts.map((alert) => {
                    const v = VARIANT[alert.variant]
                    const Icon = v.Icon
                    return (
                        <div
                            key={alert.id}
                            className="relative overflow-hidden rounded-2xl border bg-background p-4 pb-5 pr-10 shadow-xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200"
                        >
                            <div className="flex gap-3">
                                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", v.iconWrap)}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <p className="font-semibold leading-tight">{alert.title}</p>
                                    {alert.body && (
                                        <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>
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
                                    style={{ animation: `journey-alert-bar ${alert.duration}ms linear forwards` }}
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
