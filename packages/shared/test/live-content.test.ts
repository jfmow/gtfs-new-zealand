import { describe, expect, it } from "vitest"
import { buildLiveActivityContent, type LiveActivityProgress } from "../src/logic/live-content"
import type { Leg, Route } from "../src/types/journey"
import { makeLeg, makeStop } from "./helpers"

/**
 * Ported from iOS LiveActivityContentBuilderTests, which mirror
 * backend/providers/notifications/live_activity_test.go - same plan, same
 * wording - so the phone and the server never disagree on the Lock Screen.
 */

const TZ = "Pacific/Auckland"
/** 9:00am 1 Jan 2026 in Auckland (NZDT). */
const BASE = new Date("2025-12-31T20:00:00Z")
const at = (s: number) => new Date(BASE.getTime() + s * 1000)
const unix = (s: number) => at(s).getTime() / 1000

const stop = (id: string, name: string, platform = "") => makeStop(id, 0, 0, { parent_station: "", stop_name: name, platform_number: platform, stop_type: "bus" })
const route = (name: string, color: string): Route => ({ route_id: name, agency_id: "", route_short_name: name, route_long_name: "", route_type: 3, route_color: color, vehicle_type: "Bus" })

function leg(mode: string, o: { route?: Route; from?: ReturnType<typeof stop>; to: ReturnType<typeof stop>; dep: number; arr: number; delay?: number; usable?: boolean }): Leg {
    return makeLeg({
        mode, tripId: o.route ? `trip-${o.route.route_short_name}` : "", from: o.from, to: o.to, departure: at(o.dep), arrival: at(o.arr), durationSeconds: o.arr - o.dep,
        extra: { Route: o.route ?? null, RouteID: o.route?.route_id ?? "", delay_seconds: o.delay, trip_usable: o.usable ?? true },
    })
}

/** Walk 5 min to Britomart, the 70 9:08-9:25, walk 5 min. */
function testLegs(delay?: number): Leg[] {
    const s = delay ?? 0
    return [
        leg("walk", { to: stop("walk-end", "Britomart"), dep: s, arr: 300 + s }),
        leg("transit", { route: route("70", "0073bd"), from: stop("board", "Britomart", "3"), to: stop("alight", "Newmarket"), dep: 480 + s, arr: 1500 + s, delay }),
        leg("walk", { to: stop("dest", "Destination"), dep: 1500 + s, arr: 1800 + s }),
    ]
}

const progress = (legIndex: number, phase: string | null, stopsAway?: number): LiveActivityProgress => ({ legIndex, phase, arrived: false, stopsAway })
const build = (legs: Leg[], p: LiveActivityProgress, nowSeconds: number) => buildLiveActivityContent(legs, p, TZ, at(nowSeconds))

describe("Live Activity content", () => {
    it("counts down to leave-by before leaving", () => {
        const c = build(testLegs(), progress(0, "walking"), -600)
        expect(c.primaryText).toBe("Leave by 9:00am")
        expect(c.countdownLabel).toBe("Leave in")
        expect(c.targetUnix).toBe(unix(0))
        expect(c.routeShortName).toBe("70")
        expect(c.urgent).toBeUndefined()
    })
    it("moves leave-by for a late ride and says why", () => {
        const c = build(testLegs(150), progress(0, "walking"), -600)
        expect(c.primaryText).toBe("Leave by 9:02am")
        expect(c.targetUnix).toBe(unix(120))
        expect(c.secondaryText).toBe("Walk to Britomart for the 70 · running 3 min late")
    })
    it("says get ready in the last five minutes", () => {
        const c = build(testLegs(), progress(0, "walking"), -240)
        expect(c.primaryText).toBe("Get ready to leave")
        expect(c.secondaryText).toBe("Leave by 9:00am · walk to Britomart for the 70")
        expect(c.urgent).toBe(true)
    })
    it("counts down to departure after leave-by", () => {
        const c = build(testLegs(), progress(0, "walking"), 10)
        expect(c.primaryText).toBe("Leave now")
        expect(c.secondaryText).toBe("Walk to Britomart · 70 departs 9:08am · Platform 3")
        expect(c.countdownLabel).toBe("Departs in")
        expect(c.targetUnix).toBe(unix(480))
        expect(c.urgent).toBe(true)
        const later = build(testLegs(), progress(0, "walking"), 200)
        expect(later.primaryText).toBe("Walk to Britomart")
        expect(later.secondaryText).toBe("70 departs 9:08am · Platform 3")
        expect(later.urgent).toBeUndefined()
    })
    it("counts down to departure while waiting", () => {
        const c = build(testLegs(), progress(1, "waiting"), 360)
        expect(c.phase).toBe("waiting")
        expect(c.primaryText).toBe("Board the 70")
        expect(c.targetUnix).toBe(unix(480))
        expect(c.platform).toBe("3")
    })
    it("reports a delay", () => {
        const c = build(testLegs(300), progress(1, "waiting"), 360)
        expect(c.status).toBe("delayed")
        expect(c.delayMinutes).toBe(5)
        expect(c.targetUnix).toBe(unix(780))
    })
    it("shows stops away while approaching", () => {
        const c = build(testLegs(), progress(1, "waiting", 2), 360)
        expect(c.stopsAway).toBe(2)
        expect(c.secondaryText).toBe("at Britomart · Platform 3 · 2 stops away")
    })
    it("says get off at the next stop", () => {
        const c = build(testLegs(), progress(1, "onboard", 0), 1200)
        expect(c.primaryText).toBe("Get off at the next stop")
        expect(c.secondaryText).toBe("Newmarket")
        expect(c.countdownLabel).toBe("Arrives in")
    })
    it("fills the v3 ride fields", () => {
        const c = build(testLegs(), { legIndex: 1, phase: "onboard", arrived: false, stopsAway: 3, nextStopName: "Grafton", isRealtime: true, hasVehicle: true, rideStops: 9, occupancy: 1 }, 900)
        expect(c).toMatchObject({ version: 3, boardStopName: "Britomart", alightStopName: "Newmarket", nextStopName: "Grafton", rideStops: 9, hasVehicle: true, occupancy: 1 })
    })
    it("shows the walk and the approaching vehicle", () => {
        const c = build(testLegs(), { legIndex: 0, phase: "walking", arrived: false, stopsAway: 5, isRealtime: true, hasVehicle: true }, 60)
        expect(c).toMatchObject({ phase: "walking", walkMinutes: 5, stopsAway: 5, boardStopName: "Britomart" })
    })
    it("says arrived", () => {
        const c = build(testLegs(), { legIndex: 3, phase: null, arrived: true }, 1900)
        expect(c).toMatchObject({ status: "arrived", primaryText: "You've arrived", progressFraction: 1 })
    })
    it("flags a missed connection", () => {
        const legs = [
            leg("transit", { route: route("A", "111111"), from: stop("s1", "One"), to: stop("s2", "Two"), dep: 240, arr: 840, delay: 240 }),
            leg("walk", { to: stop("s3", "Three"), dep: 840, arr: 960 }),
            leg("transit", { route: route("B", "222222"), from: stop("s3", "Three"), to: stop("s4", "Four"), dep: 840, arr: 1800 }),
        ]
        const c = build(legs, progress(0, "onboard"), 480)
        expect(c.status).toBe("missedConnection")
        expect(c.nextLeg?.routeShortName).toBe("B")
        expect(c.nextLeg?.connectMinutes).toBe(-2)
    })
    it("flags a cancelled or skipped connecting ride", () => {
        const legs = [
            leg("transit", { route: route("A", "111111"), from: stop("s1", "One"), to: stop("s2", "Two"), dep: 0, arr: 600 }),
            leg("walk", { to: stop("s3", "Three"), dep: 600, arr: 720 }),
            leg("transit", { route: route("B", "222222"), from: stop("s3", "Three"), to: stop("s4", "Four"), dep: 840, arr: 1800 }),
        ]
        legs[2].realtime_status = "canceled" as never
        let c = build(legs, progress(0, "onboard"), 300)
        expect(c.status).toBe("missedConnection")
        expect(c.secondaryText.startsWith("The B at ")).toBe(true)
        expect(c.secondaryText.endsWith("has been cancelled")).toBe(true)
        legs[2].realtime_status = "skipped" as never
        c = build(legs, progress(0, "onboard"), 300)
        expect(c.secondaryText.endsWith("won't stop at Three")).toBe(true)
    })
    it("marks an unusable ride cancelled", () => {
        const legs = testLegs()
        legs[1] = leg("transit", { route: route("70", "0073bd"), from: stop("board", "Britomart"), to: stop("alight", "Newmarket"), dep: 480, arr: 1500, usable: false })
        expect(build(legs, progress(1, "waiting"), 360).status).toBe("cancelled")
    })
    it("has every key the widget and server contract need", () => {
        const c = build(testLegs(), progress(1, "waiting"), 360) as unknown as Record<string, unknown>
        for (const key of ["version", "legIndex", "phase", "primaryText", "secondaryText", "countdownLabel", "targetUnix", "arrivalUnix", "status", "legChain", "updatedUnix"]) {
            expect(c[key], key).not.toBeUndefined()
        }
        expect((c.legChain as unknown[]).length).toBe(3)
    })

    // setting off (left_journey_test.go)
    const legsLeftAt = (left: number, delay?: number) => {
        const legs = testLegs(delay)
        legs[0] = { ...legs[0], DepartureTime: at(left), ArrivalTime: at(left + 300) }
        return legs
    }
    it("shows spare time, not a leave time, once on the way", () => {
        const c = build(legsLeftAt(-120), { legIndex: 0, phase: "walking", arrived: false, setOffAt: at(-120) }, 60)
        expect(c.primaryText).toBe("Walk to Britomart")
        expect(c.secondaryText).toBe("70 departs 9:08am · Platform 3 · 5 min spare")
        expect(c.urgent).toBeUndefined()
        expect(c.segmentStartUnix).toBe(unix(-120))
    })
    it("warns when the ride is running early on the way", () => {
        const c = build(legsLeftAt(0, -360), { legIndex: 0, phase: "walking", arrived: false, setOffAt: at(0) }, 60)
        expect(c.status).toBe("missedConnection")
        expect(c.secondaryText).toBe("You'll likely miss the 70 at 9:02am")
        expect(c.primaryText.includes("Leave")).toBe(false)
    })
    it("keeps leave now while still at the start and catchable", () => {
        expect(build(testLegs(), { legIndex: 0, phase: "walking", arrived: false, stillAtStart: true }, 180).primaryText).toBe("Leave now")
        expect(build(testLegs(), progress(0, "walking"), 190).primaryText).toBe("Walk to Britomart")
    })
    it("says too late when still at the start and the ride has gone early", () => {
        const c = build(testLegs(-300), { legIndex: 0, phase: "walking", arrived: false, stillAtStart: true }, -30)
        expect(c.primaryText).toBe("Too late for the 70")
        expect(c.secondaryText).toBe("It departs 9:03am · running 5 min early · 5 min walk away")
        expect(c.status).toBe("missedConnection")
        expect(c.urgent).toBeUndefined()
    })
})
