import XCTest
@testable import TransitCore

final class EasyPlannerTests: XCTestCase {
    private let base: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 9; c.day = 24; c.hour = 9; c.minute = 0
        c.timeZone = TimeZone(identifier: "Pacific/Auckland")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    private func stop(_ id: String, _ name: String, code: String = "", type: String = "bus", platform: String = "") -> Stop {
        Stop(stopID: id, parentStation: "", stopName: name, stopCode: code, stopHeadsign: "",
             stopLat: 0, stopLon: 0, platformNumber: platform, stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: type, wheelchairBoarding: 0)
    }

    private func walk(from: Stop? = nil, to: Stop?, at: TimeInterval, minutes: Double, km: Double) -> JourneyLeg {
        JourneyLeg(
            mode: "walk", fromStop: from, toStop: to, tripID: "", routeID: "", route: nil,
            departureTime: GoTime(date: base.addingTimeInterval(at)), arrivalTime: GoTime(date: base.addingTimeInterval(at + minutes * 60)),
            duration: GoDuration(nanoseconds: Int64(minutes * 60) * 1_000_000_000), distanceKm: km, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
    }

    private func ride(_ name: String, type: Int, from: Stop, to: Stop, at: TimeInterval, minutes: Double) -> JourneyLeg {
        let route = Route(routeID: name + "-1", agencyID: "", routeShortName: name, routeLongName: "", routeType: type, routeColor: "", vehicleType: "")
        return JourneyLeg(
            mode: "transit", fromStop: from, toStop: to, tripID: "t-" + name, routeID: route.routeID, route: route,
            departureTime: GoTime(date: base.addingTimeInterval(at)), arrivalTime: GoTime(date: base.addingTimeInterval(at + minutes * 60)),
            duration: GoDuration(nanoseconds: Int64(minutes * 60) * 1_000_000_000), distanceKm: 5, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: base.addingTimeInterval(at)), scheduledArrivalTime: GoTime(date: base.addingTimeInterval(at + minutes * 60)),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
    }

    private func plan(_ id: String, depart: TimeInterval, arrive: TimeInterval, transfers: Int, walkKm: Double) -> JourneyPlan {
        JourneyPlan(id: id, startLat: 0, startLon: 0, endLat: 0, endLon: 0,
                    departureTime: GoTime(date: base.addingTimeInterval(depart)), arrivalTime: GoTime(date: base.addingTimeInterval(arrive)),
                    totalDuration: GoDuration(nanoseconds: 0), transfers: transfers, transferStops: nil,
                    legs: [walk(to: nil, at: depart, minutes: 1, km: walkKm)], routeGeoJSON: nil)
    }

    // MARK: TravelMode

    func testTravelModeFromRouteType() {
        XCTAssertEqual(TravelMode(routeType: 3), .bus)
        XCTAssertEqual(TravelMode(routeType: 2), .train)
        XCTAssertEqual(TravelMode(routeType: 5), .train)
        XCTAssertEqual(TravelMode(routeType: 4), .ferry)
        XCTAssertNil(TravelMode(routeType: 6))
    }

    func testQueryValueIsStableOrder() {
        XCTAssertEqual(TravelMode.queryValue([.ferry, .bus]), "bus,ferry")
        XCTAssertEqual(TravelMode.queryValue([]), "")
    }

    func testPlanRequestSendsModesOnlyWhenSet() {
        let plain = JourneyPlanRequest(start: Coordinate(latitude: 0, longitude: 0), end: Coordinate(latitude: 0, longitude: 0))
        XCTAssertFalse(plain.queryItems.contains { $0.name == "modes" || $0.name == "minTransferSec" })

        let easy = JourneyPlanRequest(start: Coordinate(latitude: 0, longitude: 0), end: Coordinate(latitude: 0, longitude: 0),
                                      modes: [.train, .bus], minTransferSec: 120)
        XCTAssertEqual(easy.queryItems.first { $0.name == "modes" }?.value, "bus,train")
        XCTAssertEqual(easy.queryItems.first { $0.name == "minTransferSec" }?.value, "120")
    }

    // MARK: Ranking

    func testPrefersDirectOverSlightlyFasterWithAChange() {
        let direct = plan("direct", depart: 0, arrive: 40 * 60, transfers: 0, walkKm: 0.2)
        let change = plan("change", depart: 0, arrive: 33 * 60, transfers: 1, walkKm: 0.2)
        XCTAssertEqual(EasyPlanRanking.recommended([change, direct], arriveBy: nil, now: base)?.id, "direct")
    }

    func testAChangeWinsWhenItSavesALotOfTime() {
        let direct = plan("direct", depart: 0, arrive: 80 * 60, transfers: 0, walkKm: 0.2)
        let change = plan("change", depart: 0, arrive: 35 * 60, transfers: 1, walkKm: 0.2)
        XCTAssertEqual(EasyPlanRanking.recommended([direct, change], arriveBy: nil, now: base)?.id, "change")
    }

    func testArriveByPrefersAComfortableMarginAndLeastWaiting() {
        let target = base.addingTimeInterval(60 * 60)
        let tight = plan("tight", depart: 30 * 60, arrive: 58 * 60, transfers: 0, walkKm: 0.2)
        let comfy = plan("comfy", depart: 20 * 60, arrive: 50 * 60, transfers: 0, walkKm: 0.2)
        let early = plan("early", depart: 0, arrive: 30 * 60, transfers: 0, walkKm: 0.2)
        let late = plan("late", depart: 40 * 60, arrive: 65 * 60, transfers: 0, walkKm: 0.2)
        let ranked = EasyPlanRanking.ranked([early, late, tight, comfy], arriveBy: target, now: base)
        XCTAssertEqual(ranked.first?.id, "comfy")
        XCTAssertEqual(ranked.map(\.id), ["comfy", "early", "tight", "late"])
    }

    // MARK: Steps

    func testStepsReadAsPlainInstructions() {
        let queen = stop("q", "Queen Street", code: "7021")
        let ellerslie = stop("e", "Ellerslie Train Station")
        let journey = JourneyPlan(
            id: "p", startLat: 0, startLon: 0, endLat: 0, endLon: 0,
            departureTime: GoTime(date: base), arrivalTime: GoTime(date: base.addingTimeInterval(30 * 60)),
            totalDuration: GoDuration(nanoseconds: 0), transfers: 0, transferStops: nil,
            legs: [
                walk(to: queen, at: 0, minutes: 4, km: 0.31),
                ride("70", type: 3, from: queen, to: ellerslie, at: 6 * 60, minutes: 20),
                walk(from: ellerslie, to: nil, at: 26 * 60, minutes: 2, km: 0.12),
            ],
            routeGeoJSON: nil)

        let steps = EasyJourneyStep.steps(for: journey, destinationName: "Mum's house")
        XCTAssertEqual(steps.map(\.headline), [
            "Walk 4 min to Queen Street",
            "Catch the 70 bus at 9:06 am",
            "Walk 2 min to Mum's house",
        ])
        XCTAssertEqual(steps[0].detail, "About 310 metres. Stop 7021.")
        XCTAssertEqual(steps[1].detail, "From Queen Street. Stop 7021. Get off at Ellerslie Train Station at 9:26 am.")
        XCTAssertEqual(steps[1].kind, .ride(.bus))
    }

    func testTrainStepsUsePlatformNotLineCode() {
        let britomart = stop("w", "Waitemata Train Station", code: "9001", type: "train", platform: "1")
        let newmarket = stop("n", "Newmarket Train Station", code: "115", type: "train", platform: "2")
        let step = EasyJourneyStep.rideStep(ride("S-C", type: 2, from: britomart, to: newmarket, at: 34 * 60, minutes: 11))
        XCTAssertEqual(step.headline, "Catch the train at 9:34 am")
        XCTAssertEqual(step.detail, "From platform 1 at Waitemata Train Station. It's the S-C line. Get off at Newmarket Train Station at 9:45 am.")
        XCTAssertEqual(EasyJourneyStep.stopCodeSentence(britomart), "")
    }

    func testReminderFormCarriesModes() throws {
        var request = JourneyReminderRequest(
            kind: .journeyRequest,
            start: .init(label: "A", coordinate: Coordinate(latitude: 0, longitude: 0)),
            end: .init(label: "B", coordinate: Coordinate(latitude: 0, longitude: 0)),
            timeType: "arriveat", targetHHMM: "10:00", maxWalkKm: 0.6, walkSpeed: 3.6, maxTransfers: 1,
            onlyRoutes: [], offsets: [0], deeplink: "/plan")
        XCTAssertNil(request.formFields["modes"])
        request.modes = [.ferry]
        request.minTransferSec = 120
        XCTAssertEqual(request.formFields["modes"], "ferry")
        XCTAssertEqual(request.formFields["minTransferSec"], "120")
    }
}
