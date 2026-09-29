import { useEffect, useState } from "react"
import { AlarmClock, Footprints, Hash, Loader2, MapPin, Minus, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import notification, { addJourneyReminder } from "@/lib/notifications"
import { nzHHMM, nzServiceDate, formatTime } from "@/components/journey/helpers"
import { cn } from "@/lib/utils"
import { DEFAULT_WALK_SPEED } from "@/lib/walk-speed"

type ReminderKind = "get_off" | "arrival" | "n_stops_away" | "leave"

export interface StopReminderTarget {
    tripId: string
    /** The parent stop id reminders are keyed on. */
    parentStopId: string
    /** The platform's stop id - the "before it leaves" reminder boards here. */
    childStopId?: string
    stopName: string
    lat?: number
    lon?: number
    /** "70 to Botany" - the dialog's subtitle. */
    serviceLabel?: string
    routeShortName?: string
    /** Timetabled departure from this stop (epoch ms) - enables "Before it leaves here". */
    scheduledMs?: number
    /** Live predicted departure (epoch ms), shown in the confirmation. */
    predictedMs?: number
}

const LEAVE_OFFSETS = [
    { minutes: 30, label: "30 min before" },
    { minutes: 15, label: "15 min" },
    { minutes: 5, label: "5 min" },
    { minutes: 0, label: "As it leaves" },
]

/**
 * A one-off notification about one trip at one stop - the iOS
 * `StopReminderSheet`, plus the web's "before it leaves here" leave-by
 * reminder when the stop's departure time is known. "Get off here" is left
 * out where the rider is getting on (a board, or their own stop).
 */
export function StopReminderDialog({
    target,
    offersGetOff = true,
    onOpenChange,
    onSet,
}: {
    target: StopReminderTarget | null
    offersGetOff?: boolean
    onOpenChange: (open: boolean) => void
    /** After a reminder is saved - e.g. to mark the stop in a list. */
    onSet?: (target: StopReminderTarget) => void
}) {
    const [stopsBefore, setStopsBefore] = useState(2)
    const [saving, setSaving] = useState<ReminderKind | null>(null)
    const [leaveOpen, setLeaveOpen] = useState(false)
    const [leaveOffsets, setLeaveOffsets] = useState<number[]>([15, 5])

    useEffect(() => { if (target) setLeaveOpen(false) }, [target])

    const departsMs = target?.predictedMs || target?.scheduledMs || 0
    const offsetPassed = (minutes: number) => departsMs - minutes * 60_000 <= Date.now() + 15_000
    const canLeave = !!target?.scheduledMs && !!target.childStopId && target.lat !== undefined && !offsetPassed(0)

    const finish = (message: string) => {
        toast.success(message, { duration: 6000 })
        if (target) onSet?.(target)
        onOpenChange(false)
    }

    const set = async (kind: Exclude<ReminderKind, "leave">) => {
        if (!target) return
        setSaving(kind)
        const ok = await notification.addReminder(
            target.parentStopId,
            target.tripId,
            kind,
            kind === "n_stops_away" ? stopsBefore : undefined,
        )
        setSaving(null)
        if (!ok) {
            toast.error("Couldn't set the reminder - are notifications allowed for this site?")
            return
        }
        finish(
            kind === "get_off"
                ? "Reminder set - you'll get a notification when your stop is next"
                : kind === "n_stops_away"
                    ? `Reminder set - you'll get a notification when it's ${stopsBefore} stop${stopsBefore === 1 ? "" : "s"} away`
                    : `Reminder set - you'll get a notification as it arrives at ${target.stopName}`,
        )
    }

    const setLeave = async () => {
        if (!target?.scheduledMs || !target.childStopId || target.lat === undefined || target.lon === undefined) return
        const usable = leaveOffsets.filter((m) => !offsetPassed(m))
        if (usable.length === 0) {
            toast.error("Those alert times have already passed")
            return
        }
        setSaving("leave")
        const sched = new Date(target.scheduledMs)
        const res = await addJourneyReminder({
            kind: "fixed_trip",
            start: { lat: target.lat, lon: target.lon, label: target.stopName },
            end: { lat: target.lat, lon: target.lon, label: target.stopName },
            timeType: "departat",
            targetHHMM: nzHHMM(sched),
            serviceDate: nzServiceDate(sched),
            boardTripId: target.tripId,
            boardStopId: target.childStopId,
            scheduledDepartureIso: sched.toISOString(),
            routeShortName: target.routeShortName ?? "",
            boardStopName: target.stopName,
            accessSeconds: 0,
            offsets: usable,
            maxWalkKm: "1",
            walkSpeed: DEFAULT_WALK_SPEED,
            maxTransfers: "5",
            deeplink: `/vehicles?tripId=${encodeURIComponent(target.tripId)}`,
        })
        setSaving(null)
        if (!res.ok) {
            toast.error(res.message || "Couldn't set the reminder")
            return
        }
        const shown = res.nextLeaveLocal ? formatTime(`1970-01-01T${res.nextLeaveLocal}:00`) : formatTime(new Date(departsMs))
        finish(`Reminder set - the ${target.routeShortName ? target.routeShortName + " " : ""}${shown} departure from ${target.stopName}`)
    }

    const option = (kind: Exclude<ReminderKind, "leave">, icon: React.ReactNode, title: string, detail: string) => (
        <button
            type="button"
            disabled={saving !== null}
            onClick={() => set(kind)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
        >
            <span className="flex w-6 justify-center text-blue-600 dark:text-blue-400" aria-hidden>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
            </span>
            {saving === kind && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </button>
    )

    return (
        <Dialog open={target !== null} onOpenChange={onOpenChange}>
            <DialogContent className="gap-3 sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{target?.stopName}</DialogTitle>
                    <DialogDescription>{target?.serviceLabel ? `${target.serviceLabel} · ` : ""}A one-off notification for this trip.</DialogDescription>
                </DialogHeader>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {offersGetOff && option("get_off", <Footprints className="h-4 w-4" />, "Get off here", "When this is the next stop")}
                    {option("arrival", <MapPin className="h-4 w-4" />, "When it's arriving", "As the vehicle reaches this stop")}
                    <div className="flex items-center">
                        <div className="min-w-0 flex-1">
                            {option(
                                "n_stops_away",
                                <Hash className="h-4 w-4" />,
                                `${stopsBefore} stop${stopsBefore === 1 ? "" : "s"} before`,
                                "A heads-up while it's on the way",
                            )}
                        </div>
                        <div className="mr-3 flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label="Stops before">
                            <button type="button" aria-label="Fewer stops" disabled={stopsBefore <= 1} onClick={() => setStopsBefore(stopsBefore - 1)} className="flex h-8 w-8 items-center justify-center hover:bg-accent disabled:opacity-40">
                                <Minus className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" aria-label="More stops" disabled={stopsBefore >= 20} onClick={() => setStopsBefore(stopsBefore + 1)} className="flex h-8 w-8 items-center justify-center border-l border-border hover:bg-accent disabled:opacity-40">
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    {canLeave && (
                        <div>
                            <button
                                type="button"
                                disabled={saving !== null}
                                onClick={() => setLeaveOpen(!leaveOpen)}
                                aria-expanded={leaveOpen}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
                            >
                                <span className="flex w-6 justify-center text-blue-600 dark:text-blue-400" aria-hidden><AlarmClock className="h-4 w-4" /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium">Before it leaves here</span>
                                    <span className="block text-xs text-muted-foreground">So you&apos;re not late getting to the stop</span>
                                </span>
                            </button>
                            {leaveOpen && (
                                <div className="space-y-3 px-4 pb-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {LEAVE_OFFSETS.map((o) => {
                                            const passed = offsetPassed(o.minutes)
                                            const on = leaveOffsets.includes(o.minutes)
                                            return (
                                                <button
                                                    key={o.minutes}
                                                    type="button"
                                                    disabled={passed}
                                                    aria-pressed={on}
                                                    onClick={() => setLeaveOffsets(on ? leaveOffsets.filter((m) => m !== o.minutes) : [...leaveOffsets, o.minutes])}
                                                    className={cn(
                                                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                                        passed
                                                            ? "cursor-not-allowed border-input bg-muted text-muted-foreground/50 line-through"
                                                            : on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-accent",
                                                    )}
                                                >
                                                    {o.label}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <Button size="sm" className="w-full" disabled={saving !== null || leaveOffsets.length === 0} onClick={setLeave}>
                                        {saving === "leave" && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Set reminder
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
