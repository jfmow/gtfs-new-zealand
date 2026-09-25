import XCTest
@testable import TransitCore

/// Port of the web's `replanChoices` (components/journey/helpers.ts).
final class JourneyReplanTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_790_000_000)

    private func stop(_ id: String, _ name: String) -> Stop {
        Stop(stopID: id, parentStation: "", stopName: name, stopCode: "1", stopHeadsign: "",
             stopLat: -36.8, stopLon: 174.7, platformNumber: "", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "bus", wheelchairBoarding: 0)
    }

    private func leg(_ mode: String, from: Stop? = nil, to: Stop?, dep: TimeInterval, arr: TimeInterval, route: String? = nil) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: route ?? "", routeID: route ?? "",
            route: route.map { Route(routeID: $0, agencyID: "", routeShortName: $0, routeLongName: "", routeType: 3, routeColor: "", vehicleType: "Bus") },
            departureTime: GoTime(date: base.addingTimeInterval(dep)), arrivalTime: GoTime(date: base.addingTimeInterval(arr)),
            duration: GoDuration(nanoseconds: 0), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true)
    }

    private var legs: [JourneyLeg] {
        [
            leg("walk", to: stop("a", "Britomart"), dep: 0, arr: 300),
            leg("transit", from: stop("a", "Britomart"), to: stop("b", "Newmarket"), dep: 480, arr: 1500, route: "70"),
            leg("walk", from: stop("b", "Newmarket"), to: stop("c", "Uni"), dep: 1500, arr: 1800),
        ]
    }

    func testOnboardOffersNextStopOrStayOn() {
        let choices = JourneyReplan.choices(legs: legs, progressLegIndex: 1, phase: "onboard",
                                            vehicleNextStop: ("Parnell", Coordinate(latitude: -36.85, longitude: 174.78)),
                                            vehicleNextStopETA: base.addingTimeInterval(900), userLocation: nil, now: base)
        XCTAssertEqual(choices.map(\.key), ["next-stop", "alight"])
        XCTAssertEqual(choices[0].label, "Get off at Parnell")
        XCTAssertEqual(choices[1].label, "Stay on to Newmarket")
        XCTAssertEqual(choices[1].departAt, base.addingTimeInterval(1500))
    }

    func testWalkingOffersHereOrTargetStop() {
        let choices = JourneyReplan.choices(legs: legs, progressLegIndex: 0, phase: "walking", vehicleNextStop: nil,
                                            vehicleNextStopETA: nil, userLocation: Coordinate(latitude: -36.84, longitude: 174.76), now: base)
        XCTAssertEqual(choices.map(\.label), ["From where I am now", "From Britomart"])
    }

    func testWaitingOffersLeaveNowOrTakeItAnyway() {
        let choices = JourneyReplan.choices(legs: legs, progressLegIndex: 1, phase: "waiting", vehicleNextStop: nil,
                                            vehicleNextStopETA: nil, userLocation: nil, now: base)
        XCTAssertEqual(choices.map(\.label), ["Leave from Britomart now", "Take the 70 anyway"])
    }

    func testNothingOnTheFinalLeg() {
        XCTAssertTrue(JourneyReplan.choices(legs: legs, progressLegIndex: 2, phase: "walking", vehicleNextStop: nil,
                                            vehicleNextStopETA: nil, userLocation: nil).isEmpty)
    }
}
