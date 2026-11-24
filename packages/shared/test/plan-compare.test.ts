import { describe, expect, it } from "vitest"
import { leaveLaterMinutes, planAxis, planChange, planSignature, stripSegments, tightChanges } from "../src/logic/plan-compare"
import { likelyDestination } from "../src/logic/go"
import { at, makeLeg, makePlan } from "./helpers"

const walk = (from: number, to: number) => makeLeg({ mode: "walk", departure: at(from), arrival: at(to), durationSeconds: to - from })
const ride = (trip: string, from: number, to: number) => makeLeg({ mode: "transit", tripId: trip, departure: at(from), arrival: at(to), durationSeconds: to - from })

describe("planAxis", () => {
    it("spans earliest departure to latest arrival with round ticks", () => {
        const a = makePlan([walk(0, 300), ride("a", 300, 1800)])
        const b = makePlan([ride("b", 600, 3600)])
        const axis = planAxis([a, b])!
        expect(axis.start).toBe(at(0).getTime())
        expect(axis.end).toBe(at(3600).getTime())
        expect(axis.ticks.length).toBeGreaterThan(1)
        expect(axis.ticks.length).toBeLessThanOrEqual(5)
        for (const t of axis.ticks) expect(t % (5 * 60_000)).toBe(0)
    })
    it("is null with nothing to show", () => {
        expect(planAxis([])).toBeNull()
    })
})

describe("stripSegments", () => {
    it("places legs on the axis, leaving the wait as a gap", () => {
        const p = makePlan([walk(0, 300), ride("a", 600, 1200), ride("b", 1500, 2400)])
        const axis = planAxis([p])!
        const segs = stripSegments(p, axis)
        expect(segs.map((s) => s.kind)).toEqual(["walk", "ride", "ride"])
        expect(segs[0].left).toBe(0)
        expect(segs[1].left).toBeCloseTo(600 / 2400)
        expect(segs[2].left - (segs[1].left + segs[1].width)).toBeCloseTo(300 / 2400)
    })
})

describe("planChange", () => {
    it("reports how far the same rides moved", () => {
        const before = makePlan([ride("a", 0, 1200)])
        const after = makePlan([ride("a", 0, 1380)], { ID: "new" })
        expect(planSignature(before)).toBe(planSignature(after))
        expect(planChange(before, after)).toEqual({ arrivalDeltaMin: 3 })
        expect(planChange(before, makePlan([ride("other", 0, 1380)]))).toBeNull()
    })
})

describe("tightChanges", () => {
    it("flags a change with under a minute to spare after the walk", () => {
        const p = makePlan([ride("a", 0, 600), walk(600, 690), ride("b", 720, 1200)])
        expect(tightChanges(p)).toEqual([2])
        const easy = makePlan([ride("a", 0, 600), walk(600, 690), ride("b", 900, 1200)])
        expect(tightChanges(easy)).toEqual([])
    })
})

describe("leaveLaterMinutes", () => {
    it("is the extra time at home", () => {
        const later = makePlan([ride("a2", 900, 2400)])
        const p = makePlan([ride("a", 0, 2400)], { LeaveLater: later })
        expect(leaveLaterMinutes(p)).toBe(15)
        expect(leaveLaterMinutes(later)).toBe(0)
    })
})

describe("likelyDestination", () => {
    const home = { kind: "home" as const, label: "Home", lat: -36.9, lon: 174.7 }
    const work = { kind: "work" as const, label: "Work", lat: -36.85, lon: 174.76 }
    it("swaps between home and work by where you are, else by the time of day", () => {
        expect(likelyDestination([home, work], { lat: home.lat, lon: home.lon }, 18)?.label).toBe("Work")
        expect(likelyDestination([home, work], { lat: work.lat, lon: work.lon }, 8)?.label).toBe("Home")
        expect(likelyDestination([home, work], { lat: -36.8, lon: 174.8 }, 8)?.label).toBe("Work")
        expect(likelyDestination([home, work], null, 17)?.label).toBe("Home")
    })
    it("falls back to a recent place you aren't at", () => {
        const cafe = { kind: "other" as const, label: "Cafe", lat: -36.88, lon: 174.75 }
        expect(likelyDestination([home], { lat: home.lat, lon: home.lon }, 9, [cafe])?.label).toBe("Cafe")
        expect(likelyDestination([], null, 9)).toBeNull()
    })
})
