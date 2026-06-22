import { useEffect, useState } from "react"
import SearchForStop from "@/components/stops/search"
import { BellDot, Clock, AlertTriangle, AlertCircle, Wrench, Users, CalendarDays, CloudRain, Hammer, Construction, ShieldAlert, HeartPulse, ChevronDown, ChevronUp } from "lucide-react"
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

interface AlertResponse {
    alerts: AlertByRouteId;
    routes_to_display: string[]
}

type AlertByRouteId = Record<string, AlertType[]>;

export default function Alerts() {
    const [alerts, setAlerts] = useState<AlertByRouteId>({})
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s", "r"] } })
    const [loading, setLoading] = useState(false)
    const [routes, setRoutes] = useState<string[]>([])

    useEffect(() => {
        if (selected_stop.found) {
            setLoading(true)
            ApiFetch<AlertResponse>(`realtime/alerts/${fullyEncodeURIComponent(selected_stop.value)}`).then(async (res) => {
                if (res.ok) {
                    setAlerts(res.data.alerts)
                    setRoutes(res.data.routes_to_display)
                    console.log(res.data)
                } else {
                    setAlerts({})
                    setRoutes([])
                }
                setLoading(false)
            })
        }
    }, [selected_stop])

    return (
        <>
            <Header title="Travel Alerts" />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4 pt-0">
                    <div className="flex items-center gap-2 mb-4">
                        <StopNotifications stopName={selected_stop.value} routes={routes}>
                            <Button variant={"secondary"}>
                                <BellDot />
                                <span className="hidden sm:block">Notifications</span>
                            </Button>
                        </StopNotifications>
                        <SearchForStop />
                    </div>
                    {loading ? (
                        <LoadingSpinner description="Loading alerts..." />
                    ) : (
                        <div className="">
                            {selected_stop.found ? (
                                <GroupedAlertsByRoute alerts={alerts} />
                            ) : (
                                <div className="col-span-full">
                                    <div className="text-center py-8">
                                        <p className="text-muted-foreground">Search for a stop to view alerts.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

function GroupedAlertsByRoute({ alerts }: { alerts: AlertByRouteId }) {
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
                <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
                    {routes.map((route) => (
                        <TabsTrigger
                            key={route}
                            value={route}
                            className="flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground"
                        >
                            {route}
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



function AlertCard({ alert, reducedContent }: { alert: AlertType, reducedContent?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const canExpand = alert.description.length > 140

    const getAlertStatus = (alert: AlertType) => {
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

    const formatDuration = (start: number, end: number) => {
        const s = new Date(start * 1000)
        const e = new Date(end * 1000)
        const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
        const sameDay = s.toDateString() === e.toDateString()
        if (sameDay) {
            return `${s.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} · ${s.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })} – ${e.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}`
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

export interface AlertType {
    start_date: number
    end_date: number
    cause: "UNKNOWN_CAUSE" | "OTHER_CAUSE" | "TECHNICAL_PROBLEM" | "STRIKE" | "DEMONSTRATION" | "ACCIDENT" | "HOLIDAY" | "WEATHER" | "MAINTENANCE" | "CONSTRUCTION" | "POLICE_ACTIVITY" | "MEDICAL_EMERGENCY"
    effect: string
    title: string
    description: string
}

const causeSeverityMap: Record<
    AlertType["cause"],
    {
        variant: "destructive" | "default" | "secondary"
        label: string
        icon: React.ElementType
    }
> = {
    UNKNOWN_CAUSE: { variant: "secondary", label: "Unknown cause", icon: AlertCircle },
    OTHER_CAUSE: { variant: "secondary", label: "Other", icon: AlertCircle },
    TECHNICAL_PROBLEM: { variant: "default", label: "Technical issue", icon: Wrench },
    STRIKE: { variant: "destructive", label: "Strike", icon: Users },
    DEMONSTRATION: { variant: "destructive", label: "Demonstration", icon: Users },
    ACCIDENT: { variant: "destructive", label: "Accident", icon: AlertTriangle },
    HOLIDAY: { variant: "secondary", label: "Holiday schedule", icon: CalendarDays },
    WEATHER: { variant: "default", label: "Weather", icon: CloudRain },
    MAINTENANCE: { variant: "secondary", label: "Maintenance", icon: Hammer },
    CONSTRUCTION: { variant: "default", label: "Construction", icon: Construction },
    POLICE_ACTIVITY: { variant: "destructive", label: "Police activity", icon: ShieldAlert },
    MEDICAL_EMERGENCY: { variant: "destructive", label: "Medical emergency", icon: HeartPulse },
}

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