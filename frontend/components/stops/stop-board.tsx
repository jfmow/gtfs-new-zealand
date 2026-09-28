import { lazy, Suspense, useState } from "react"
import { isSameDay } from "date-fns"
import { Bell, CalendarDays, ChevronLeft, MessageCircleWarning, MoreHorizontal, Navigation, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import LoadingSpinner from "@/components/loading-spinner"
import StopNotifications from "@/components/notifications"
import { MapSidePanel, MapSidePanelHeader } from "@/components/map/map-side-panel"
import type { ServiceTrackerTarget } from "@/components/services"
import { GroupedAlertsByRoute, useStopAlerts } from "@/pages/alerts"
import { AddToFavorites } from "./favourites"
import { NavigateToStopDialog } from "./navigate-to-stop"

const Services = lazy(() => import("@/components/services"))

interface StopBoardProps {
    /** The stop query `/services/{stop}` expects ("Name code", or a search result's name). */
    stopQuery: string
    title: string
    onClose: () => void
}

/**
 * A stop's departures - the iOS `StopBoardView`. A page on the Schedule tab
 * and on phones' Map tab (with a back button to where it was opened from),
 * or the Map tab's side panel on desktop.
 */
export function StopBoardPage({ stopQuery, title, onClose, backLabel }: StopBoardProps & { backLabel: string }) {
    const [date, setDate] = useState<Date | undefined>()
    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col">
            <div className="flex items-center gap-1 px-2 pb-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-md py-1.5 pl-1 pr-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <ChevronLeft className="h-4 w-4" />
                    {backLabel}
                </button>
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
                <StopBoardActions stopQuery={stopQuery} title={title} onPickDate={setDate} />
            </div>
            <BoardBody stopQuery={stopQuery} date={date} onBackToLive={() => setDate(undefined)} />
        </div>
    )
}

export function StopBoardPanel({
    stopQuery,
    title,
    onClose,
    onOpenService,
    openTripId,
}: StopBoardProps & {
    /** A departure opens through this, over the page's map. */
    onOpenService?: (target: ServiceTrackerTarget) => void
    openTripId?: string
}) {
    const [date, setDate] = useState<Date | undefined>()
    return (
        <MapSidePanel>
            <MapSidePanelHeader
                title={title}
                actions={
                    <>
                        <StopBoardActions stopQuery={stopQuery} title={title} onPickDate={setDate} />
                        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                            <X className="h-4 w-4" />
                        </Button>
                    </>
                }
            />
            <div className="flex-1 overflow-y-auto overscroll-contain pt-3">
                <BoardBody
                    stopQuery={stopQuery}
                    date={date}
                    onBackToLive={() => setDate(undefined)}
                    onOpenService={onOpenService}
                    openTripId={openTripId}
                />
            </div>
        </MapSidePanel>
    )
}

function BoardBody({
    stopQuery,
    date,
    onBackToLive,
    onOpenService,
    openTripId,
}: {
    stopQuery: string
    date: Date | undefined
    onBackToLive: () => void
    onOpenService?: (target: ServiceTrackerTarget) => void
    openTripId?: string
}) {
    return (
        <>
            {date && (
                <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                    <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium">
                        Timetable for {date.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                    <Button variant="outline" size="sm" className="h-8" onClick={onBackToLive}>Back to live</Button>
                </div>
            )}
            <Suspense fallback={<LoadingSpinner description="Loading departures..." height="200px" />}>
                <Services stopName={stopQuery} filterDate={date} onOpenService={onOpenService} openTripId={openTripId} />
            </Suspense>
        </>
    )
}

/** Bell (this stop's alert subscription), star, and ⋯ - the iOS board's toolbar. */
function StopBoardActions({ stopQuery, title, onPickDate }: { stopQuery: string; title: string; onPickDate: (date: Date | undefined) => void }) {
    const [dialog, setDialog] = useState<"date" | "directions" | "alerts" | null>(null)
    const { alerts, routes, loading } = useStopAlerts(stopQuery)
    const alertCount = Object.values(alerts).reduce((n, list) => n + list.length, 0)

    return (
        <div className="flex shrink-0 items-center">
            <StopNotifications stopName={stopQuery} routes={routes}>
                <Button variant="ghost" size="icon" aria-label="Get alerts for this stop">
                    <Bell className="h-4 w-4" />
                </Button>
            </StopNotifications>
            <AddToFavorites stopName={stopQuery} />
            {/* Non-modal: its items open dialogs. */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => setDialog("date")}>
                        <CalendarDays className="h-4 w-4" />
                        Timetable for a date
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog("directions")}>
                        <Navigation className="h-4 w-4" />
                        Directions to stop
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog("alerts")}>
                        <MessageCircleWarning className="h-4 w-4" />
                        Service alerts
                        {alertCount > 0 && <span className="ml-auto rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{alertCount}</span>}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={dialog === "date"} onOpenChange={(open) => !open && setDialog(null)}>
                <DialogContent className="w-auto max-w-[min(22rem,calc(100vw-2rem))]">
                    <DialogHeader>
                        <DialogTitle>Timetable for a date</DialogTitle>
                    </DialogHeader>
                    <Calendar
                        mode="single"
                        className="mx-auto"
                        onSelect={(picked) => {
                            onPickDate(picked && !isSameDay(picked, new Date()) ? picked : undefined)
                            setDialog(null)
                        }}
                    />
                </DialogContent>
            </Dialog>

            <NavigateToStopDialog stopName={stopQuery} open={dialog === "directions"} onOpenChange={(open) => !open && setDialog(null)} />

            <Dialog open={dialog === "alerts"} onOpenChange={(open) => !open && setDialog(null)}>
                <DialogContent className="flex max-h-[85svh] max-w-3xl flex-col">
                    <DialogHeader>
                        <DialogTitle>Service alerts · {title}</DialogTitle>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto">
                        {loading ? <LoadingSpinner description="Loading alerts..." height="160px" /> : <GroupedAlertsByRoute alerts={alerts} />}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
