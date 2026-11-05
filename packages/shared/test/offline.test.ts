import { describe, expect, it } from "vitest"
import { OfflineRideEstimator, dueBoardingMoment, upcomingMoments, type GPSFix } from "../src/logic/offline"
import { JourneyProgressModel, hasDepartedStop } from "../src/logic/tracking"
import type { StopTimeUpdate, TripStopRef, Vehicle } from "../src/models"
import type { Leg } from "../src/types/journey"
import { BASE, at, makeLeg, makePlan, makeStop } from "./helpers"

/**
 * Ported from iOS OfflineRideEstimatorTests. The trip runs due north through
 * stops 0-5, ~500 m apart; the rider boards at stop 1 and gets off at stop 4.
 */

const START_LAT = -36.85
const LON = 174.76
const SPACING = 0.0045
const stopLat = (i: number) => START_LAT + i * SPACING
const tripStops: TripStopRef[] = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: stopLat(i), lon: LON, parent_stop_id: `p${i}`, name: `Stop ${i}`, platform: "", sequence: i + 1, child_stop_id: `c${i}` }))
const stop = (i: number) => makeStop(`c${i}`, stopLat(i), LON, { parent_station: "", stop_name: `Stop ${i}`, stop_code: `${i}`, platform_number: "", stop_type: "bus" })
const departure = at(600)
const arrival = at(1500)
const rideLeg: Leg = makeLeg({ mode: "transit", tripId: "T1", from: stop(1), to: stop(4), departure, arrival, durationSeconds: 900, extra: { RouteID: "70" } })

const fix = (i: number, speed: number | null, seconds: number, lonOffset = 0): GPSFix => ({ coordinate: { lat: stopLat(i), lon: LON + lonOffset }, speed, timestamp: at(seconds) })
const feed = (e: OfflineRideEstimator, f: GPSFix) => e.estimate(rideLeg, tripStops, f, departure, f.timestamp)
const boarded = () => {
    const e = new OfflineRideEstimator()
    feed(e, fix(1.4, 9, 620))
    feed(e, fix(1.7, 9, 640))
    return e
}

describe("OfflineRideEstimator boarding", () => {
    it("isn't boarded while waiting at the stop", () => {
        const e = new OfflineRideEstimator()
        expect(feed(e, fix(1, 0, 590))).toBeNull()
        expect(feed(e, fix(1, 0, 600))).toBeNull()
        expect(e.hasBoarded("T1")).toBe(false)
    })
    it("isn't boarded walking along the route", () => {
        const e = new OfflineRideEstimator()
        ;[1.4, 1.5, 1.6, 1.7].forEach((i, n) => expect(feed(e, fix(i, 1.4, 610 + n * 30))).toBeNull())
    })
    it("is boarded riding past the stop, after two agreeing fixes", () => {
        const e = new OfflineRideEstimator()
        expect(feed(e, fix(1.4, 9, 620))).toBeNull()
        const v = feed(e, fix(1.7, 9, 640))
        expect(e.hasBoarded("T1")).toBe(true)
        expect(v?.trip?.current_stop?.sequence).toBe(2)
        expect(v?.trip?.next_stop?.sequence).toBe(3)
        expect(v?.state).toBe("Travelling")
        expect(hasDepartedStop(v, 2)).toBe(true)
    })
    it("doesn't count the same fix twice", () => {
        const e = new OfflineRideEstimator()
        const one = fix(1.4, 9, 620)
        feed(e, one)
        feed(e, one)
        expect(e.hasBoarded("T1")).toBe(false)
    })
    it("isn't boarded moving fast long before departure", () => {
        const e = new OfflineRideEstimator()
        feed(e, fix(1.4, 12, 0))
        feed(e, fix(1.8, 12, 20))
        expect(e.hasBoarded("T1")).toBe(false)
    })
    it("works speed out when the device gives none", () => {
        const e = new OfflineRideEstimator()
        feed(e, fix(1.3, null, 620))
        feed(e, fix(1.5, null, 630))
        feed(e, fix(1.7, null, 640))
        expect(e.hasBoarded("T1")).toBe(true)
    })
    it("isn't boarded far from the route", () => {
        const e = new OfflineRideEstimator()
        feed(e, fix(1.4, 9, 620, 0.01))
        feed(e, fix(1.7, 9, 640, 0.01))
        expect(e.hasBoarded("T1")).toBe(false)
    })
})

describe("OfflineRideEstimator on board", () => {
    it("has the alight stop next near the end", () => {
        const v = feed(boarded(), fix(3.5, 10, 900))
        expect(v?.trip?.current_stop?.sequence).toBe(4)
        expect(v?.trip?.next_stop?.sequence).toBe(5)
    })
    it("names stops without the stop code", () => {
        expect(OfflineRideEstimator.shown({ lat: 0, lon: 0, parent_stop_id: "p", name: "Karangahape Road 7112", display_name: "Karangahape Road", platform: "", sequence: 3, child_stop_id: "c" }).name).toBe("Karangahape Road")
        expect(OfflineRideEstimator.shown({ lat: 0, lon: 0, parent_stop_id: "p", name: "Stop 1", platform: "", sequence: 1, child_stop_id: "c" }).name).toBe("Stop 1")
    })
    it("alights at the stop then walking away", () => {
        const e = boarded()
        const atStop = feed(e, fix(4, 0.5, 1000))
        expect(atStop?.trip?.current_stop?.sequence).toBe(5)
        expect(atStop?.state).toBe("AtStop")
        expect(hasDepartedStop(atStop, 5)).toBe(false)
        const walking = feed(e, fix(4, 1.3, 1060, 0.001))
        expect(e.hasAlighted("T1")).toBe(true)
        expect(hasDepartedStop(walking, 5)).toBe(true)
    })
    it("alights twenty metres from the stop", () => {
        const e = boarded()
        feed(e, fix(4, 0.5, 1000))
        feed(e, fix(4, 1.3, 1015, 0.00022))
        expect(e.hasAlighted("T1")).toBe(true)
    })
    it("doesn't alight staying on past the stop", () => {
        const e = boarded()
        feed(e, fix(4, 8, 1000))
        feed(e, fix(4.5, 10, 1040))
        expect(e.hasAlighted("T1")).toBe(false)
    })
    it("keeps progress across a relaunch", () => {
        const e = boarded()
        feed(e, fix(4, 0.5, 1000))
        feed(e, fix(4, 1.3, 1060, 0.001))
        const relaunched = new OfflineRideEstimator()
        relaunched.restore(e.progress)
        expect(relaunched.hasAlighted("T1")).toBe(true)
        expect(hasDepartedStop(feed(relaunched, fix(4, 0, 1200, 0.003)), 5)).toBe(true)
    })
})

describe("OfflineRideEstimator re-timing", () => {
    const st = (i: number, seconds: number, predicted?: number): StopTimeUpdate => {
        const ms = at(seconds).getTime()
        const p = predicted !== undefined ? at(predicted).getTime() : ms
        return { parent_stop_id: `p${i}`, child_stop_id: `c${i}`, arrival_time: p, departure_time: p, scheduled_time: ms, skipped: false, passed: false, dist: 0 }
    }
    it("re-times stops ahead by how late the ride is", () => {
        const e = boarded()
        const times = [st(1, 600), st(2, 780), st(3, 960), st(4, 1140)]
        feed(e, fix(2, 3, 900))
        const adjusted = e.adjustedStopTimes("T1", tripStops, times)!
        expect(adjusted[1].arrival_time).toBe(at(900).getTime())
        expect(adjusted[3].arrival_time).toBe(at(1260).getTime())
        expect(adjusted[0].arrival_time).toBe(at(600).getTime())
    })
    it("doesn't count a delay the feed already has twice", () => {
        const e = boarded()
        const times = [st(1, 600), st(2, 780), st(3, 960, 1080), st(4, 1140, 1260)]
        feed(e, fix(2, 3, 900))
        expect(e.adjustedStopTimes("T1", tripStops, times)![3].arrival_time).toBe(at(1260).getTime())
    })
})

describe("OfflineRideEstimator with the progress model and feed", () => {
    it("drives the progress model as an estimated ride", () => {
        const plan = makePlan([
            makeLeg({ mode: "walk", to: stop(1), departure: BASE, arrival: departure }),
            rideLeg,
            makeLeg({ mode: "walk", from: stop(4), departure: arrival, arrival: at(300, arrival) }),
        ])
        const v = feed(boarded(), fix(2.5, 10, 900))!
        const s = new JourneyProgressModel().update({
            plan, displayPlan: plan, now: at(900), vehiclesByTripId: { T1: v }, stopTimesByTripId: {}, journeyStarted: true,
            trackedStops: tripStops, userLocation: { lat: v.position.lat, lon: v.position.lon }, estimatedTripIds: new Set(["T1"]),
        })
        expect(s.trackingLevel).toBe("estimated")
        expect(s.boarded).toBe(true)
        expect(s.phase).toBe("onboard")
        expect(s.progressLegIndex).toBe(1)
        expect(s.trackedStopsAway).toBe(1)
    })
    const feedVehicle = (current: number, next: number | null, state: string, lat: number, occupancy = 0): Vehicle => {
        const r = (seq: number): TripStopRef => ({ lat: 0, lon: 0, parent_stop_id: `p${seq}`, name: `Stop ${seq}`, platform: "", sequence: seq, child_stop_id: `c${seq}` })
        return {
            trip_id: "T1", route: { id: "R", name: "R", color: "", type: "train" },
            trip: { first_stop: r(1), next_stop: next !== null ? r(next) : null, final_stop: r(9), current_stop: r(current), headsign: "Swanson" },
            occupancy, license_plate: "AMP123", position: { lat, lon: 0, bearing: 45 }, type: "train", state, off_course: false,
        }
    }
    it("moves the live vehicle on when GPS is ahead, keeping the feed's details", () => {
        const merged = OfflineRideEstimator.advancing(feedVehicle(5, 6, "AtStop", 0, 2), feedVehicle(6, null, "Travelling", 0.001))
        expect(merged.trip?.current_stop?.sequence).toBe(6)
        expect(merged.state).toBe("Travelling")
        expect(merged.position.lat).toBe(0.001)
        expect(merged.occupancy).toBe(2)
        expect(merged.license_plate).toBe("AMP123")
        expect(merged.trip?.headsign).toBe("Swanson")
        expect(merged.position.bearing).toBe(45)
    })
    it("never moves the ride back", () => {
        const live = feedVehicle(5, 6, "Travelling", 0)
        expect(OfflineRideEstimator.advancing(live, feedVehicle(4, 5, "Travelling", 0.001))).toBe(live)
        expect(OfflineRideEstimator.advancing(live, feedVehicle(5, 6, "AtStop", 0.001))).toBe(live)
    })
})

describe("offline journey moments", () => {
    const TZ = "Pacific/Auckland"
    const ride = (id: string, d: number, a: number) => makeLeg({ mode: "transit", tripId: id, departure: at(d), arrival: at(a), extra: { RouteID: id } })
    it("has board and alight moments for every ride ahead", () => {
        const m = upcomingMoments([ride("A", 600, 1200), ride("B", 1500, 2100)], 0, false, BASE, TZ)
        expect(m.map((x) => x.key)).toEqual(["A:board-soon", "A:alight-soon", "B:board-soon", "B:alight-soon"])
        expect(m[0].date.getTime()).toBe(at(420).getTime())
        expect(m[1].date.getTime()).toBe(at(1080).getTime())
    })
    it("makes the boarding heads-up due from three minutes out", () => {
        const legs = [ride("A", 600, 1200)]
        expect(dueBoardingMoment(legs, 0, false, at(410), TZ)).toBeNull()
        expect(dueBoardingMoment(legs, 0, false, at(425), TZ)?.key).toBe("A:board-soon")
        expect(dueBoardingMoment(legs, 0, false, at(500), TZ)).toBeNull()
        expect(dueBoardingMoment(legs, 0, true, at(425), TZ)).toBeNull()
    })
    it("adds setting-off moments before the first walk, at the minute-rounded leave time", () => {
        const walk = makeLeg({ mode: "walk", departure: at(900), arrival: at(1200) })
        const legs = [walk, ride("A", 1500, 2100)]
        const m = upcomingMoments(legs, 0, false, BASE, TZ)
        expect(m.map((x) => x.key)).toEqual(["leave:ready", "leave:now", "A:board-soon", "A:alight-soon"])
        // Leave-by is rounded down to the minute: BASE+900 s is hh:mm:20, so it becomes BASE+880 s.
        const leaveBy = Math.floor(at(900).getTime() / 60_000) * 60_000
        expect(m[0].date.getTime()).toBe(leaveBy - 300_000)
        expect(m[1].date.getTime()).toBe(leaveBy - 30_000)
        expect(upcomingMoments(legs, 1, false, BASE, TZ).some((x) => x.key.startsWith("leave:"))).toBe(false)
    })
    it("skips boarding and past moments once on board", () => {
        const m = upcomingMoments([ride("A", 600, 1200), ride("B", 1500, 2100)], 0, true, at(700), TZ)
        expect(m.map((x) => x.key)).toEqual(["A:alight-soon", "B:board-soon", "B:alight-soon"])
    })
})
