import { useEffect, useState } from "react"
import SearchForStop from "@/components/stops/search"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { BellDot, MegaphoneOff, Clock, MapPin, AlertTriangle } from "lucide-react"
import LoadingSpinner from "@/components/loading-spinner"
import { Button } from "@/components/ui/button"
import StopNotifications from "@/components/services/notifications"
import { ApiFetch } from "@/lib/url-context"
import { useQueryParams } from "@/lib/url-params"
import { Header } from "@/components/nav"
import { fullyEncodeURIComponent } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"


export default function Alerts() {
    const [alerts, setAlerts] = useState<AlertType[]>([])
    const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s", "r"] } })
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (selected_stop.found) {
            setLoading(true)
            ApiFetch<AlertType[]>(`realtime/alerts/${fullyEncodeURIComponent(selected_stop.value)}`).then(async (res) => {
                if (res.ok) {
                    setAlerts(res.data)
                } else {
                    setAlerts([])
                }
                setLoading(false)
            })
        }
    }, [selected_stop])

    return (
        <>
            <Header title="Travel Alerts" />
            <div className="w-full">
                <div className="mx-auto max-w-[1400px] flex flex-col p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <StopNotifications stopName={selected_stop.value}>
                            <Button>
                                <BellDot />
                                <span className="hidden sm:block">Notifications</span>
                            </Button>
                        </StopNotifications>
                        <SearchForStop />
                    </div>
                    {loading ? (
                        <LoadingSpinner description="Loading alerts..." />
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {alerts.length > 0 ? (
                                alerts.map((alert, index) => (
                                    <AlertCard alert={alert} key={index} />
                                ))
                            ) : selected_stop.found ? (
                                <div className="col-span-full">
                                    <Alert>
                                        <MegaphoneOff className="h-4 w-4" />
                                        <AlertTitle>No alerts found</AlertTitle>
                                        <AlertDescription>This stop has no active alerts at the moment.</AlertDescription>
                                    </Alert>
                                </div>
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

function AlertCard({ alert, reducedContent }: { alert: AlertType, reducedContent?: boolean }) {
    const [descriptionExpanded, setDescriptionExpanded] = useState(false)

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleDateString("en-NZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    const getAlertStatus = (alert: AlertType) => {
        const now = Date.now() / 1000
        const oneDayInSeconds = 24 * 60 * 60
        const oneWeekInSeconds = 7 * oneDayInSeconds

        // Currently active
        if (alert.start_date <= now && alert.end_date >= now) {
            return { status: "active", label: "Active" }
        }

        // Starting soon
        if (alert.start_date > now) {
            const timeUntilStart = alert.start_date - now

            if (timeUntilStart <= oneDayInSeconds) {
                const hoursUntil = Math.ceil(timeUntilStart / 3600)
                return {
                    status: "soon",
                    label: hoursUntil <= 1 ? "Starting soon" : `In ${hoursUntil}h`,
                }
            } else if (timeUntilStart <= 2 * oneDayInSeconds) {
                return { status: "soon", label: "Tomorrow" }
            } else if (timeUntilStart <= 7 * oneDayInSeconds) {
                const daysUntil = Math.ceil(timeUntilStart / oneDayInSeconds)
                return { status: "soon", label: `In ${daysUntil} days` }
            } else if (timeUntilStart <= oneWeekInSeconds) {
                return { status: "soon", label: "Next week" }
            }
        }

        // Inactive (past or far future)
        return { status: "inactive", label: "Inactive" }
    }

    const getBadgeVariant = (status: string) => {
        switch (status) {
            case "active":
                return "destructive"
            case "soon":
                return "default"
            case "inactive":
            default:
                return "secondary"
        }
    }

    const truncateText = (text: string, maxLength = 150) => {
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + "..."
    }

    const getDescriptionPreview = (description: string) => {
        const lines = description.split("\n").filter((line) => line.trim() !== "")
        const fullText = lines.join(" ").trim()
        return truncateText(fullText)
    }

    const formatDescription = (description: string) => {
        const lines = description.split("\n").filter((line) => line.trim() !== "")

        return lines.map((line, index) => {
            const bulletMatch = line.match(/^\s*(•|-)\s?(.*)/)
            if (bulletMatch) {
                return (
                    <li key={index} className="ml-4 mb-2">
                        {bulletMatch[2]}
                    </li>
                )
            }
            return (
                <p key={index} className="mb-2">
                    {line.trim()}
                </p>
            )
        })
    }
    return (
        <Card className="relative flex flex-col">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-tight">{alert.title}</CardTitle>
                    {(() => {
                        const alertStatus = getAlertStatus(alert)
                        return (
                            <Badge variant={getBadgeVariant(alertStatus.status)} className="shrink-0">
                                {alertStatus.label}
                            </Badge>
                        )
                    })()}
                </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-grow">
                {reducedContent ? null : (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">Duration</span>
                        </div>
                        <div className="pl-6 space-y-1 text-sm text-muted-foreground">
                            <div>From: {formatDate(alert.start_date)}</div>
                            <div>Until: {formatDate(alert.end_date)}</div>
                            {(() => {
                                const alertStatus = getAlertStatus(alert)
                                if (alertStatus.status === "soon") {
                                    const now = Date.now() / 1000
                                    const timeUntilStart = alert.start_date - now
                                    const daysUntil = Math.ceil(timeUntilStart / (24 * 60 * 60))

                                    if (daysUntil === 1) {
                                        return <div className="text-amber-600 font-medium">Starts tomorrow</div>
                                    } else if (daysUntil <= 7) {
                                        return <div className="text-amber-600 font-medium">Starts in {daysUntil} days</div>
                                    }
                                }
                                return null
                            })()}
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    <Collapsible
                        open={descriptionExpanded}
                        onOpenChange={setDescriptionExpanded}
                    >
                        <div className="text-sm leading-relaxed">
                            {descriptionExpanded ? (
                                formatDescription(alert.description)
                            ) : (
                                <p className="mb-2">{getDescriptionPreview(alert.description)}</p>
                            )}
                        </div>
                        {alert.description.length > 150 && (
                            <CollapsibleTrigger className="text-sm font-medium text-primary hover:underline mt-2">
                                {descriptionExpanded ? "Show less" : "Read more"}
                            </CollapsibleTrigger>
                        )}
                    </Collapsible>
                </div>

                {alert.affected.length > 0 && !reducedContent && (
                    <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                            <MapPin className="h-4 w-4" />
                            Affected locations ({alert.affected.length})
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2">
                            <ul className="pl-6 space-y-1 text-sm text-muted-foreground">
                                {alert.affected.map((item, idx) => (
                                    <li key={idx} className="list-disc">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </CollapsibleContent>
                    </Collapsible>
                )}
            </CardContent>

            <CardFooter className="pt-0">
                <div className="flex flex-wrap items-center gap-2 justify-between w-full">
                    <Badge variant={"secondary"} className="flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" />
                        {formatTextToNiceLookingWords(alert.cause.replace("_", " ").toLowerCase(), true)}
                    </Badge>
                    <Badge variant="outline">
                        {formatTextToNiceLookingWords(alert.effect.replace("_", " ").toLowerCase(), true)}
                    </Badge>
                </div>
            </CardFooter>
        </Card>
    )
}

export interface AlertType {
    start_date: number
    end_date: number
    cause: string
    effect: string
    title: string
    description: string
    affected: string[]
}

export function DisplayTodaysAlerts({ stopName }: { stopName: string }) {
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
                            if (!seenAlerts.find((a) => a.alert_hash === hash)) {
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
    }, [stopName])


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