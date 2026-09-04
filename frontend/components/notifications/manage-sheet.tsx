"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer"
import { Pencil, Trash2, Route as RouteIcon } from "lucide-react"
import { toast } from "sonner"
import { useIsMobile } from "@/lib/utils"
import {
    getMySubscriptions,
    removeSubscription,
    removeRouteSubscription,
    getJourneyReminders,
    removeJourneyReminder,
    type MySubscriptions,
    type StopSubscription,
    type RouteSubscription,
    type JourneyReminder,
} from "@/lib/notifications"
import { weekdayMaskLabel, formatTime } from "@/components/journey/helpers"
import StopNotifications from "@/components/notifications"
import RouteNotifications from "@/components/notifications/route-notifications"
import LoadingSpinner from "@/components/loading-spinner"
import { groupKeysFor } from "@/components/notifications/cause-group-picker"
import type { AlertCause } from "@/lib/alert-causes"

interface ManageNotificationsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

function SubscriptionRow({
    label,
    detail,
    editTrigger,
    onDelete,
}: {
    label: string
    detail: string
    editTrigger: React.ReactNode
    onDelete: () => void
}) {
    return (
        <div className="flex items-center gap-2 px-4 py-3">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{detail}</p>
            </div>
            {editTrigger}
            <button
                aria-label={`Remove ${label}`}
                onClick={onDelete}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    )
}

function subscriptionDetail(causes: string[] | null, minSeverity: string, notifyCancellations: boolean, extra?: string): string {
    const parts: string[] = []
    if (extra) parts.push(extra)
    if (!causes || causes.length === 0) {
        parts.push("All alert types")
    } else {
        const groupCount = groupKeysFor(causes as AlertCause[]).length
        parts.push(groupCount > 0 ? `${groupCount} alert type${groupCount !== 1 ? "s" : ""}` : "Custom alert types")
    }
    if (minSeverity) parts.push(`${minSeverity.toLowerCase()}+`)
    if (!notifyCancellations) parts.push("no cancellations")
    return parts.join(" · ")
}

function journeyReminderDetail(r: JourneyReminder): string {
    const parts: string[] = [weekdayMaskLabel(r.recurrence)]
    parts.push(`${r.time_type === "arriveat" ? "arrive by" : "leave"} ${r.target_hhmm}`)
    if (r.status === "pending_resolve") {
        parts.push("finding your trip…")
    } else if (r.status === "scheduled") {
        parts.push(`next ${r.service_date}`)
    } else if (r.next_leave_local) {
        parts.push(`leave ~${formatTime(`1970-01-01T${r.next_leave_local}:00`)}`)
    }
    if (r.recurrence && r.recurrence_until) parts.push(`until ${r.recurrence_until}`)
    return parts.join(" · ")
}

function ManageNotificationsBody() {
    const [subscriptions, setSubscriptions] = useState<MySubscriptions | null>(null)
    const [journeyReminders, setJourneyReminders] = useState<JourneyReminder[]>([])
    const [loading, setLoading] = useState(true)

    const refetch = useCallback(() => {
        setLoading(true)
        Promise.all([getMySubscriptions(), getJourneyReminders()]).then(([subs, reminders]) => {
            setSubscriptions(subs)
            setJourneyReminders(reminders)
            setLoading(false)
        })
    }, [])

    useEffect(() => {
        refetch()
    }, [refetch])

    const stops = subscriptions?.stops ?? []
    const routes = subscriptions?.routes ?? []

    const removeReminder = async (r: JourneyReminder) => {
        if (await removeJourneyReminder(r.id)) {
            toast.success("Reminder removed")
            refetch()
        } else {
            toast.error("Failed to remove reminder")
        }
    }

    const removeStop = async (stop: StopSubscription) => {
        const removed = await removeSubscription(stop.parent_stop_id)
        if (removed) {
            toast.success(`Notifications removed for stop`)
            refetch()
        } else {
            toast.error("Failed to remove subscription")
        }
    }

    const removeRoute = async (route: RouteSubscription) => {
        const removed = await removeRouteSubscription(route.route_id)
        if (removed) {
            toast.success(`Notifications removed for route ${route.route_id}`)
            refetch()
        } else {
            toast.error("Failed to remove subscription")
        }
    }

    if (loading) {
        return <LoadingSpinner height="200px" description="Loading your notifications..." />
    }

    if (stops.length === 0 && routes.length === 0 && journeyReminders.length === 0) {
        return (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notification subscriptions yet. Enable alerts from a stop or route to see them here.
            </p>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto divide-y">
            {journeyReminders.length > 0 && (
                <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Leave-by reminders
                </div>
            )}
            {journeyReminders.map((r) => (
                <SubscriptionRow
                    key={`jr-${r.id}`}
                    label={`${r.route_short_name || "Journey"} → ${r.end_label || "destination"}`}
                    detail={journeyReminderDetail(r)}
                    onDelete={() => removeReminder(r)}
                    editTrigger={null}
                />
            ))}
            {routes.map((route) => (
                <SubscriptionRow
                    key={`route-${route.route_id}`}
                    label={`Route ${route.route_id}`}
                    detail={subscriptionDetail(route.causes, route.min_severity, route.notify_cancellations)}
                    onDelete={() => removeRoute(route)}
                    editTrigger={
                        <RouteNotifications routeId={route.route_id} onChanged={refetch}>
                            <button
                                aria-label={`Edit route ${route.route_id}`}
                                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                        </RouteNotifications>
                    }
                />
            ))}
            {stops.map((stop) => (
                <SubscriptionRow
                    key={`stop-${stop.parent_stop_id}`}
                    label={`Stop ${stop.parent_stop_id}`}
                    detail={subscriptionDetail(
                        stop.causes,
                        stop.min_severity,
                        stop.notify_cancellations,
                        stop.routes && stop.routes.length > 0 ? stop.routes.join(", ") : "All routes"
                    )}
                    onDelete={() => removeStop(stop)}
                    editTrigger={
                        <StopNotifications stopName={stop.parent_stop_id} routes={stop.routes ?? []} onChanged={refetch}>
                            <button
                                aria-label={`Edit stop ${stop.parent_stop_id}`}
                                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                        </StopNotifications>
                    }
                />
            ))}
        </div>
    )
}

export function ManageNotificationsSheet({ open, onOpenChange }: ManageNotificationsSheetProps) {
    const isMobile = useIsMobile()
    const title = (
        <span className="flex items-center gap-1.5">
            <RouteIcon className="h-3.5 w-3.5" />
            My notifications
        </span>
    )

    if (isMobile) {
        return (
            <Drawer open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="max-h-[85vh] flex flex-col">
                    <DrawerHeader className="px-4 py-3 border-b text-left">
                        <DrawerTitle className="text-sm">{title}</DrawerTitle>
                    </DrawerHeader>
                    {open && <ManageNotificationsBody />}
                </DrawerContent>
            </Drawer>
        )
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0">
                <SheetHeader className="px-4 py-3 border-b">
                    <SheetTitle className="text-sm">{title}</SheetTitle>
                </SheetHeader>
                {open && <ManageNotificationsBody />}
            </SheetContent>
        </Sheet>
    )
}
