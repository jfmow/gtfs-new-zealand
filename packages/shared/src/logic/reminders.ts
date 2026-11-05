/**
 * Leave-by reminders - a port of iOS `JourneyReminders.swift` (itself the
 * web's `addJourneyReminder`, field for field) and the subscription detail copy.
 */
import { goTime, type Coordinate, type JourneyReminderDTO } from "../models"
import { TRAVEL_MODES, type TravelMode } from "../endpoints"
import { ALERT_CAUSE_GROUP_INFO, type AlertCauseGroupKey } from "../alerts"
import type { JourneyType } from "../types/journey"
import { regionHHMM, serviceDate } from "./basics"

const t = (d: Date | string | null | undefined) => goTime(d as string | Date | null | undefined)

export interface ReminderPlace {
    label: string
    coordinate: Coordinate
}

export interface JourneyReminderRequest {
    kind: "fixed_trip" | "journey_request"
    start: ReminderPlace
    end: ReminderPlace
    timeType: "departat" | "arriveat"
    targetHHMM: string
    maxWalkKm: number
    walkSpeed: number
    maxTransfers: number
    onlyRoutes: string[]
    modes: TravelMode[]
    minTransferSec: number
    /** Minutes before leaving; 0 = "when to leave". For `changes`, one value: how long before leaving to start watching. */
    offsets: number[]
    alertMode: "leave" | "changes"
    deeplink: string
    recurrence?: string
    recurrenceUntil?: string
    serviceDate?: string
    boardTripId?: string
    boardStopId?: string
    scheduledDepartureIso?: string
    routeShortName?: string
    boardStopName?: string
    accessSeconds?: number
}

/** "1" rather than "1.0" for whole numbers, matching the web's strings. */
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(v))

/** The form body, exactly as the web sends it. */
export function reminderFormFields(r: JourneyReminderRequest): Record<string, string> {
    const form: Record<string, string> = {
        kind: r.kind,
        startLat: String(r.start.coordinate.lat), startLon: String(r.start.coordinate.lon), startLabel: r.start.label,
        endLat: String(r.end.coordinate.lat), endLon: String(r.end.coordinate.lon), endLabel: r.end.label,
        timeType: r.timeType,
        targetHHMM: r.targetHHMM,
        maxWalkKm: num(r.maxWalkKm),
        walkSpeed: num(r.walkSpeed),
        maxTransfers: String(r.maxTransfers),
        offsets: `[${r.offsets.join(",")}]`,
        deeplink: r.deeplink,
    }
    if (r.onlyRoutes.length) form.onlyRoutes = JSON.stringify(r.onlyRoutes)
    if (r.alertMode !== "leave") form.alertMode = r.alertMode
    if (r.modes.length) form.modes = TRAVEL_MODES.filter((m) => r.modes.includes(m)).join(",")
    if (r.minTransferSec > 0) form.minTransferSec = String(r.minTransferSec)
    if (r.recurrence) form.recurrence = r.recurrence
    if (r.recurrenceUntil) form.recurrenceUntil = r.recurrenceUntil
    if (r.serviceDate !== undefined) form.serviceDate = r.serviceDate
    if (r.boardTripId !== undefined) form.boardTripId = r.boardTripId
    if (r.boardStopId !== undefined) form.boardStopId = r.boardStopId
    if (r.scheduledDepartureIso !== undefined) form.scheduledDepartureIso = r.scheduledDepartureIso
    if (r.routeShortName !== undefined) form.routeShortName = r.routeShortName
    if (r.boardStopName !== undefined) form.boardStopName = r.boardStopName
    if (r.accessSeconds !== undefined) form.accessSeconds = String(r.accessSeconds)
    return form
}

/** Seconds from the plan's start to boarding its first ride, live to live. */
export function leadingAccessSeconds(plan: JourneyType): number {
    const transit = plan.Legs.find((l) => l.Mode === "transit")
    const board = transit ? t(transit.DepartureTime) ?? t(transit.scheduled_departure_time) : null
    const start = t(plan.Legs[0]?.DepartureTime)
    if (!board || !start) return 0
    return Math.max(0, Math.round((board.getTime() - start.getTime()) / 1000))
}

/** When to leave for `plan`: boarding minus the access walk. */
export function leaveTime(plan: JourneyType): Date | null {
    const transit = plan.Legs.find((l) => l.Mode === "transit")
    const board = transit ? t(transit.DepartureTime) ?? t(transit.scheduled_departure_time) : null
    return board ? new Date(board.getTime() - leadingAccessSeconds(plan) * 1000) : null
}

/** `recurringDeeplink` - reopens the planner with this search. */
export function planDeeplink(start: ReminderPlace, end: ReminderPlace, o: { maxWalkKm: number; walkSpeed: number; maxTransfers: number; onlyRoutes: string[]; arriveBy: boolean }): string {
    const q: [string, string][] = [
        ["startLat", String(start.coordinate.lat)], ["startLon", String(start.coordinate.lon)], ["startLabel", start.label],
        ["endLat", String(end.coordinate.lat)], ["endLon", String(end.coordinate.lon)], ["endLabel", end.label],
        ["maxWalkKm", num(o.maxWalkKm)], ["walkSpeed", num(o.walkSpeed)], ["maxTransfers", String(o.maxTransfers)],
        ["timeType", o.arriveBy ? "arriveat" : "leaveat"],
    ]
    if (o.onlyRoutes.length) q.push(["onlyRoutes", o.onlyRoutes.join(",")])
    return "/plan?" + q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
}

/** The request the web's LeaveReminderDialog builds for `plan`. Null with no ride to board. */
export function makeReminderRequest(a: {
    plan: JourneyType
    start: ReminderPlace
    end: ReminderPlace
    arriveBy: boolean
    maxWalkKm: number
    walkSpeed: number
    maxTransfers: number
    onlyRoutes: string[]
    modes?: TravelMode[]
    minTransferSec?: number
    offsets: number[]
    /** Seven 0/1 chars Mon..Sun; "" = once. */
    recurrence: string
    /** "YYYY-MM-DD" */
    recurrenceUntil?: string | null
    alertMode?: "leave" | "changes"
    regionSlug?: string | null
    tz: string
}): JourneyReminderRequest | null {
    const transit = a.plan.Legs.find((l) => l.Mode === "transit")
    const boardDeparture = transit ? t(transit.scheduled_departure_time) ?? t(transit.DepartureTime) : null
    if (!transit || !boardDeparture) return null
    const target = a.arriveBy ? t(a.plan.ArrivalTime) ?? boardDeparture : boardDeparture
    const r: JourneyReminderRequest = {
        kind: a.recurrence ? "journey_request" : "fixed_trip",
        start: a.start, end: a.end,
        timeType: a.arriveBy ? "arriveat" : "departat",
        targetHHMM: regionHHMM(target, a.tz),
        maxWalkKm: a.maxWalkKm, walkSpeed: a.walkSpeed, maxTransfers: a.maxTransfers,
        onlyRoutes: a.onlyRoutes, modes: a.modes ?? [], minTransferSec: a.minTransferSec ?? 0,
        offsets: a.offsets, alertMode: a.alertMode ?? "leave", deeplink: "",
    }
    if (!a.recurrence) {
        r.deeplink = `/journey?id=${a.plan.ID}` + (a.regionSlug ? `&region=${a.regionSlug}` : "")
        r.serviceDate = serviceDate(boardDeparture, a.tz)
        r.boardTripId = transit.TripID
        r.boardStopId = transit.FromStop?.stop_id
        r.scheduledDepartureIso = boardDeparture.toISOString()
        r.routeShortName = transit.Route?.route_short_name || transit.RouteID
        r.boardStopName = transit.FromStop?.stop_name
        r.accessSeconds = leadingAccessSeconds(a.plan)
    } else {
        r.recurrence = a.recurrence
        r.recurrenceUntil = a.recurrenceUntil ? a.recurrenceUntil.replace(/-/g, "") : undefined
        r.deeplink = planDeeplink(a.start, a.end, { ...a })
    }
    return r
}

/** "" -> "Once", "1111100" -> "Weekdays", "0000011" -> "Weekends", "1111111" -> "Every day", else "Mon, Wed". */
export function weekdayMaskLabel(mask: string): string {
    if (!mask.includes("1")) return "Once"
    if (mask === "1111100") return "Weekdays"
    if (mask === "0000011") return "Weekends"
    if (mask === "1111111") return "Every day"
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return labels.filter((_, i) => mask[i] === "1").join(", ")
}

/** "today", "tomorrow", or "Wed 1 Oct" (device calendar). */
export function relativeDay(date: Date, now: Date = new Date()): string {
    const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    if (same(date, now)) return "today"
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    if (same(date, tomorrow)) return "tomorrow"
    return date.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })
}

/** For an arrive-by search: the option that lets the rider leave latest. */
export function latestDeparture(plans: JourneyType[]): JourneyType | null {
    let best: JourneyType | null = null
    let bestMs = -Infinity
    for (const p of plans) {
        const ms = t(p.DepartureTime)?.getTime() ?? -Infinity
        if (ms > bestMs) {
            best = p
            bestMs = ms
        }
    }
    return best
}

/** Groups fully covered by `causes`. */
export function causeGroupsFor(causes: string[]): AlertCauseGroupKey[] {
    return ALERT_CAUSE_GROUP_INFO.filter((g) => g.causes.every((c) => causes.includes(c))).map((g) => g.key)
}

export function causesForGroups(groups: AlertCauseGroupKey[]): string[] {
    return ALERT_CAUSE_GROUP_INFO.filter((g) => groups.includes(g.key)).flatMap((g) => g.causes)
}

/** "2 alert types · warning+ · no cancellations". */
export function subscriptionDetail(causes: string[] | null | undefined, minSeverity: string, notifyCancellations: boolean, extra?: string): string {
    const parts: string[] = []
    if (extra) parts.push(extra)
    if (causes && causes.length) {
        const groups = causeGroupsFor(causes).length
        parts.push(groups > 0 ? `${groups} alert type${groups === 1 ? "" : "s"}` : "Custom alert types")
    } else {
        parts.push("All alert types")
    }
    if (minSeverity) parts.push(`${minSeverity.toLowerCase()}+`)
    if (!notifyCancellations) parts.push("no cancellations")
    return parts.join(" · ")
}

/** One reminder's summary line, as iOS `SubscriptionDetail.text(for:)`. */
export function reminderDetail(r: JourneyReminderDTO, now: Date = new Date()): string {
    const parts = [weekdayMaskLabel(r.recurrence)]
    if (r.alert_mode === "changes") parts.push("only if something changes")
    if (r.status === "pending_resolve") parts.push("finding your trip…")
    else if (r.status === "scheduled") {
        const target = r.target_unix && r.target_unix > 0 ? new Date(r.target_unix * 1000) : null
        parts.push(`next ${target ? relativeDay(target, now) : r.service_date}`)
    }
    const leave = r.next_leave_local || null
    if (leave) parts.push(`leave ~${leave}`)
    if (r.time_type === "arriveat") parts.push(`arrive by ${r.target_hhmm}`)
    else if (!leave) parts.push(`catch the ${r.target_hhmm}`)
    if (r.recurrence && r.recurrence_until) parts.push(`until ${r.recurrence_until}`)
    return parts.join(" · ")
}
