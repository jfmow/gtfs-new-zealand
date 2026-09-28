import { memo, useEffect, useState } from "react"
import StopsList from "./stops-list"
import TrackerMap from "./tracker-map"
import { TrackerHero } from "./hero"
import { useServiceTrackerContext } from "./use-service-tracker"
import { ApiFetch } from "@/lib/url-context"
import { TriangleAlertIcon, X, CalendarClockIcon, RadioIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, fullyEncodeURIComponent } from "@/lib/utils"
import type { AlertResponseData } from "@/lib/alert-causes"
import RouteNotifications from "@/components/notifications/route-notifications"
import { BellIcon } from "lucide-react"

type RouteAlert = AlertResponseData

/** Current alerts for a route (none without an id). */
export function useRouteAlerts(routeId: string | undefined) {
    const [alerts, setAlerts] = useState<RouteAlert[]>([])
    useEffect(() => {
        if (!routeId) {
            setAlerts([])
            return
        }
        let cancelled = false
        ApiFetch<RouteAlert[]>(`realtime/alerts/route/${fullyEncodeURIComponent(routeId)}`, { method: "GET" }).then((res) => {
            if (!cancelled) setAlerts(res.ok ? res.data : [])
        })
        return () => { cancelled = true }
    }, [routeId])
    return alerts
}

const ServiceTrackerContent = memo(function ServiceTrackerContent() {
    const { vehicle, stops, stopTimes, previewData, tripId, tripUpdateTracking, hideMap, stopsLayout, alertsInChrome } = useServiceTrackerContext()

    // On a full-screen page the inline map fills more of the view; docked/inset it
    // sits in a compact slot above the stop list.
    const mapHeight = stopsLayout === "page" ? "min(58vh, 560px)" : "320px"

    const activeRouteId = vehicle?.route.id || previewData?.route_id
    const routeAlerts = useRouteAlerts(alertsInChrome ? undefined : activeRouteId)
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())
    const visibleAlerts = routeAlerts.filter((alert) => !dismissedAlerts.has(alert.title))
    const dismissAlert = (title: string) => setDismissedAlerts((prev) => new Set(prev).add(title))

    if (!vehicle && !(previewData && stops)) return null

    return (
        <div className="space-y-4">
            {!alertsInChrome && <RouteAlertsBanner alerts={visibleAlerts} onDismiss={dismissAlert} routeId={activeRouteId} />}

            <TrackerHero />

            {vehicle?.state === "Unknown" && <TrackingNotice level="limited" hasVehicle />}
            {!vehicle && <TrackingNotice level={tripUpdateTracking ? "limited" : "scheduled"} />}

            {!hideMap && <TrackerMap height={mapHeight} />}

            <StopsList
                layout={stopsLayout}
                tripId={tripId}
                stops={stops}
                vehicle={vehicle}
                stopTimes={stopTimes}
                routeShortName={vehicle?.route.name ?? previewData?.route_name}
                routeColor={vehicle?.route.color || previewData?.route_color}
            />
        </div>
    )
})

export default ServiceTrackerContent


function TrackingNotice({
    level,
    hasVehicle = false,
}: {
    level: "scheduled" | "limited"
    /** In "limited" mode: true when a vehicle position exists but is stale/unreliable, false when there's no position at all. */
    hasVehicle?: boolean
}) {
    const scheduled = level === "scheduled"
    const limitedText = hasVehicle
        ? "We're getting arrival updates for this trip, but its live position is unreliable right now — the map may be approximate."
        : "Arrival times below are live predictions for this trip. There's no vehicle position, so the map shows the route only."
    return (
        <div
            className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3",
                scheduled
                    ? "border-border bg-muted/50"
                    : "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40",
            )}
        >
            {scheduled ? (
                <CalendarClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
                <RadioIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div className="text-sm">
                <p
                    className={cn(
                        "font-medium",
                        scheduled ? "text-foreground" : "text-amber-800 dark:text-amber-200",
                    )}
                >
                    {scheduled ? "Timetable only" : "Limited tracking"}
                </p>
                <p className={scheduled ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300/90"}>
                    {scheduled
                        ? "This service isn't reporting its position. Times below come from the schedule, not a live vehicle."
                        : limitedText}
                </p>
            </div>
        </div>
    )
}

export const RouteAlertsBanner = memo(function RouteAlertsBanner({
    alerts,
    onDismiss,
    routeId,
}: {
    alerts: RouteAlert[]
    onDismiss: (title: string) => void
    routeId?: string
}) {
    if (alerts.length === 0) return null

    const renderAlert = (alert: RouteAlert) => (
        <Card key={alert.title} className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="flex items-start gap-2 p-3 sm:p-4">
                <TriangleAlertIcon className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{alert.title}</p>
                    {alert.description && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 line-clamp-3">{alert.description}</p>
                    )}
                </div>
                <button
                    onClick={() => onDismiss(alert.title)}
                    aria-label="Dismiss alert"
                    className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 flex-shrink-0"
                >
                    <X className="h-4 w-4" />
                </button>
            </CardContent>
        </Card>
    )

    const notifyMeRow = routeId ? (
        <RouteNotifications routeId={routeId}>
            <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
            >
                <span>Notify me about route {routeId}</span>
                <BellIcon className="h-3 w-3 text-muted-foreground" />
            </button>
        </RouteNotifications>
    ) : null

    if (alerts.length === 1) {
        return (
            <div className="mb-4 space-y-1.5">
                {renderAlert(alerts[0])}
                {notifyMeRow}
            </div>
        )
    }

    return (
        <div className="mb-4">
            <Popover>
                <PopoverTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900">
                        <TriangleAlertIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        {alerts.length} alerts on this route
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(24rem,90vw)] max-h-80 overflow-y-auto overscroll-contain space-y-2 p-2">
                    {alerts.map(renderAlert)}
                    {notifyMeRow}
                </PopoverContent>
            </Popover>
        </div>
    )
})
