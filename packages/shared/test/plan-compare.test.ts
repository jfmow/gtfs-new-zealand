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
    const gym = { kind: "other" as const, label: "Gym", lat: -36.87, lon: 174.74 }
    const elsewhere = { lat: -36.8, lon: 174.8 }
    const base = { weekend: false, now: 1_800_000_000_000 }
    it("swaps between home and work by where you are, else by the time of day", () => {
        expect(likelyDestination({ ...base, places: [home, work], here: home, hour: 18 })?.label).toBe("Work")
        expect(likelyDestination({ ...base, places: [home, work], here: work, hour: 8 })?.label).toBe("Home")
        expect(likelyDestination({ ...base, places: [home, work], here: elsewhere, hour: 8 })?.label).toBe("Work")
        expect(likelyDestination({ ...base, places: [home, work], here: null, hour: 17 })?.label).toBe("Home")
    })
    it("picks another saved place you usually go to at this time", () => {
        const trip = (hour: number, weekend = false) => ({ lat: gym.lat, lon: gym.lon, hour, weekend, at: base.now - 86_400_000 })
        const trips = [trip(18), trip(17.5)]
        expect(likelyDestination({ ...base, places: [home, work, gym], here: work, hour: 18, trips })?.label).toBe("Gym")
        // Other times, other days, or once only: the Home/Work rule.
        expect(likelyDestination({ ...base, places: [home, work, gym], here: work, hour: 8, trips })?.label).toBe("Home")
        expect(likelyDestination({ ...base, weekend: true, places: [home, work, gym], here: work, hour: 18, trips })?.label).toBe("Home")
        expect(likelyDestination({ ...base, places: [home, work, gym], here: work, hour: 18, trips: [trip(18)] })?.label).toBe("Home")
        // Never where you already are.
        expect(likelyDestination({ ...base, places: [home, work, gym], here: gym, hour: 18, trips })?.label).not.toBe("Gym")
    })
    it("falls back to other saved places, then a recent place you aren't at", () => {
        const cafe = { kind: "other" as const, label: "Cafe", lat: -36.88, lon: 174.75 }
        expect(likelyDestination({ ...base, places: [home, gym], here: home, hour: 9 })?.label).toBe("Gym")
        expect(likelyDestination({ ...base, places: [home], here: home, hour: 9, recent: [cafe] })?.label).toBe("Cafe")
        expect(likelyDestination({ ...base, places: [], here: null, hour: 9 })).toBeNull()
    })
})
