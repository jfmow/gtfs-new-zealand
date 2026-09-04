"use client"

import { useEffect, useMemo, useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { addJourneyReminder } from "@/lib/notifications"
import type { JourneyType, Location } from "./types"
import {
    getFirstTransitLeg,
    leadingAccessSeconds,
    nzServiceDate,
    nzHHMM,
    formatTime,
} from "./helpers"

export interface LeaveReminderContext {
    startLocation: Location | null
    endLocation: Location | null
    maxWalkKm: string
    walkSpeed: string
    maxTransfers: string
    timeType: "now" | "leaveat" | "arriveat"
    selectedDate: Date
}

interface LeaveReminderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The journey the reminder is built from. Its first transit leg is the boarding service. */
    route: JourneyType | null
    requestContext: LeaveReminderContext
    /** Same-origin path the notification should open (defaults to /plan). */
    deeplink?: string
}

const OFFSET_CHOICES: { value: number; label: string }[] = [
    { value: 30, label: "30 min before" },
    { value: 15, label: "15 min" },
    { value: 5, label: "5 min" },
    { value: 0, label: "When to leave" },
]

const PREP_CHOICES = [0, 5, 10, 15]

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]

type RepeatMode = "once" | "weekdays" | "custom"

function Chip({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent"
            )}
        >
            {children}
        </button>
    )
}

export function LeaveReminderDialog({
    open,
    onOpenChange,
    route,
    requestContext,
    deeplink,
}: LeaveReminderDialogProps) {
    const [offsets, setOffsets] = useState<number[]>([30, 15, 5, 0])
    const [prep, setPrep] = useState(5)
    const [repeat, setRepeat] = useState<RepeatMode>("once")
    const [customDays, setCustomDays] = useState<boolean[]>([false, false, false, false, false, false, false])
    const [until, setUntil] = useState("")
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            setOffsets([30, 15, 5, 0])
            setPrep(5)
            setRepeat("once")
            setCustomDays([false, false, false, false, false, false, false])
            setUntil("")
        }
    }, [open])

    const transit = route ? getFirstTransitLeg(route) : null

    const recurrenceMask = useMemo(() => {
        if (repeat === "once") return ""
        if (repeat === "weekdays") return "1111100"
        const mask = customDays.map((d) => (d ? "1" : "0")).join("")
        return mask.includes("1") ? mask : ""
    }, [repeat, customDays])

    const toggleOffset = (v: number) =>
        setOffsets((cur) => (cur.includes(v) ? cur.filter((o) => o !== v) : [...cur, v]))

    const toggleDay = (i: number) =>
        setCustomDays((cur) => cur.map((d, idx) => (idx === i ? !d : d)))

    if (!route || !transit) return null

    const arriveAt = requestContext.timeType === "arriveat"
    const targetSourceIso = arriveAt
        ? route.ArrivalTime
        : (transit.scheduled_departure_time ?? transit.DepartureTime)

    const start = requestContext.startLocation ?? {
        lat: route.StartLat,
        lon: route.StartLon,
        label: "Start",
    }
    const end = requestContext.endLocation ?? {
        lat: route.EndLat,
        lon: route.EndLon,
        label: "Destination",
    }

    const handleSubmit = async () => {
        if (offsets.length === 0) {
            toast.error("Pick at least one alert time")
            return
        }
        setSubmitting(true)

        // A recurring reminder resolves a different trip each day, so the
        // fixed-trip share deeplink (with a stale plan id) is wrong for it -
        // point it at a pre-filled planner search instead.
        const recurringDeeplink =
            `/plan?startLat=${start.lat}&startLon=${start.lon}&startLabel=${encodeURIComponent(start.label)}` +
            `&endLat=${end.lat}&endLon=${end.lon}&endLabel=${encodeURIComponent(end.label)}` +
            `&maxWalkKm=${requestContext.maxWalkKm}&walkSpeed=${requestContext.walkSpeed}&maxTransfers=${requestContext.maxTransfers}` +
            `&timeType=${arriveAt ? "arriveat" : "leaveat"}`

        const common = {
            start: { lat: start.lat, lon: start.lon, label: start.label },
            end: { lat: end.lat, lon: end.lon, label: end.label },
            maxWalkKm: requestContext.maxWalkKm,
            walkSpeed: requestContext.walkSpeed,
            maxTransfers: requestContext.maxTransfers,
            prepBufferSeconds: prep * 60,
            offsets,
        }

        let res
        if (recurrenceMask === "") {
            // one-off, exact boarding service
            const boardIso = new Date(transit.scheduled_departure_time ?? transit.DepartureTime).toISOString()
            res = await addJourneyReminder({
                ...common,
                kind: "fixed_trip",
                deeplink: deeplink ?? recurringDeeplink,
                timeType: arriveAt ? "arriveat" : "departat",
                targetHHMM: nzHHMM(targetSourceIso),
                serviceDate: nzServiceDate(transit.scheduled_departure_time ?? transit.DepartureTime),
                boardTripId: transit.TripID,
                boardStopId: transit.FromStop?.stop_id,
                scheduledDepartureIso: boardIso,
                routeShortName: transit.Route?.route_short_name || transit.RouteID,
                boardStopName: transit.FromStop?.stop_name,
                accessSeconds: leadingAccessSeconds(route, prep * 60),
            })
        } else {
            // recurring - resolved per occurrence on the day
            res = await addJourneyReminder({
                ...common,
                kind: "journey_request",
                deeplink: recurringDeeplink,
                timeType: arriveAt ? "arriveat" : "departat",
                targetHHMM: nzHHMM(targetSourceIso),
                recurrence: recurrenceMask,
                recurrenceUntil: until ? until.replace(/-/g, "") : undefined,
            })
        }

        setSubmitting(false)

        if (!res.ok) {
            toast.error(res.message || "Couldn't set the reminder")
            return
        }
        if (res.nextLeaveLocal) {
            toast.success(`Reminder set — leave around ${formatTime(`1970-01-01T${res.nextLeaveLocal}:00`)}`)
        } else {
            toast.success("Reminder set — we'll work out your leave time on the day")
        }
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Remind me when to leave</DialogTitle>
                    <DialogDescription>
                        {start.label} → {end.label}
                        {" · "}
                        {arriveAt ? "arrive by " : "depart "}
                        {formatTime(targetSourceIso)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Alert me</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {OFFSET_CHOICES.map((o) => (
                                <Chip key={o.value} active={offsets.includes(o.value)} onClick={() => toggleOffset(o.value)}>
                                    {o.label}
                                </Chip>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Time to get ready</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {PREP_CHOICES.map((m) => (
                                <Chip key={m} active={prep === m} onClick={() => setPrep(m)}>
                                    {m === 0 ? "None" : `${m} min`}
                                </Chip>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Repeat</Label>
                        <div className="flex flex-wrap gap-1.5">
                            <Chip active={repeat === "once"} onClick={() => setRepeat("once")}>Once</Chip>
                            <Chip active={repeat === "weekdays"} onClick={() => setRepeat("weekdays")}>Weekdays</Chip>
                            <Chip active={repeat === "custom"} onClick={() => setRepeat("custom")}>Custom…</Chip>
                        </div>
                        {repeat === "custom" && (
                            <div className="flex gap-1 pt-1">
                                {DAY_LABELS.map((d, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => toggleDay(i)}
                                        className={cn(
                                            "h-8 w-8 rounded-full border text-xs font-medium transition-colors",
                                            customDays[i]
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-input bg-background hover:bg-accent"
                                        )}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        )}
                        {repeat !== "once" && (
                            <div className="flex items-center gap-2 pt-1">
                                <Label htmlFor="repeat-until" className="text-xs text-muted-foreground">
                                    Until
                                </Label>
                                <input
                                    id="repeat-until"
                                    type="date"
                                    value={until}
                                    onChange={(e) => setUntil(e.target.value)}
                                    className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                                />
                                <span className="text-[11px] text-muted-foreground">optional (max 90 days)</span>
                            </div>
                        )}
                    </div>

                    {recurrenceMask !== "" && (
                        <p className="text-[11px] text-muted-foreground">
                            We&apos;ll find the best journey matching your settings on each day and tell you when to leave.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting || offsets.length === 0}>
                        {submitting ? "Setting…" : "Set reminder"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
