import { describe, expect, it, vi } from "vitest"
import {
    PRODUCTION_REGIONS, createApiClient, regionOptions, getRegionSlug, regionBySlug, groupByCountry, hasRealtime,
    wallClock, fromWallClock, withRegionTime,
    normalizeWalkSpeed, walkSpeedLabel,
    convert24hTo12h, headsignDisplay, cleanStopName, addSecondsToTime,
    clock, easySteps, easyAttempts, rankedPlans, defaultArriveBy,
    reliabilityChangeKeys,
    type JourneyType, type Leg, type Stop,
} from "../src"

const AKL = "Pacific/Auckland"
const at = PRODUCTION_REGIONS[0]
const otago = PRODUCTION_REGIONS.find((r) => getRegionSlug(r) === "otago")!

describe("regions", () => {
    it("has the five production regions with unique slugs", () => {
        expect(PRODUCTION_REGIONS.map(getRegionSlug)).toEqual(["at", "wel", "christ", "otago", "seq"])
    })
    it("adds dev regions only in development", () => {
        expect(regionOptions(false)).toHaveLength(5)
        expect(regionOptions(true, "http://10.0.2.2:8090")[5].url).toBe("http://10.0.2.2:8090/at")
    })
    it("finds by slug and groups NZ first", () => {
        expect(regionBySlug(PRODUCTION_REGIONS, "seq")?.timeZone).toBe("Australia/Brisbane")
        expect(groupByCountry(PRODUCTION_REGIONS).map((g) => g.country)).toEqual(["NZ", "AU"])
    })
    it("knows Otago has no realtime", () => {
        expect(hasRealtime(otago)).toBe(false)
        expect(hasRealtime(at)).toBe(true)
    })
})

describe("region time", () => {
    it("reads the Auckland clock", () => {
        // 2026-11-04 00:30 UTC is 13:30 NZDT
        expect(wallClock(new Date("2026-11-04T00:30:00Z"), AKL)).toEqual({ year: 2026, month: 11, day: 4, hour: 13, minute: 30 })
    })
    it("round-trips across the April DST change", () => {
        const w = { year: 2026, month: 4, day: 5, hour: 9, minute: 0 }
        expect(wallClock(fromWallClock(w, AKL), AKL)).toEqual(w)
    })
    it("moves the clock time within the region day", () => {
        const d = withRegionTime(new Date("2026-11-04T00:30:00Z"), 7, 15, AKL)
        expect(d.toISOString()).toBe("2026-11-03T18:15:00.000Z")
    })
})

describe("walk speed", () => {
    it("maps legacy scales onto the current one", () => {
        expect(normalizeWalkSpeed("4.8")).toBe("3.6")
        expect(normalizeWalkSpeed(undefined)).toBe("3.6")
        expect(walkSpeedLabel("5")).toBe("Brisk")
    })
})

describe("formatting", () => {
    it("wraps GTFS times past midnight", () => {
        expect(convert24hTo12h("24:06:00")).toBe("12:06 AM")
        expect(convert24hTo12h("13:05:00")).toBe("1:05 PM")
    })
    it("tidies headsigns and stop names", () => {
        expect(headsignDisplay("SWANSON 1 TO MANUKAU 1")).toBe("Swanson to Manukau")
        expect(headsignDisplay("Pukekohe Via Grafton")).toBe("Pukekohe via Grafton")
        expect(headsignDisplay("NX1 Hibiscus Coast")).toBe("NX1 Hibiscus Coast")
        expect(cleanStopName("Avondale Train Station 105")).toBe("Avondale Train Station")
    })
    it("adds seconds to a GTFS time", () => {
        expect(addSecondsToTime("23:59:30", 45)).toBe("24:00:15")
    })
})

function stop(name: string, extra: Partial<Stop> = {}): Stop {
    return {
        location_type: 0, parent_station: "", stop_code: "", stop_id: name, stop_lat: 0, stop_lon: 0, stop_name: name,
        stop_headsign: "", wheelchair_boarding: 0, platform_number: "", stop_type: "", stop_sequence: 0, is_child_stop: false, ...extra,
    }
}

function leg(extra: Partial<Leg>): Leg {
    const t = new Date("2026-11-04T00:00:00Z")
    return {
        Mode: "walk", FromStop: null, ToStop: null, TripID: "", RouteID: "", Route: null, DepartureTime: t, ArrivalTime: t,
        Duration: 0, DistanceKm: 0, StopSequenceID: 0, scheduled_departure_time: t, scheduled_arrival_time: t, trip_usable: true, ...extra,
    }
}

function plan(depart: string, arrive: string, legs: Leg[], transfers = 0): JourneyType {
    return {
        StartLat: 0, StartLon: 0, EndLat: 0, EndLon: 0, DepartureTime: new Date(depart), ArrivalTime: new Date(arrive),
        TotalDuration: 0, Transfers: transfers, TransferStops: null, Legs: legs, RouteGeoJSON: { type: "FeatureCollection", features: [] }, ID: depart,
    }
}

describe("easy planner", () => {
    it("formats the clock in the given zone", () => {
        expect(clock("2026-11-03T21:01:00Z", AKL)).toBe("10:01 am")
    })
    it("writes plain-English steps", () => {
        const bus = leg({
            Mode: "transit", RouteID: "70", DepartureTime: new Date("2026-11-03T21:01:00Z"), ArrivalTime: new Date("2026-11-03T21:15:00Z"),
            Route: { route_id: "70", route_short_name: "70", route_long_name: "", route_color: "", route_text_color: "", vehicle_type: "Bus" },
            FromStop: stop("Queen Street", { stop_code: "7021", stop_type: "bus" }), ToStop: stop("Ellerslie"),
        })
        const walk = leg({ Duration: 4 * 60 * 1e9, DistanceKm: 0.31 })
        const steps = easySteps(plan("2026-11-03T21:01:00Z", "2026-11-03T21:19:00Z", [bus, walk]), "home", AKL)
        expect(steps.map((s) => s.headline)).toEqual(["Catch the 70 bus at 10:01 am", "Walk 4 min to home"])
        expect(steps[0].detail).toBe("From Queen Street. Stop 7021. Get off at Ellerslie at 10:15 am.")
        expect(steps[1].detail).toBe("About 310 metres.")
    })
    it("tries looser searches after the rider's answers", () => {
        expect(easyAttempts(["train"], true).map((a) => a.modes)).toEqual([["train"], ["train"], []])
    })
    it("prefers a direct trip over a slightly quicker one with a change", () => {
        const now = new Date("2026-11-04T00:00:00Z").getTime()
        const direct = plan("2026-11-04T00:05:00Z", "2026-11-04T00:40:00Z", [], 0)
        const change = plan("2026-11-04T00:05:00Z", "2026-11-04T00:35:00Z", [], 1)
        expect(rankedPlans([change, direct], null, now)[0]).toBe(direct)
    })
    it("defaults arrive-by to the quarter hour after an hour from now", () => {
        expect(defaultArriveBy(new Date("2026-11-04T00:07:00Z")).toISOString()).toBe("2026-11-04T01:15:00.000Z")
    })
})

describe("reliability change keys", () => {
    it("keys a change by both rides and the slack between them", () => {
        const a = leg({ Mode: "transit", RouteID: "A", ToStop: stop("s1"), scheduled_arrival_time: new Date("2026-11-04T00:10:00Z") })
        const w = leg({ Duration: 60 * 1e9 })
        const b = leg({ Mode: "transit", RouteID: "B", FromStop: stop("s2"), scheduled_departure_time: new Date("2026-11-04T00:15:00Z") })
        const keys = reliabilityChangeKeys([a, w, b])
        expect([...keys.keys()]).toEqual([2])
        expect(keys.get(2)).toBe("A|s1|1793751000|B|s2|1793751300|240")
    })
})

describe("lineCoordinates", () => {
    it("reads a single Feature (what map/geojson/shapes returns), a collection, or nothing", async () => {
        const { lineCoordinates } = await import("../src/models")
        const feature = { type: "Feature" as const, geometry: { type: "LineString", coordinates: [[174.7, -36.8], [174.8, -36.9]] } }
        expect(lineCoordinates(feature)).toEqual([{ lat: -36.8, lon: 174.7 }, { lat: -36.9, lon: 174.8 }])
        expect(lineCoordinates({ type: "FeatureCollection", features: [feature] })).toHaveLength(2)
        expect(lineCoordinates(null)).toEqual([])
        expect(lineCoordinates({ type: "FeatureCollection" } as never)).toEqual([])
    })
})

describe("api client", () => {
    const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ code: 200, data, message: "" }), { status: 200 }))

    it("joins the region URL and path, and sends the trace id", async () => {
        const fetchMock = vi.fn((_url: string, _init?: RequestInit) => ok([1, 2]))
        const api = createApiClient({ region: () => at, traceId: () => "t-1", headers: () => ({ "X-Device-Id": "d" }), fetch: fetchMock as unknown as typeof fetch })
        const res = await api<number[]>("/stops?q=x")
        expect(res).toEqual({ ok: true, data: [1, 2] })
        expect(fetchMock.mock.calls[0][0]).toBe("https://trainapi.suddsy.dev/at/stops?q=x")
        expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-Device-Id": "d", "X-Trace-ID": "t-1" })
    })
    it("returns the backend's message on an error status", async () => {
        const fetchMock = () => Promise.resolve(new Response(JSON.stringify({ code: 400, data: null, message: "bad", trace_id: "x" }), { status: 400 }))
        const api = createApiClient({ region: () => at, traceId: () => "t", fetch: fetchMock as unknown as typeof fetch })
        expect(await api("stops")).toEqual({ ok: false, error: "bad", status_code: 400, trace_id: "x" })
    })
    it("never throws on a network failure", async () => {
        const api = createApiClient({ region: () => at, traceId: () => "t", fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch })
        expect(await api("stops")).toMatchObject({ ok: false, error: "offline", status_code: 500 })
    })
    it("skips realtime-only paths for a region without realtime", async () => {
        const fetchMock = vi.fn()
        const api = createApiClient({ region: () => otago, traceId: () => "t", fetch: fetchMock as unknown as typeof fetch })
        expect(await api("realtime/live")).toMatchObject({ ok: false, status_code: 404 })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
