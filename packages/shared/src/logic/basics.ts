/**
 * Small pure helpers ported 1:1 from iOS TransitCore/Logic: Formatting,
 * Geo, DepartureBoard, AlertStatus, JourneyPlanRanking, DepartureDetector,
 * WalkNavigationTracker and VehicleProgressRatchet.
 */
import type { Coordinate, Departure, DirectionStep, TransitAlert, Vehicle } from "../models"
import type { JourneyType } from "../types/journey"

// ---------------------------------------------------------------------------
// rounding

/**
 * Swift's `.rounded()`: halves away from zero (-2.5 -> -3). JS Math.round
 * rounds halves up (-2.5 -> -2), which put "running N min early" a minute
 * out from iOS and the Go server.
 */
export function roundHalfAway(x: number): number {
    return x < 0 ? -Math.round(-x) : Math.round(x)
}

// ---------------------------------------------------------------------------
// formatting (iOS TimeFormatting)

/** "HH:MM:SS" (can be >= 24:00:00) to "4:15pm" - the backend's own `3:04pm` push copy. */
export function clock12(hhmmss: string): string | null {
    const parts = hhmmss.split(":").map((p) => Number.parseInt(p, 10))
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
    const hour = parts[0] % 24
    const hour12 = hour % 12 === 0 ? 12 : hour % 12
    return `${hour12}:${String(parts[1]).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`
}

/** "Departed" / "Now" / "N min" / "H hr M min" / "N day(s)" from the backend's day-aware `time_till_arrival`. */
export function timeTillArrivalLabel(minutes: number): string {
    if (minutes < 0) return "Departed"
    if (minutes < 1) return "Now"
    const total = roundHalfAway(minutes)
    const perDay = 60 * 24
    if (total >= perDay) {
        const days = Math.floor(total / perDay)
        return days === 1 ? "1 day" : `${days} days`
    }
    if (total < 60) return `${total} min`
    const hours = Math.floor(total / 60)
    const mins = total % 60
    return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`
}

/** A Go duration in nanoseconds to "N min" or "Xh Ym". */
export function formatDuration(nanoseconds: number): string {
    const total = Math.max(0, Math.round(nanoseconds / 1e9 / 60))
    if (total < 60) return `${total} min`
    const hours = Math.floor(total / 60)
    const mins = total % 60
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}

/** Metres below 1 km, else "X.XX km". */
export function formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`
    return `${(meters / 1000).toFixed(2)} km`
}

function zoneParts(date: Date, tz: string) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            .formatToParts(date)
            .map((p) => [p.type, p.value]),
    )
    return parts as Record<string, string>
}

/** "YYYYMMDD" - the GTFS service date in `tz`. */
export function serviceDate(date: Date, tz: string): string {
    const p = zoneParts(date, tz)
    return `${p.year}${p.month}${p.day}`
}

/** "HH:mm" in `tz`. */
export function regionHHMM(date: Date, tz: string): string {
    const p = zoneParts(date, tz)
    return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`
}

// ---------------------------------------------------------------------------
// geo

/** Great-circle distance in metres. */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
    const R = 6_371_000
    const lat1 = (a.lat * Math.PI) / 180
    const lat2 = (b.lat * Math.PI) / 180
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLon = ((b.lon - a.lon) * Math.PI) / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// ---------------------------------------------------------------------------
// departure board

/**
 * Drops rows well past arrival, then sorts departed rows first, ascending
 * `time_till_arrival` within each group. A departed row lingers one minute;
 * cancelled/skipped ones 20 so riders see them.
 */
export function filterAndSortDepartures(departures: Departure[]): Departure[] {
    return departures
        .filter((d) => d.time_till_arrival >= (d.canceled || d.skipped ? -20 : d.departed ? -1 : -2))
        .sort((a, b) => (a.departed !== b.departed ? (a.departed ? -1 : 1) : a.time_till_arrival - b.time_till_arrival))
}

// ---------------------------------------------------------------------------
// alert status

export type AlertStatusKind = "active" | "soon" | "inactive"
export interface AlertStatus {
    kind: AlertStatusKind
    label: string
}

/**
 * From `pages/alerts.tsx` getAlertStatus. A non-positive end date counts as
 * "now + 24h", so an open-ended alert reads Active once started (kept as-is).
 */
export function alertStatus(alert: Pick<TransitAlert, "start_date" | "end_date">, now: Date = new Date()): AlertStatus {
    const nowS = now.getTime() / 1000
    const start = alert.start_date
    const end = alert.end_date > 0 ? alert.end_date : nowS + 86400
    if (start <= nowS && end >= nowS) return { kind: "active", label: "Active" }
    if (start > nowS) {
        const days = Math.round((start - nowS) / 86400)
        if (days === 0) return { kind: "soon", label: "Today" }
        if (days === 1) return { kind: "soon", label: "Tomorrow" }
        if (days <= 7) return { kind: "soon", label: `In ${days}d` }
        return { kind: "inactive", label: "Upcoming" }
    }
    return { kind: "inactive", label: "Ended" }
}

// ---------------------------------------------------------------------------
// plan ranking

const msOf = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0)
const walkKm = (plan: JourneyType) => plan.Legs.reduce((km, l) => (l.Mode === "walk" ? km + l.DistanceKm : km), 0)

/**
 * Drops plans another beats on every axis (later-or-equal departure,
 * earlier-or-equal arrival, no more changes or walking) with at least one
 * strict improvement. A full tie keeps the earlier-listed plan.
 */
export function pruneDominatedPlans(plans: JourneyType[]): JourneyType[] {
    if (plans.length < 2) return plans
    const m = plans.map((p) => ({ dep: msOf(p.DepartureTime), arr: msOf(p.ArrivalTime), transfers: p.Transfers, walk: walkKm(p) }))
    return plans.filter((_, i) => {
        for (let j = 0; j < m.length; j++) {
            if (j === i) continue
            const a = m[j]
            const b = m[i]
            const noWorse = a.dep >= b.dep && a.arr <= b.arr && a.transfers <= b.transfers && a.walk <= b.walk + 1e-6
            const strictlyBetter = a.arr < b.arr || a.transfers < b.transfers || a.dep > b.dep
            if (noWorse && strictlyBetter) return false
            if (noWorse && !strictlyBetter && j < i) return false
        }
        return true
    })
}

// ---------------------------------------------------------------------------
// departure detector

/**
 * Notices the rider setting off on a journey's first walk from GPS: seen at
 * the start then 150 m away, 150 m closer to the stop than when tracking
 * began, or at the stop. Once set it never clears (the server's `left_unix`
 * sticks too).
 */
export class DepartureDetector {
    static readonly moveMeters = 150
    static readonly atStartMeters = 100
    static readonly atStopMeters = 40
    static readonly maxAccuracyMeters = 100
    /** Back-dating to the last fix at the start only reaches this far (ms). */
    static readonly backdateLimitMs = 5 * 60_000

    setOffAt: Date | null
    private startDistanceToStop: number | null = null
    private lastAtStart: Date | null = null

    constructor(setOffAt: Date | null = null) {
        this.setOffAt = setOffAt
    }

    update(start: Coordinate, boardStop: Coordinate, location: Coordinate | null, accuracy: number | null, at: Date): Date | null {
        if (this.setOffAt) return this.setOffAt
        if (!location || (accuracy ?? 0) > DepartureDetector.maxAccuracyMeters) return null
        const fromStart = haversineMeters(location, start)
        const toStop = haversineMeters(location, boardStop)
        if (this.startDistanceToStop === null) this.startDistanceToStop = toStop
        if (fromStart <= DepartureDetector.atStartMeters) this.lastAtStart = at
        const leftStart = this.lastAtStart !== null && fromStart >= DepartureDetector.moveMeters
        const closer = this.startDistanceToStop - toStop >= DepartureDetector.moveMeters
        if (!leftStart && !closer && toStop > DepartureDetector.atStopMeters) return null
        this.setOffAt = this.lastAtStart && at.getTime() - this.lastAtStart.getTime() <= DepartureDetector.backdateLimitMs ? this.lastAtStart : at
        return this.setOffAt
    }
}

// ---------------------------------------------------------------------------
// walk navigation

export interface WalkNavigationSnapshot {
    currentStepIndex: number
    distanceToNextManeuver: number
    arrived: boolean
}

/** Advances through a walking leg's turn-by-turn steps (25 m arrival threshold). */
export class WalkNavigationTracker {
    static readonly arrivalThresholdMeters = 25
    private currentStepIndex = 0
    private arrived = false

    update(steps: DirectionStep[], location: Coordinate): WalkNavigationSnapshot {
        if (steps.length === 0 || this.arrived) return { currentStepIndex: this.currentStepIndex, distanceToNextManeuver: 0, arrived: this.arrived }
        for (let i = this.currentStepIndex; i < steps.length; i++) {
            const step = steps[i]
            if (step.lat === 0 && step.lon === 0) continue
            if (haversineMeters(location, step) < WalkNavigationTracker.arrivalThresholdMeters) {
                if (step.type === "arrive") {
                    this.arrived = true
                    this.currentStepIndex = i
                    return { currentStepIndex: i, distanceToNextManeuver: 0, arrived: true }
                }
                const next = Math.min(i + 1, steps.length - 1)
                if (next > this.currentStepIndex) this.currentStepIndex = next
                break
            }
        }
        const target = steps[this.currentStepIndex]
        const distance = target.lat !== 0 || target.lon !== 0 ? haversineMeters(location, target) : 0
        return { currentStepIndex: this.currentStepIndex, distanceToNextManeuver: distance, arrived: false }
    }

    reset() {
        this.currentStepIndex = 0
        this.arrived = false
    }
}

// ---------------------------------------------------------------------------
// vehicle progress ratchet

/**
 * Keeps a tracked vehicle from appearing to go backwards along its trip: a
 * lower next stop is only believed once it has lasted `holdMs` (AT's feed
 * jitters around stops).
 */
export class VehicleProgressRatchet {
    static readonly holdMs = 20_000
    private held = new Map<string, { vehicle: Vehicle; regressedSince: number | null }>()

    reset() {
        this.held.clear()
    }

    apply(vehicle: Vehicle, now: Date): Vehicle {
        const next = vehicle.trip?.next_stop?.sequence
        const previous = this.held.get(vehicle.trip_id)
        const heldNext = previous?.vehicle.trip?.next_stop?.sequence
        if (next === undefined || !previous || heldNext === undefined || next >= heldNext) {
            this.held.set(vehicle.trip_id, { vehicle, regressedSince: null })
            return vehicle
        }
        const since = previous.regressedSince ?? now.getTime()
        if (now.getTime() - since >= VehicleProgressRatchet.holdMs) {
            this.held.set(vehicle.trip_id, { vehicle, regressedSince: null })
            return vehicle
        }
        this.held.set(vehicle.trip_id, { vehicle: previous.vehicle, regressedSince: since })
        return { ...vehicle, trip: previous.vehicle.trip, state: previous.vehicle.state, cars: undefined }
    }
}
