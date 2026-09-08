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

// Minutes of advance heads-up before the "leave now" nudge.
const OFFSET_CHOICES: { value: number; label: string }[] = [
    { value: 30, label: "30 min before" },
    { value: 15, label: "15 min before" },
    { value: 5, label: "5 min before" },
    { value: 0, label: "When to leave" },
]

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]

type RepeatMode = "once" | "weekdays" | "custom"

function Chip({
    active,
    disabled,
    onClick,
    children,
}: {
    active: boolean
    disabled?: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={disabled ? "That time has already passed" : undefined}
            className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                disabled
                    ? "cursor-not-allowed border-input bg-muted text-muted-foreground/50 line-through"
                    : active
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
    const [repeat, setRepeat] = useState<RepeatMode>("once")
    const [customDays, setCustomDays] = useState<boolean[]>([false, false, false, false, false, false, false])
    const [until, setUntil] = useState("")
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            setOffsets([30, 15, 5, 0])
            setRepeat("once")
            setCustomDays([false, false, false, false, false, false, false])
            setUntil("")
        }
    }, [open])

    const transit = route ? getFirstTransitLeg(route) : null

    // For a one-off reminder we know the concrete leave time, so any heads-up
    // whose moment has already passed is impossible - disable it. (A recurring
    // reminder resolves a fresh trip each day, so every offset stays valid.)
    const leaveMs =
        route && transit
            ? new Date(transit.scheduled_departure_time ?? transit.DepartureTime).getTime() -
              leadingAccessSeconds(route) * 1000
            : null
    const offsetPassed = (minutes: number) =>
        repeat === "once" && leaveMs !== null && leaveMs - minutes * 60_000 <= Date.now() + 15_000

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

    const usableOffsets = offsets.filter((o) => !offsetPassed(o))

    const handleSubmit = async () => {
        if (usableOffsets.length === 0) {
            toast.error(offsets.length === 0 ? "Pick at least one alert time" : "Those alert times have already passed")
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
            offsets: usableOffsets,
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
                accessSeconds: leadingAccessSeconds(route),
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
                        <Label className="text-xs text-muted-foreground">Heads-up before you leave</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {OFFSET_CHOICES.map((o) => (
                                <Chip
                                    key={o.value}
                                    active={offsets.includes(o.value)}
                                    disabled={offsetPassed(o.value)}
                                    onClick={() => toggleOffset(o.value)}
                                >
                                    {o.label}
                                </Chip>
                            ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {repeat === "once" && usableOffsets.length === 0
                                ? "This journey leaves too soon to set a reminder — try repeating it, or an earlier trip."
                                : `"When to leave" is the go signal; the others are advance nudges.`}
                        </p>
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
                    <Button onClick={handleSubmit} disabled={submitting || usableOffsets.length === 0}>
                        {submitting ? "Setting…" : "Set reminder"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
