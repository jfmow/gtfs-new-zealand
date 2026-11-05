import { describe, expect, it } from "vitest"
import { JourneyProgressModel, type JourneyProgressInput } from "../src/logic/tracking"
import type { JourneyType } from "../src/types/journey"
import type { Coordinate, Vehicle } from "../src/models"
import { at, BASE, makeLeg, makePlan, makeStop, makeVehicle, ref, threeLegJourney } from "./helpers"

/** Ported from iOS JourneyProgressModelTests - including the 2026-09-16 leg-advance bug. */

function update(model: JourneyProgressModel, plan: JourneyType, now: Date, extra: Partial<JourneyProgressInput> = {}) {
    return model.update({ plan, displayPlan: plan, now, vehiclesByTripId: {}, stopTimesByTripId: {}, journeyStarted: true, trackedStops: [], userLocation: null, ...extra })
}

const board = makeStop("board")
const alight = makeStop("alight")
const dep = at(300)
const arr = at(600, dep)
const trackedStops = [
    ref(3, { parent_stop_id: board.parent_station, name: "board", child_stop_id: "board-child" }),
    ref(5, { parent_stop_id: alight.parent_station, name: "alight", child_stop_id: "alight-child" }),
]

describe("JourneyProgressModel", () => {
    it("doesn't advance a delayed train to the walking leg before alighting", () => {
        const plan = threeLegJourney(board, alight, dep, arr)
        const s = update(new JourneyProgressModel(), plan, at(120, arr), { vehiclesByTripId: { T1: makeVehicle({ tripId: "T1", current: 3, next: 4, state: "Travelling" }) } })
        expect(s.currentLegIndex).toBe(2)
        expect(s.transitFloor).toBe(1)
        expect(s.guardedLegIndex).toBe(1)
        expect(s.progressLegIndex).toBe(1)
        expect(s.journeyArrived).toBe(false)
    })

    it("advances the transit floor once alighting is confirmed (one tick later)", () => {
        const plan = threeLegJourney(board, alight, dep, arr)
        const model = new JourneyProgressModel()
        const vehicles = { T1: makeVehicle({ tripId: "T1", current: 6, next: 7, state: "Travelling" }) }
        update(model, plan, at(60, arr), { vehiclesByTripId: vehicles, trackedStops })
        expect(model.alightedThroughLeg).toBe(1)
        const settled = update(model, plan, at(60, arr), { vehiclesByTripId: vehicles, trackedStops })
        expect(settled.transitFloor).toBe(plan.Legs.length)
        expect(settled.progressLegIndex).toBe(2)
    })

    it("counts walking away from a vehicle stuck AtStop at the alight stop as alighted", () => {
        const plan = threeLegJourney(board, alight, dep, arr)
        const tick = (vehicle: Vehicle, user: Coordinate) => {
            const m = new JourneyProgressModel()
            update(m, plan, at(30, arr), { vehiclesByTripId: { T1: vehicle }, trackedStops, userLocation: user })
            return m.alightedThroughLeg
        }
        const atStop = makeVehicle({ tripId: "T1", current: 5, next: 6, state: "AtStop" })
        expect(tick(atStop, { lat: 0.00005, lon: 0 })).toBe(-1)
        expect(tick(atStop, { lat: 0.00015, lon: 0 })).toBe(1)
        expect(tick(makeVehicle({ tripId: "T1", current: 5, next: 6, state: "Arriving" }), { lat: 0.0015, lon: 0 })).toBe(-1)
        expect(tick(makeVehicle({ tripId: "T1", current: 4, next: 5, state: "Travelling" }), { lat: 0.0015, lon: 0 })).toBe(-1)
    })

    it("never moves the alighted ratchet backwards", () => {
        const plan = threeLegJourney(board, alight, dep, arr)
        const model = new JourneyProgressModel()
        update(model, plan, at(60, arr), { vehiclesByTripId: { T1: makeVehicle({ tripId: "T1", current: 6, next: 7, state: "Travelling" }) }, trackedStops })
        expect(model.alightedThroughLeg).toBe(1)
        const s2 = update(model, plan, at(120, arr))
        expect(model.alightedThroughLeg).toBe(1)
        expect(s2.transitFloor).toBe(plan.Legs.length)
    })

    it("keeps restored progress with no live data", () => {
        const plan = threeLegJourney(board, alight, dep, arr)
        const model = new JourneyProgressModel()
        model.restore(1)
        model.restore(0)
        expect(model.alightedThroughLeg).toBe(1)
        expect(update(model, plan, at(-120, arr)).progressLegIndex).toBe(2)
    })

    it("counts stops to go including the target, zero only when stopped there", () => {
        const d = at(600)
        const plan = threeLegJourney(board, alight, d, at(900, d))
        const stops = [ref(5, { parent_stop_id: board.parent_station, child_stop_id: "board-child" }), ref(9, { parent_stop_id: alight.parent_station, child_stop_id: "alight-child" })]
        const snap = (v: Vehicle) => update(new JourneyProgressModel(), plan, at(-120, d), { vehiclesByTripId: { T1: v }, trackedStops: stops })
        const far = snap(makeVehicle({ tripId: "T1", current: 2, next: 3, state: "Travelling" }))
        expect(far.trackedStopsToGo).toBe(3)
        expect(far.trackedStopsAway).toBe(2)
        expect(snap(makeVehicle({ tripId: "T1", current: 4, next: 5, state: "Travelling" })).trackedStopsToGo).toBe(1)
        expect(snap(makeVehicle({ tripId: "T1", current: 4, next: 5, state: "AtStop" })).trackedStopsToGo).toBe(1)
        expect(snap(makeVehicle({ tripId: "T1", current: 5, next: 6, state: "AtStop" })).trackedStopsToGo).toBe(0)
    })

    it("is walking before reaching the board stop", () => {
        const plan = makePlan([makeLeg({ mode: "walk", to: board, departure: BASE, arrival: at(300), durationSeconds: 300 })])
        expect(update(new JourneyProgressModel(), plan, at(60)).phase).toBe("walking")
    })

    it("is waiting at the board stop before the vehicle departs (after the hysteresis tick)", () => {
        const b = makeStop("board", -36.85, 174.76)
        const plan = makePlan([
            makeLeg({ mode: "walk", to: b, departure: BASE, arrival: at(300), durationSeconds: 300 }),
            makeLeg({ mode: "transit", tripId: "T1", from: b, to: makeStop("alight"), departure: at(300), arrival: at(900) }),
        ])
        const model = new JourneyProgressModel()
        const here = { lat: -36.85, lon: 174.76 }
        update(model, plan, at(280), { userLocation: here })
        expect(model.atBoardStop).toBe(true)
        expect(update(model, plan, at(285), { userLocation: here }).phase).toBe("waiting")
    })

    it("is boarding within the window with no live vehicle", () => {
        const plan = makePlan([makeLeg({ mode: "transit", tripId: "T1", from: board, to: alight, departure: at(60), arrival: at(660) })])
        const s = update(new JourneyProgressModel(), plan, BASE)
        expect(s.phase).toBe("boarding")
        expect(s.trackingLevel).toBe("scheduled")
    })

    it("uses the bus proximity threshold for boarding", () => {
        const b = makeStop("board", 0, 0)
        const plan = makePlan([makeLeg({ mode: "transit", tripId: "T1", from: b, to: alight, departure: BASE, arrival: at(600) })])
        const stops = [ref(3, { parent_stop_id: b.parent_station, child_stop_id: "board-child" })]
        const near = makeVehicle({ tripId: "T1", current: 2, next: 3, state: "Travelling", lat: 0.0027, type: "bus" })
        expect(update(new JourneyProgressModel(), plan, BASE, { vehiclesByTripId: { T1: near }, trackedStops: stops }).phase).toBe("boarding")
        const far = makeVehicle({ tripId: "T1", current: 2, next: 3, state: "Travelling", lat: 0.01, type: "bus" })
        expect(update(new JourneyProgressModel(), plan, BASE, { vehiclesByTripId: { T1: far }, trackedStops: stops }).phase).toBe("waiting")
    })

    it("is onboard once boarded, tracking live", () => {
        const plan = makePlan([makeLeg({ mode: "transit", tripId: "T1", from: board, to: alight, departure: BASE, arrival: at(600) })])
        const stops = [ref(3, { parent_stop_id: board.parent_station, child_stop_id: "board-child" })]
        const s = update(new JourneyProgressModel(), plan, at(120), { vehiclesByTripId: { T1: makeVehicle({ tripId: "T1", current: 4, next: 5, state: "Travelling" }) }, trackedStops: stops })
        expect(s.boarded).toBe(true)
        expect(s.phase).toBe("onboard")
        expect(s.trackingLevel).toBe("live")
    })

    it("has no phase or progress before the journey starts", () => {
        const plan = makePlan([makeLeg({ mode: "walk", departure: BASE, arrival: at(300), durationSeconds: 300 })])
        const s = update(new JourneyProgressModel(), plan, BASE, { journeyStarted: false })
        expect(s.phase).toBeNull()
        expect(s.progressLegIndex).toBe(-1)
        expect(s.journeyArrived).toBe(false)
    })

    it("arrives once the last leg and transit floor agree", () => {
        const plan = makePlan([makeLeg({ mode: "walk", departure: BASE, arrival: at(300), durationSeconds: 300 })])
        const s = update(new JourneyProgressModel(), plan, at(301))
        expect(s.journeyArrived).toBe(true)
        expect(s.progressLegIndex).toBe(1)
    })

    it("holds the rider on the first walk until the ride leaves", () => {
        const plan = makePlan([
            makeLeg({ mode: "walk", to: board, departure: BASE, arrival: at(300), durationSeconds: 300 }),
            makeLeg({ mode: "transit", tripId: "T1", from: board, to: alight, departure: at(480), arrival: at(1200), durationSeconds: 720 }),
            makeLeg({ mode: "walk", from: alight, departure: at(1200), arrival: at(1500), durationSeconds: 300 }),
        ])
        const snap = (s: number, hold: boolean) => update(new JourneyProgressModel(), plan, at(s), { holdAtStart: hold })
        expect(snap(360, false).progressLegIndex).toBe(1)
        expect(snap(360, true).progressLegIndex).toBe(0)
        expect(snap(360, true).phase).toBe("walking")
        expect(snap(500, true).progressLegIndex).toBe(1)
    })
})
