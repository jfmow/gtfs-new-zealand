"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IOS_APP_STORE_URL, isIOS } from "@/lib/ios-app"

const DISMISSED_KEY = "iosAppBannerDismissed"

/**
 * "Get the iPhone app" strip above the nav, in the style of Safari's Smart App
 * Banner. iOS only, and hidden once dismissed (remembered per browser) or when
 * there's no App Store listing configured. Rendered once from _app.tsx.
 */
export function IosAppBanner() {
    const [show, setShow] = useState(false)

    useEffect(() => {
        if (!IOS_APP_STORE_URL || !isIOS()) return
        try {
            setShow(localStorage.getItem(DISMISSED_KEY) !== "1")
        } catch {
            setShow(true)
        }
    }, [])

    if (!show) return null

    const dismiss = () => {
        try { localStorage.setItem(DISMISSED_KEY, "1") } catch { /* ignore */ }
        setShow(false)
    }

    return (
        <div className="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
            <button
                type="button"
                aria-label="Dismiss"
                onClick={dismiss}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
            >
                <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/rounded-icon.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-semibold">Transit for iPhone</span>
                <span className="truncate text-xs text-muted-foreground">Live Activities, widgets and offline journeys</span>
            </div>
            <Button asChild size="sm" className="shrink-0 rounded-full px-4">
                <a href={IOS_APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get</a>
            </Button>
        </div>
    )
}
