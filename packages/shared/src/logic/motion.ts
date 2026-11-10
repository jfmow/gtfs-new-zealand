/**
 * Smooth vehicle movement along its route - a port of iOS `VehicleMotion.swift`.
 */
import type { Coordinate } from "../models"
import { haversineMeters } from "./basics"

/** A route shape measured out in metres. */
export class RouteLine {
    readonly points: Coordinate[]
    /** Metres from the start to each point. */
    readonly cumulative: number[]

    private constructor(points: Coordinate[], cumulative: number[]) {
        this.points = points
        this.cumulative = cumulative
    }

    static from(coordinates: Coordinate[]): RouteLine | null {
        if (coordinates.length < 2) return null
        const cumulative = [0]
        let total = 0
        for (let i = 1; i < coordinates.length; i++) {
            total += haversineMeters(coordinates[i - 1], coordinates[i])
            cumulative.push(total)
        }
        return total > 0 ? new RouteLine(coordinates, cumulative) : null
    }

    get length(): number {
        return this.cumulative[this.cumulative.length - 1] ?? 0
    }

    /**
     * Nearest point on the line: how far along, and how far off. With `hint`,
     * a match that would mean going backwards from there is penalised (a
     * route that passes the same road twice).
     */
    project(c: Coordinate, hint?: number | null): { along: number; offset: number } {
        const mLat = 111_320
        const mLon = 111_320 * Math.cos((c.lat * Math.PI) / 180)
        const local = (p: Coordinate) => ({ x: (p.lon - c.lon) * mLon, y: (p.lat - c.lat) * mLat })
        let best = { along: 0, offset: Infinity, score: Infinity }
        let a = local(this.points[0])
        for (let i = 1; i < this.points.length; i++) {
            const b = local(this.points[i])
            const dx = b.x - a.x, dy = b.y - a.y
            const len2 = dx * dx + dy * dy
            const tt = len2 > 0 ? Math.min(Math.max(-(a.x * dx + a.y * dy) / len2, 0), 1) : 0
            const px = a.x + dx * tt, py = a.y + dy * tt
            const offset = Math.sqrt(px * px + py * py)
            const along = this.cumulative[i - 1] + (this.cumulative[i] - this.cumulative[i - 1]) * tt
            let score = offset
            if (hint !== undefined && hint !== null) score += Math.max(0, hint - along - 30) * 0.5 + Math.max(0, along - hint - 3000) * 0.05
            if (score < best.score) best = { along, offset, score }
            a = b
        }
        return { along: best.along, offset: best.offset }
    }

    coordinateAt(distance: number): Coordinate {
        const d = Math.min(Math.max(distance, 0), this.length)
        let low = 0, high = this.cumulative.length - 1
        while (high - low > 1) {
            const mid = (low + high) >> 1
            if (this.cumulative[mid] <= d) low = mid
            else high = mid
        }
        const span = this.cumulative[high] - this.cumulative[low]
        const tt = span > 0 ? (d - this.cumulative[low]) / span : 0
        const a = this.points[low], b = this.points[high]
        return { lat: a.lat + (b.lat - a.lat) * tt, lon: a.lon + (b.lon - a.lon) * tt }
    }

    /** Compass bearing at `distance`, across a stretch so a kink doesn't snap the marker round. */
    bearingAt(distance: number): number {
        const a = this.coordinateAt(distance - 10)
        const b = this.coordinateAt(distance + 30)
        const lat1 = (a.lat * Math.PI) / 180, lat2 = (b.lat * Math.PI) / 180
        const dLon = ((b.lon - a.lon) * Math.PI) / 180
        const y = Math.sin(dLon) * Math.cos(lat2)
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
        return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    }
}

/**
 * Moves the vehicle the rider is on along its route from their own GPS
 * (far better than the 10-30 s feed). Carries on at GPS speed only briefly,
 * never past the next stop, never visibly backwards. Without fresh GPS it
 * shows the feed's position as is; off the shape (a detour) it shows raw.
 */
export class VehicleMotion {
    static readonly riderExtrapolationMs = 5_000
    static readonly offRouteMetres = 60
    static readonly riderFreshMs = 8_000

    readonly line: RouteLine
    readonly stopDistances: number[]
    /** m/s - anything faster is a bad fix. */
    readonly maxSpeed: number
    speed = 0

    private anchor: { along: number; time: number } | null = null
    private displayed: number | null = null
    private lastStep: number | null = null
    private feedAlong: number | null = null
    private riderAt: number | null = null
    private offRoute: Coordinate | null = null

    constructor(line: RouteLine, stops: Coordinate[], vehicleType: string) {
        this.line = line
        const distances: number[] = []
        let hint: number | null = null
        for (const stop of stops) {
            const along: number = line.project(stop, hint).along
            distances.push(along)
            hint = along
        }
        this.stopDistances = distances
        const type = vehicleType.toLowerCase()
        this.maxSpeed = type === "train" ? 40 : type === "ferry" ? 20 : 28
    }

    feed(c: Coordinate, now: Date) {
        const p = this.line.project(c, this.feedAlong ?? this.displayed)
        if (p.offset > VehicleMotion.offRouteMetres) {
            this.offRoute = c
            this.feedAlong = null
            this.anchor = null
            return
        }
        this.offRoute = null
        this.feedAlong = p.along
        if (this.riderIsFresh(now.getTime())) return
        this.speed = 0
        this.anchor = { along: p.along, time: now.getTime() }
    }

    rider(c: Coordinate, gpsSpeed: number | null, at: Date) {
        const p = this.line.project(c, this.displayed ?? this.feedAlong)
        if (p.offset > 40) return
        this.riderAt = at.getTime()
        this.offRoute = null
        this.anchor = { along: p.along, time: at.getTime() }
        this.speed = gpsSpeed !== null ? Math.min(Math.max(gpsSpeed, 0), this.maxSpeed) : 0
    }

    step(now: Date): { coordinate: Coordinate; bearing: number } | null {
        if (this.offRoute) {
            this.displayed = null
            return { coordinate: this.offRoute, bearing: 0 }
        }
        if (!this.anchor) return null
        const nowMs = now.getTime()
        const anchor = { ...this.anchor }
        const fresh = this.riderIsFresh(nowMs)
        if (!fresh && this.feedAlong !== null) {
            anchor.along = this.feedAlong
            this.speed = 0
        }
        const elapsed = Math.min(Math.max((nowMs - anchor.time) / 1000, 0), VehicleMotion.riderExtrapolationMs / 1000)
        const nextStop = this.stopDistances.find((d) => d > anchor.along) ?? this.line.length
        const cap = Math.min(nextStop, this.line.length)
        const target = Math.min(anchor.along + (fresh ? this.speed * elapsed : 0), Math.max(cap, anchor.along))
        const dt = Math.min(Math.max((nowMs - (this.lastStep ?? nowMs)) / 1000, 0), 2)
        this.lastStep = nowMs
        const current = this.displayed
        if (fresh && current !== null && target - current > -120 && target - current < 400) {
            const carried = this.speed * dt
            const move = Math.max(0, carried + (target - current - carried) * Math.min(1, 0.6 * dt))
            this.displayed = Math.max(current, Math.min(current + move, target))
        } else {
            this.displayed = target
        }
        const along: number = this.displayed
        return { coordinate: this.line.coordinateAt(along), bearing: this.line.bearingAt(along) }
    }

    private riderIsFresh(nowMs: number): boolean {
        return this.riderAt !== null && nowMs - this.riderAt < VehicleMotion.riderFreshMs
    }
}
