import { describe, expect, it } from "vitest"
import { parseDeepLink, replacesTrackedJourney } from "../src/logic/deeplink"
import { buildLiveJourney } from "../src/logic/journey-live"
import { goTime, type StopTimeUpdate } from "../src/models"
import { at, BASE, makeLeg, makePlan, makeStop } from "./helpers"

/** Ported from iOS DeepLinkTests and JourneyLiveAdjusterTests. */

describe("deep links", () => {
    it("parses the custom scheme and universal links", () => {
        expect(parseDeepLink("transit://journey?id=abc-123&region=wel")).toEqual({ kind: "journey", id: "abc-123", region: "wel" })
        expect(parseDeepLink("transit://trip?tripId=257-870006&region=at")).toEqual({ kind: "trip", tripId: "257-870006", region: "at" })
        expect(parseDeepLink("transit://journey?id=abc-123")).toEqual({ kind: "journey", id: "abc-123", region: undefined })
        expect(parseDeepLink("https://example.com/journey?id=abc-123&region=at")).toEqual({ kind: "journey", id: "abc-123", region: "at" })
        expect(parseDeepLink("transit-expo://journey?id=x")).toEqual({ kind: "journey", id: "x", region: undefined })
        expect(parseDeepLink("transit://journey?region=at")).toBeNull()
    })
    it("parses the push payload paths the backend sends", () => {
        expect(parseDeepLink("/?s=Britomart 11814")).toEqual({ kind: "stop", query: "Britomart 11814" })
        expect(parseDeepLink("/vehicles?tripId=257-870006")).toEqual({ kind: "trip", tripId: "257-870006", region: undefined })
        expect(parseDeepLink("/map?mode=vehicles&tripId=257-870006")).toEqual({ kind: "trip", tripId: "257-870006", region: undefined })
        expect(parseDeepLink("/map?mode=stops&s=Newmarket Train Station 9218")).toEqual({ kind: "stop", query: "Newmarket Train Station 9218" })
        expect(parseDeepLink("/map?mode=stops")).toBeNull()
        expect(parseDeepLink("/alerts?s=Newmarket Train Station 9218")).toEqual({ kind: "stopAlerts", query: "Newmarket Train Station 9218" })
        expect(parseDeepLink("/alerts/route/STH-201")).toEqual({ kind: "routeAlerts", routeId: "STH-201" })
        expect(parseDeepLink("/journey?id=abc&region=wel")).toEqual({ kind: "journey", id: "abc", region: "wel" })
        expect(parseDeepLink("/journey?id=abc&region=at&track=1")).toEqual({ kind: "trackJourney", id: "abc", region: "at" })
        expect(parseDeepLink("transit://journey?id=abc&track=true")).toEqual({ kind: "trackJourney", id: "abc", region: undefined })
        expect(parseDeepLink("/notifications")).toEqual({ kind: "notifications" })
        expect(parseDeepLink("/settings")).toEqual({ kind: "notifications" })
        expect(parseDeepLink("transit://nonsense?id=abc")).toBeNull()
    })
    it("prefills the planner from a recurring reminder link", () => {
        const link = parseDeepLink("/plan?startLat=-36.84&startLon=174.76&startLabel=Home%20St&endLat=-36.87&endLon=174.77&endLabel=Uni&maxWalkKm=1&walkSpeed=4.8&maxTransfers=2&timeType=arriveat&onlyRoutes=STH-201,EAST-201")
        expect(link?.kind).toBe("plan")
        if (link?.kind !== "plan") return
        expect(link.prefill).toMatchObject({ startLabel: "Home St", endLabel: "Uni", maxTransfers: 2, walkSpeed: 4.8, timeType: "arriveat", onlyRoutes: ["STH-201", "EAST-201"] })
        expect(parseDeepLink("/plan?startLabel=Home")).toBeNull()
    })
    it("marks journey replacement links", () => {
        expect(parseDeepLink("/journey?id=abc&region=at&replace=1")).toEqual({ kind: "journey", id: "abc", region: "at" })
        expect(replacesTrackedJourney("/journey?id=abc&region=at&replace=1")).toBe(true)
        expect(replacesTrackedJourney("/journey?id=abc&region=at")).toBe(false)
        expect(replacesTrackedJourney("/journey?id=abc&region=at&track=1")).toBe(false)
        expect(replacesTrackedJourney("/vehicles?tripId=t1&replace=1")).toBe(false)
    })
})

const stop = (id: string) => makeStop(id, 0, 0, { parent_station: "" })
const st = (child: string, parent: string, arrival: number, departure: number, scheduled: number): StopTimeUpdate => ({
    parent_stop_id: parent, child_stop_id: child, arrival_time: arrival, departure_time: departure, scheduled_time: scheduled, skipped: false, passed: false, dist: 0,
})
const ms = (d: Date) => d.getTime()
const time = (d: unknown) => goTime(d as Date)?.getTime()

describe("buildLiveJourney", () => {
    it("returns the plan unchanged with no stop times", () => {
        const plan = makePlan([makeLeg({ mode: "transit", tripId: "t1", from: stop("A"), to: stop("B"), departure: BASE, arrival: at(600), durationSeconds: 600 })])
        expect(time(buildLiveJourney(plan, {}).DepartureTime)).toBe(ms(BASE))
    })
    it("shifts a transit leg and works out its delay", () => {
        const plan = makePlan([makeLeg({ mode: "transit", tripId: "t1", from: stop("A"), to: stop("B"), departure: BASE, arrival: at(600), durationSeconds: 600 })])
        const sd = ms(BASE), sa = sd + 600_000
        const r = buildLiveJourney(plan, { t1: [st("A", "PA", sd + 90_000, sd + 90_000, sd), st("B", "PB", sa + 90_000, sa + 90_000, sa)] })
        expect(time(r.Legs[0].DepartureTime)).toBe(sd + 90_000)
        expect(time(r.Legs[0].ArrivalTime)).toBe(sa + 90_000)
        expect(r.Legs[0].delay_seconds).toBe(90)
        expect(r.Legs[0].realtime_status).toBe("delayed")
        expect(time(r.DepartureTime)).toBe(time(r.Legs[0].DepartureTime))
    })
    it("applies the on-time and early thresholds", () => {
        const sched = 1_700_000_600_000
        const run = (delay: number) => {
            const plan = makePlan([makeLeg({ mode: "transit", tripId: "t1", from: stop("A"), to: stop("B"), departure: BASE, arrival: at(600), durationSeconds: 600 })])
            const arr = sched + delay * 1000
            return buildLiveJourney(plan, { t1: [st("A", "PA", 1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_000), st("B", "PB", arr, arr, sched)] }).Legs[0].realtime_status
        }
        expect(run(0)).toBe("on_time")
        expect(run(30)).toBe("on_time")
        expect(run(61)).toBe("delayed")
        expect(run(-61)).toBe("early")
    })
    it("re-anchors the leading walk, keeping its planned slack", () => {
        const plan = makePlan([
            makeLeg({ mode: "walk", departure: at(-120), arrival: at(180), durationSeconds: 300 }),
            makeLeg({ mode: "transit", tripId: "t1", from: stop("A"), to: stop("B"), departure: at(300), arrival: at(900), durationSeconds: 600 }),
        ])
        const sd = ms(at(300)), ld = sd + 90_000
        const r = buildLiveJourney(plan, { t1: [st("A", "PA", ld, ld, sd), st("B", "PB", ld + 600_000, ld + 600_000, sd + 600_000)] })
        expect(time(r.Legs[0].ArrivalTime)).toBe(time(r.Legs[1].DepartureTime)! - 120_000)
        expect(time(r.Legs[0].DepartureTime)).toBe(time(r.Legs[0].ArrivalTime)! - 300_000)
    })
    it("starts a transfer walk when the previous ride arrives", () => {
        const plan = makePlan([
            makeLeg({ mode: "transit", tripId: "t1", from: stop("A"), to: stop("B"), departure: BASE, arrival: at(660), durationSeconds: 660 }),
            makeLeg({ mode: "walk", from: stop("B"), to: stop("C"), departure: at(660), arrival: at(780), durationSeconds: 120 }),
            makeLeg({ mode: "transit", tripId: "t2", from: stop("C"), to: stop("D"), departure: at(1020), arrival: at(2040), durationSeconds: 1020 }),
        ])
        const b = ms(BASE)
        const r = buildLiveJourney(plan, {
            t1: [st("A", "PA", b, b, b), st("B", "PB", b + 660_000, b + 660_000, b + 660_000)],
            t2: [st("C", "PC", b + 1_020_000, b + 1_020_000, b + 1_020_000), st("D", "PD", b + 2_040_000, b + 2_040_000, b + 2_040_000)],
        })
        expect(time(r.Legs[1].DepartureTime)).toBe(ms(at(660)))
        expect(time(r.Legs[1].ArrivalTime)).toBe(ms(at(780)))
    })
    it("anchors the first walk once the rider has set off", () => {
        const board = stop("A")
        const plan = makePlan([
            makeLeg({ mode: "walk", to: board, departure: BASE, arrival: at(300), durationSeconds: 300 }),
            makeLeg({ mode: "transit", tripId: "t1", from: board, to: stop("B"), departure: at(480), arrival: at(1080), durationSeconds: 600 }),
        ])
        const s = ms(at(480))
        const early = [st("A", "PA", s - 240_000, s - 240_000, s), st("B", "PB", s + 360_000, s + 360_000, s + 600_000)]
        expect(time(buildLiveJourney(plan, { t1: early }).Legs[0].DepartureTime)).toBe(ms(at(-240)))
        const left = at(-60)
        const onTheWay = buildLiveJourney(plan, { t1: early }, left)
        expect(time(onTheWay.Legs[0].DepartureTime)).toBe(ms(left))
        expect(time(onTheWay.Legs[0].ArrivalTime)).toBe(ms(at(300, left)))
        expect(time(onTheWay.DepartureTime)).toBe(ms(left))
        expect(time(onTheWay.Legs[1].DepartureTime)).toBe(ms(at(240)))
        expect(time(buildLiveJourney(plan, {}, left).Legs[0].DepartureTime)).toBe(ms(left))
    })
})
