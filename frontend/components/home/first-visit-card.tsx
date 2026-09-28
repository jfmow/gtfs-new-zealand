import { useEffect, useState } from "react"
import { Bell, Check, LocateFixed, MapPinned, Route as RouteIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrl } from "@/lib/url-context"
import { getUserLocation } from "@/lib/userLocation"
import { ensureSubscription } from "@/lib/notifications"
import { usePlannerStyle, type PlannerStyle } from "@/lib/planner-style"
import { cn } from "@/lib/utils"

const KEY = "hasOnboarded"
/** Anything saved means they've used the app before - no need to walk them through it. */
const USED_BEFORE_KEYS = ["favorites", "savedPlaces", "savedJourneyTrips"]

function hasUsedBefore() {
    return USED_BEFORE_KEYS.some((k) => {
        try {
            const v = localStorage.getItem(k)
            return !!v && v !== "[]"
        } catch {
            return false
        }
    })
}

/**
 * First visit - the iOS first-launch setup (region, location, notifications,
 * planner style), as a card on Schedule rather than a screen in the way.
 * Each ask says why, instead of a cold browser prompt. Shown once.
 */
export function FirstVisitCard() {
    const { currentUrl, urlOptions, setCurrentUrl } = useUrl()
    const [plannerStyle, setPlannerStyle] = usePlannerStyle()
    const [show, setShow] = useState(false)
    const [location, setLocation] = useState<"ask" | "done" | "denied">("ask")
    const [push, setPush] = useState<"ask" | "done" | "denied" | "unsupported">("ask")

    useEffect(() => {
        try {
            if (localStorage.getItem(KEY) === "true") return
            if (hasUsedBefore()) {
                localStorage.setItem(KEY, "true")
                return
            }
        } catch {
            return
        }
        setShow(true)
        navigator.permissions?.query({ name: "geolocation" }).then((r) => {
            if (r.state === "granted") setLocation("done")
            else if (r.state === "denied") setLocation("denied")
        }, () => { })
        if (typeof Notification === "undefined" || !("PushManager" in window)) setPush("unsupported")
        else if (Notification.permission === "granted") setPush("done")
        else if (Notification.permission === "denied") setPush("denied")
    }, [])

    if (!show) return null

    const finish = () => {
        try { localStorage.setItem(KEY, "true") } catch { /* private mode */ }
        setShow(false)
    }

    return (
        <section aria-labelledby="first-visit-title" className="relative space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <button type="button" onClick={finish} aria-label="Dismiss" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
            </button>
            <div className="pr-8">
                <h2 id="first-visit-title" className="text-base font-semibold">Welcome</h2>
                <p className="text-sm text-muted-foreground">A few things to get the most out of it - change any of them later in Settings.</p>
            </div>

            <div className="divide-y divide-border rounded-xl border border-border">
                <Row icon={<MapPinned className="h-4 w-4" />} title="Your region" detail="Which transport network to show">
                    <Select
                        value={currentUrl.url}
                        onValueChange={(val) => {
                            const option = urlOptions.find((o) => o.url === val)
                            if (option) {
                                setCurrentUrl(option)
                                window.location.reload()
                            }
                        }}
                    >
                        <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {urlOptions.map((o) => <SelectItem key={o.url} value={o.url}>{o.displayName}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Row>

                <Row icon={<LocateFixed className="h-4 w-4" />} title="Stops near you" detail={location === "denied" ? "Location is blocked for this site" : "Uses your location to show nearby departures"}>
                    {location === "done" ? <Done /> : location === "ask" && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => getUserLocation().then(() => setLocation("done"), (e: GeolocationPositionError) => setLocation(e?.code === 1 ? "denied" : "ask"))}>
                            Allow
                        </Button>
                    )}
                </Row>

                <Row
                    icon={<Bell className="h-4 w-4" />}
                    title="Reminders and alerts"
                    detail={push === "unsupported" ? "Not available in this browser" : push === "denied" ? "Notifications are blocked for this site" : "Tells you when to leave and when your stop is next"}
                >
                    {push === "done" ? <Done /> : push === "ask" && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={async () => {
                                const permission = await Notification.requestPermission()
                                if (permission === "granted") {
                                    await ensureSubscription()
                                    setPush("done")
                                } else if (permission === "denied") setPush("denied")
                            }}
                        >
                            Turn on
                        </Button>
                    )}
                </Row>

                <Row icon={<RouteIcon className="h-4 w-4" />} title="Planner" detail="Step by step asks 4 simple questions">
                    <div className="flex rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Planner">
                        {([["standard", "Standard"], ["stepByStep", "Step by step"]] as [PlannerStyle, string][]).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={(plannerStyle ?? "standard") === value}
                                onClick={() => setPlannerStyle(value)}
                                className={cn(
                                    "rounded px-2 py-1 text-xs font-medium",
                                    (plannerStyle ?? "standard") === value ? "bg-card shadow-sm" : "text-muted-foreground",
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </Row>
            </div>

            <Button className="w-full" onClick={finish}>Done</Button>
        </section>
    )
}

function Row({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children?: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <span className="text-muted-foreground" aria-hidden>{icon}</span>
            <div className="min-w-[11rem] flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
            {children && <div className="ml-auto">{children}</div>}
        </div>
    )
}

function Done() {
    return <span className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" /> On</span>
}
