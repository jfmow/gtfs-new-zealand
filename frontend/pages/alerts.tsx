import { useEffect, useState } from "react"
import SearchForStop from "@/components/stops/search"
import { BellDot, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Loader2, LocateFixed, MessageCircleWarning, Star, X } from "lucide-react"
import { useFavorites } from "@/components/stops/favourites"
import type { Stop } from "@/components/map/stops-map"
import { getUserLocation } from "@/lib/userLocation"
import { useUrlOverlay } from "@/lib/url-overlay"
import { cn } from "@/lib/utils"
import { causeSeverityMap, type AlertResponseData } from "@/lib/alert-causes"
import LoadingSpinner from "@/components/loading-spinner"
import { Button } from "@/components/ui/button"
import StopNotifications from "@/components/notifications"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"
import { Header } from "@/components/nav"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { inRegion, regionDayAsLocal } from "@/lib/region-time"

interface AlertResponse {
    alerts: AlertByRouteId;
    routes_to_display: string[]
}

export type AlertByRouteId = Record<string, AlertType[]>;

/** A stop's alerts grouped by route, and the routes its alert subscription can pick from. */
export function useStopAlerts(stopName: string, enabled = true) {
    const [alerts, setAlerts] = useState<AlertByRouteId>({})
    const [routes, setRoutes] = useState<string[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!enabled || stopName === "") return
        let cancelled = false
        setLoading(true)
        ApiFetch<AlertResponse>(`realtime/alerts/${fullyEncodeURIComponent(stopName)}`).then((res) => {
            if (cancelled) return
            setAlerts(res.ok ? res.data.alerts : {})
            setRoutes(res.ok ? res.data.routes_to_display : [])
            setLoading(false)
        })
        return () => { cancelled = true }
    }, [stopName, enabled])

    return { alerts, routes, loading }
}

/**
 * The Alerts tab - the iOS Alerts tab: before a search, your saved stops and
 * the nearest few, each with a one-line summary of its alerts; a chosen stop
 * shows its alerts, with "Get alerts" and a way back. Two columns on wide
 * screens (stops left, alerts right).
 */
export default function Alerts() {
    const stop = useUrlOverlay("s")
    const legacy = useQueryParams({ r: { type: "string", default: "", keys: ["r"] } }).r
    const selected = stop.value || (legacy.found ? legacy.value : "")
    const isWide = useMediaQuery("(min-width: 1024px)")

    const overview = (
        <div className="space-y-4">
            <SearchForStop />
            <AlertsOverview selected={selected} onSelect={stop.open} />
        </div>
    )

    const detail = selected ? (
        <SelectedStopAlerts key={selected} stopName={selected} onClear={stop.close} />
    ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
            <MessageCircleWarning className="h-6 w-6" />
            <p className="font-medium text-foreground">Travel alerts</p>
            Pick one of your stops, or search for any stop.
        </div>
    )

    return (
        <>
            <Header title="Travel Alerts" />
            {isWide ? (
                <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[400px_1fr] gap-8 px-4 pb-8">
                    {overview}
                    <div className="min-w-0">{detail}</div>
                </div>
            ) : (
                <div className="mx-auto w-full max-w-2xl px-4 pb-8">
                    {selected ? detail : overview}
                </div>
            )}
        </>
    )
}

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(false)
    useEffect(() => {
        const mql = window.matchMedia(query)
        const update = () => setMatches(mql.matches)
        update()
        mql.addEventListener("change", update)
        return () => mql.removeEventListener("change", update)
    }, [query])
    return matches
}

/** The stop's name, "Get alerts" and clear, then its alerts by route. */
function SelectedStopAlerts({ stopName, onClear }: { stopName: string; onClear: () => void }) {
    const { alerts, routes, loading } = useStopAlerts(stopName)
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <h1 className="min-w-0 flex-1 text-xl font-semibold leading-tight">{stopName}</h1>
                <StopNotifications stopName={stopName} routes={routes}>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <BellDot className="h-3.5 w-3.5" /> Get alerts
                    </Button>
                </StopNotifications>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Clear stop" onClick={onClear}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
            {loading ? <LoadingSpinner description="Loading alerts..." height="200px" /> : <GroupedAlertsByRoute alerts={alerts} />}
        </div>
    )
}

/** Saved stops, then the nearest few (when location is already allowed - no prompt here). */
function AlertsOverview({ selected, onSelect }: { selected: string; onSelect: (stop: string) => void }) {
    const favourites = useFavorites()
    const [nearby, setNearby] = useState<Stop[]>([])

    useEffect(() => {
        let cancelled = false
        navigator.permissions?.query({ name: "geolocation" }).then((perm) => {
            if (perm.state !== "granted") return
            getUserLocation().then(([lat, lon]) =>
                ApiFetch<Stop[]>(`stops/closest-stop?lat=${lat}&lon=${lon}`).then((res) => {
                    if (!cancelled && res.ok) setNearby(res.data)
                })
            ).catch(() => { })
        }, () => { })
        return () => { cancelled = true }
    }, [])

    const entries: { query: string; title: string; saved: boolean }[] = []
    const seen = new Set<string>()
    for (const f of favourites) {
        if (seen.has(f.stop)) continue
        seen.add(f.stop)
        entries.push({ query: f.stop, title: f.displayName, saved: true })
    }
    const names = new Set(entries.map((e) => e.title))
    let nearbyCount = 0
    for (const stop of nearby) {
        const query = `${stop.stop_name} ${stop.stop_code}`
        if (nearbyCount === 3 || names.has(stop.stop_name) || seen.has(query)) continue
        names.add(stop.stop_name)
        seen.add(query)
        entries.push({ query, title: stop.stop_name, saved: false })
        nearbyCount++
    }

    if (entries.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">Search for a stop to view alerts. Saved and nearby stops show up here.</p>
    }
    return (
        <section className="space-y-2.5" aria-labelledby="alerts-your-stops">
            <h2 id="alerts-your-stops" className="font-display text-xs uppercase tracking-wide text-muted-foreground">Your stops</h2>
            {entries.map((entry) => (
                <StopAlertsSummaryRow key={entry.query} {...entry} selected={entry.query === selected} onSelect={() => onSelect(entry.query)} />
            ))}
        </section>
    )
}

/** "2 active, 1 upcoming" with the affected routes. */
function StopAlertsSummaryRow({ query, title, saved, selected, onSelect }: { query: string; title: string; saved: boolean; selected: boolean; onSelect: () => void }) {
    const { alerts, routes, loading } = useStopAlerts(query)
    const [loadedOnce, setLoadedOnce] = useState(false)
    useEffect(() => { if (!loading) setLoadedOnce(true) }, [loading])

    let active = 0
    let upcoming = 0
    const affected: string[] = []
    for (const route of routes) {
        const kinds = (alerts[route] ?? []).map((a) => getAlertStatus(a).status)
        active += kinds.filter((k) => k === "active").length
        upcoming += kinds.filter((k) => k === "soon").length
        if (kinds.some((k) => k !== "inactive")) affected.push(shortRouteName(route))
    }
    const counts = [active && `${active} active`, upcoming && `${upcoming} upcoming`].filter(Boolean).join(", ")

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected || undefined}
            className={cn(
                "flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-accent/40",
                selected ? "border-primary ring-1 ring-primary" : "border-border",
            )}
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground" aria-hidden>
                {saved ? <Star className="h-3.5 w-3.5 fill-current" /> : <LocateFixed className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block text-sm font-medium">{title}</span>
                {!loadedOnce || loading ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking alerts</span>
                ) : !counts ? (
                    <span className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> No current alerts</span>
                ) : (
                    <>
                        <span className={cn("block text-xs font-medium", active ? "text-destructive" : "text-amber-600 dark:text-amber-400")}>{counts}</span>
                        <span className="flex flex-wrap gap-1">
                            {affected.slice(0, 8).map((r) => (
                                <span key={r} className="rounded bg-foreground/85 px-1.5 py-0.5 text-[11px] font-bold leading-4 text-background">{r}</span>
                            ))}
                        </span>
                    </>
                )}
            </span>
            <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        </button>
    )
}

export function GroupedAlertsByRoute({ alerts }: { alerts: AlertByRouteId }) {
    const routes = Object.keys(alerts)
    const [openRoute, setOpenRoute] = useState<string>(routes[0] ?? "")

    if (routes.length === 0) {
        return (
            <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No travel alerts found for this stop.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <Tabs value={openRoute} onValueChange={setOpenRoute}>
                <TabsList className="flex flex-wrap justify-start h-auto gap-1 bg-transparent p-0 mb-4">
                    {routes.map((route) => (
                        <TabsTrigger
                            key={route}
                            value={route}
                            className="flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground"
                        >
                            {shortRouteName(route)}
                            <span className="text-[10px] opacity-70">{alerts[route].length}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                {routes.map((route) => (
                    <TabsContent key={route} value={route}>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {alerts[route].map((alert, i) => (
                                <AlertCard key={i} alert={alert} />
                            ))}
                        </div>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}



/** Active now, starting soon (within a week), or not relevant - the iOS `AlertStatusCalculator`. */
export function getAlertStatus(alert: AlertType): { status: "active" | "soon" | "inactive"; label: string } {
    const now = Date.now() / 1000
    const endDate = alert.end_date && alert.end_date > 0 ? alert.end_date : now + 86400
    if (alert.start_date <= now && endDate >= now) return { status: "active", label: "Active" }
    if (alert.start_date > now) {
        const daysUntil = Math.round((alert.start_date - now) / 86400)
        if (daysUntil === 0) return { status: "soon", label: "Today" }
        if (daysUntil === 1) return { status: "soon", label: "Tomorrow" }
        if (daysUntil <= 7) return { status: "soon", label: `In ${daysUntil}d` }
        return { status: "inactive", label: "Upcoming" }
    }
    return { status: "inactive", label: "Ended" }
}

/** Route ids carry a feed version suffix ("INN-202") that means nothing to a rider. */
export function shortRouteName(routeId: string) {
    const m = routeId.match(/^(.+)-\d+$/)
    return m ? m[1] : routeId
}

function AlertCard({ alert, reducedContent }: { alert: AlertType, reducedContent?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const canExpand = alert.description.length > 140


    const formatDuration = (start: number, end: number) => {
        const s = new Date(start * 1000)
        const e = new Date(end * 1000)
        const opts = inRegion({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
        const sameDay = regionDayAsLocal(s).getTime() === regionDayAsLocal(e).getTime()
        if (sameDay) {
            return `${s.toLocaleDateString("en-NZ", inRegion({ day: "numeric", month: "short" }))} · ${s.toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))} – ${e.toLocaleTimeString("en-NZ", inRegion({ hour: "numeric", minute: "2-digit" }))}`
        }
        return `${s.toLocaleDateString("en-NZ", opts)} – ${e.toLocaleDateString("en-NZ", opts)}`
    }

    const cleanDescription = (text: string) => text.split("\n").filter(l => l.trim()).join(" ").trim()

    const alertStatus = getAlertStatus(alert)
    const causeInfo = causeSeverityMap[alert.cause] || causeSeverityMap.UNKNOWN_CAUSE
    const CauseIcon = causeInfo.icon

    const statusBadgeClass = alertStatus.status === "active"
        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
        : alertStatus.status === "soon"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-muted text-muted-foreground"

    return (
        <Card className="flex flex-col">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                        <CauseIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusBadgeClass}`}>
                            {alertStatus.label}
                        </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                        {formatTextToNiceLookingWords(alert.effect.replace(/_/g, " ").toLowerCase(), true)}
                    </span>
                </div>
                <CardTitle className="text-sm font-semibold leading-snug mt-2">{alert.title}</CardTitle>
            </CardHeader>

            <CardContent className="px-4 pb-4 pt-0 flex-grow flex flex-col gap-2">
                {!reducedContent && alert.start_date > 0 && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3 h-3 shrink-0" />
                        {formatDuration(alert.start_date, alert.end_date)}
                    </p>
                )}

                <div className="text-xs text-muted-foreground leading-relaxed">
                    {expanded || !canExpand
                        ? cleanDescription(alert.description)
                        : cleanDescription(alert.description).slice(0, 140) + "…"}
                </div>

                {canExpand && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline self-start mt-auto pt-1"
                    >
                        {expanded
                            ? <><ChevronUp className="w-3 h-3" /> Show less</>
                            : <><ChevronDown className="w-3 h-3" /> Read more</>
                        }
                    </button>
                )}
            </CardContent>
        </Card>
    )
}

export type AlertType = AlertResponseData

export function DisplayTodaysAlerts({ stopName, forceDisplay }: { stopName: string, forceDisplay?: boolean }) {
    const [alerts, setAlerts] = useState<AlertType[]>([])
    const [dialogOpen, setDialogOpen] = useState(false)

    interface StoredAlert {
        date_stored: number
        alert_hash: string
    }

    useEffect(() => {
        function getSeenAlerts() {
            try {
                const item = window.localStorage.getItem("seen_alerts")
                if (!item) return []
                let alerts = JSON.parse(item)
                if (Array.isArray(alerts)) {
                    const now = Date.now()
                    // Keep only alerts stored within the last 48 hours (2 days)
                    alerts = alerts.filter((a: StoredAlert) => now - a.date_stored < 48 * 60 * 60 * 1000)
                    // Re-store the filtered alerts
                    window.localStorage.setItem("seen_alerts", JSON.stringify(alerts))
                    return alerts as StoredAlert[]
                }
                return []
            } catch {
                return []
            }
        }
        function markAlertSeen(alert: StoredAlert) {
            const storedAlerts = getSeenAlerts()
            const updatedAlerts = storedAlerts.filter((t) => t.alert_hash !== alert.alert_hash)
            updatedAlerts.push(alert)

            window.localStorage.setItem("seen_alerts", JSON.stringify(updatedAlerts))
            return updatedAlerts
        }

        if (stopName !== "") {
            ApiFetch<AlertType[]>(`realtime/alerts/${fullyEncodeURIComponent(stopName)}?today=true`).then(async (res) => {
                if (res.ok) {
                    const alerts = res.data
                    const seenAlerts = getSeenAlerts()
                    // Use Promise.all to await all hashes
                    const filteredAlerts: AlertType[] = []
                    await Promise.all(
                        alerts.map(async (alert) => {
                            const hash = await hashJsonObject(alert)
                            if (!seenAlerts.find((a) => a.alert_hash === hash) || forceDisplay) {
                                filteredAlerts.push(alert)
                                markAlertSeen({ date_stored: Date.now(), alert_hash: hash })
                            }
                        })
                    )
                    if (filteredAlerts.length >= 1) {
                        setAlerts(filteredAlerts)
                        setDialogOpen(true)
                    }
                } else {
                    setAlerts([])
                }
            })
        }
    }, [forceDisplay, stopName])


    return (
        <>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-h-[90svh] flex flex-col">
                    <DialogHeader className="bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/30 dark:to-orange-950/30 -mx-6 -mt-6 px-6 pt-6 pb-4 rounded-t-lg border-b border-red-100 dark:border-red-900/50">
                        <DialogTitle>
                            Travel Alert(s) for {stopName}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="overflow-y-auto">
                        <div className="space-y-2">
                            {alerts.map((alert, index) => (
                                <AlertCard reducedContent alert={alert} key={index} />
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hashJsonObject(obj: any) {
    // Step 1: Stable stringify (important for consistent hashes)
    const jsonString = JSON.stringify(obj, Object.keys(obj).sort());

    // Step 2: Encode as UTF-8
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonString);

    // Step 3: Hash with SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Step 4: Convert to base64 (shorter string)
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const base64 = btoa(String.fromCharCode(...hashArray));

    // Optional: Remove non-url-safe characters and shorten
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 12); // 12 chars
}