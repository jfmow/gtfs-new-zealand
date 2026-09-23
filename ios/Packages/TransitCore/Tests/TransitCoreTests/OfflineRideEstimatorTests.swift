import XCTest
@testable import TransitCore

/// GPS-only ride tracking for when there's no connection - see
/// `OfflineRideEstimator`. The trip runs due north through stops 0-5, ~500m
/// apart; the rider boards at stop 1 and gets off at stop 4.
final class OfflineRideEstimatorTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)
    private let startLat = -36.85
    private let lon = 174.76
    /// ~500m of latitude.
    private let spacing = 0.0045

    private func stopLat(_ i: Double) -> Double { startLat + i * spacing }

    private var tripStops: [TripStopRef] {
        (0...5).map { i in
            TripStopRef(lat: stopLat(Double(i)), lon: lon, parentStopID: "p\(i)", name: "Stop \(i)", platform: "", sequence: i + 1, childStopID: "c\(i)")
        }
    }

    private func makeStop(_ i: Int) -> Stop {
        Stop(stopID: "c\(i)", parentStation: "", stopName: "Stop \(i)", stopCode: "\(i)", stopHeadsign: "",
             stopLat: stopLat(Double(i)), stopLon: lon, platformNumber: "", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "bus", wheelchairBoarding: 0)
    }

    private var departure: Date { base.addingTimeInterval(600) }
    private var arrival: Date { base.addingTimeInterval(1500) }

    private func makeLeg(mode: String, tripID: String = "", from: Stop?, to: Stop?, departure: Date, arrival: Date) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: tripID, routeID: tripID.isEmpty ? "" : "70", route: nil,
            departureTime: GoTime(date: departure), arrivalTime: GoTime(date: arrival),
            duration: GoDuration(nanoseconds: Int64(arrival.timeIntervalSince(departure) * 1_000_000_000)), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
    }

    private var rideLeg: JourneyLeg { makeLeg(mode: "transit", tripID: "T1", from: makeStop(1), to: makeStop(4), departure: departure, arrival: arrival) }

    private func fix(at i: Double, speed: Double?, seconds: TimeInterval, lonOffset: Double = 0) -> OfflineRideEstimator.Fix {
        .init(coordinate: Coordinate(latitude: stopLat(i), longitude: lon + lonOffset), speed: speed, timestamp: base.addingTimeInterval(seconds))
    }

    @discardableResult
    private func feed(_ estimator: OfflineRideEstimator, _ fix: OfflineRideEstimator.Fix) -> Vehicle? {
        estimator.estimate(leg: rideLeg, stops: tripStops, fix: fix, departure: departure, now: fix.timestamp)
    }

    // MARK: - Boarding

    func testWaitingAtTheStopIsNotBoarded() {
        let estimator = OfflineRideEstimator()
        XCTAssertNil(feed(estimator, fix(at: 1, speed: 0, seconds: 590)))
        XCTAssertNil(feed(estimator, fix(at: 1, speed: 0, seconds: 600)))
        XCTAssertFalse(estimator.hasBoarded(tripID: "T1"))
    }

    func testWalkingAlongTheRouteIsNotBoarded() {
        let estimator = OfflineRideEstimator()
        for (n, i) in [1.4, 1.5, 1.6, 1.7].enumerated() {
            XCTAssertNil(feed(estimator, fix(at: i, speed: 1.4, seconds: 610 + Double(n) * 30)))
        }
    }

    func testRidingPastTheStopIsBoarded() {
        let estimator = OfflineRideEstimator()
        XCTAssertNil(feed(estimator, fix(at: 1.4, speed: 9, seconds: 620)), "one fix isn't enough - a GPS jump onto the road")
        let vehicle = feed(estimator, fix(at: 1.7, speed: 9, seconds: 640))
        XCTAssertTrue(estimator.hasBoarded(tripID: "T1"))
        XCTAssertEqual(vehicle?.trip?.currentStop?.sequence, 2) // stop 1
        XCTAssertEqual(vehicle?.trip?.nextStop?.sequence, 3)    // stop 2
        XCTAssertEqual(vehicle?.state, "Travelling")
        XCTAssertTrue(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 2))
    }

    func testTheSameFixAgainDoesNotCountTwice() {
        let estimator = OfflineRideEstimator()
        let one = fix(at: 1.4, speed: 9, seconds: 620)
        feed(estimator, one)
        feed(estimator, one)
        XCTAssertFalse(estimator.hasBoarded(tripID: "T1"))
    }

    func testMovingFastLongBeforeDepartureIsNotBoarded() {
        // In a car along the same road, well before the bus is due.
        let estimator = OfflineRideEstimator()
        feed(estimator, fix(at: 1.4, speed: 12, seconds: 0))
        feed(estimator, fix(at: 1.8, speed: 12, seconds: 20))
        XCTAssertFalse(estimator.hasBoarded(tripID: "T1"))
    }

    func testSpeedIsWorkedOutWhenTheDeviceGivesNone() {
        let estimator = OfflineRideEstimator()
        feed(estimator, fix(at: 1.3, speed: nil, seconds: 620))
        feed(estimator, fix(at: 1.5, speed: nil, seconds: 630)) // ~100m in 10s
        feed(estimator, fix(at: 1.7, speed: nil, seconds: 640))
        XCTAssertTrue(estimator.hasBoarded(tripID: "T1"))
    }

    func testFarFromTheRouteIsNotBoarded() {
        let estimator = OfflineRideEstimator()
        // ~900m east of the line through the stops.
        feed(estimator, fix(at: 1.4, speed: 9, seconds: 620, lonOffset: 0.01))
        feed(estimator, fix(at: 1.7, speed: 9, seconds: 640, lonOffset: 0.01))
        XCTAssertFalse(estimator.hasBoarded(tripID: "T1"))
    }

    // MARK: - On board and getting off

    private func boardedEstimator() -> OfflineRideEstimator {
        let estimator = OfflineRideEstimator()
        feed(estimator, fix(at: 1.4, speed: 9, seconds: 620))
        feed(estimator, fix(at: 1.7, speed: 9, seconds: 640))
        return estimator
    }

    func testNextStopIsTheAlightStop() {
        let estimator = boardedEstimator()
        let vehicle = feed(estimator, fix(at: 3.5, speed: 10, seconds: 900))
        XCTAssertEqual(vehicle?.trip?.currentStop?.sequence, 4) // stop 3
        XCTAssertEqual(vehicle?.trip?.nextStop?.sequence, 5)    // stop 4, where the rider gets off
    }

    func testStopsAreNamedWithoutTheStopCode() throws {
        let json = #"{"lat":0,"lon":0,"parent_stop_id":"p","name":"Karangahape Road 7112","display_name":"Karangahape Road","platform":"","sequence":3,"child_stop_id":"c"}"#
        let stop = try JSONDecoder().decode(TripStopRef.self, from: Data(json.utf8))
        XCTAssertEqual(OfflineRideEstimator.shown(stop).name, "Karangahape Road")
        // Offline packs saved before the backend sent display_name.
        let old = TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "Stop 1", platform: "", sequence: 1, childStopID: "c")
        XCTAssertEqual(OfflineRideEstimator.shown(old).name, "Stop 1")
    }

    func testAtTheAlightStopThenWalkingAwayIsAlighted() {
        let estimator = boardedEstimator()
        let atStop = feed(estimator, fix(at: 4, speed: 0.5, seconds: 1000))
        XCTAssertEqual(atStop?.trip?.currentStop?.sequence, 5)
        XCTAssertEqual(atStop?.state, "AtStop")
        XCTAssertFalse(JourneyTracking.hasDepartedStop(atStop, stopSeq: 5), "still on board while it's stopped there")

        // Walking off east, away from the route.
        let walking = feed(estimator, fix(at: 4, speed: 1.3, seconds: 1060, lonOffset: 0.001))
        XCTAssertTrue(estimator.hasAlighted(tripID: "T1"))
        XCTAssertTrue(JourneyTracking.hasDepartedStop(walking, stopSeq: 5), "latches the ride as done in the progress model")
    }

    func testStayingOnPastTheStopIsNotAlighted() {
        let estimator = boardedEstimator()
        feed(estimator, fix(at: 4, speed: 8, seconds: 1000))
        feed(estimator, fix(at: 4.5, speed: 10, seconds: 1040))
        XCTAssertFalse(estimator.hasAlighted(tripID: "T1"))
    }

    func testProgressSurvivesARelaunch() {
        let estimator = boardedEstimator()
        feed(estimator, fix(at: 4, speed: 0.5, seconds: 1000))
        feed(estimator, fix(at: 4, speed: 1.3, seconds: 1060, lonOffset: 0.001))
        let saved = estimator.progress

        let relaunched = OfflineRideEstimator()
        relaunched.restore(saved)
        XCTAssertTrue(relaunched.hasAlighted(tripID: "T1"))
        let vehicle = feed(relaunched, fix(at: 4, speed: 0, seconds: 1200, lonOffset: 0.003))
        XCTAssertTrue(JourneyTracking.hasDepartedStop(vehicle, stopSeq: 5), "still counts as got off, not back to waiting")
    }

    // MARK: - Re-timing from GPS

    private func stopTime(_ i: Int, at seconds: TimeInterval, predicted: TimeInterval? = nil) -> StopTimeUpdate {
        let ms = Int64(base.addingTimeInterval(seconds).timeIntervalSince1970 * 1000)
        let predictedMs = predicted.map { Int64(base.addingTimeInterval($0).timeIntervalSince1970 * 1000) } ?? ms
        return StopTimeUpdate(parentStopID: "p\(i)", childStopID: "c\(i)", arrivalTime: GoEpochMillis(milliseconds: predictedMs),
                              departureTime: GoEpochMillis(milliseconds: predictedMs), scheduledTime: GoEpochMillis(milliseconds: ms),
                              skipped: false, passed: false, dist: 0)
    }

    func testStopsAheadAreRetimedByHowLateTheRideIs() {
        let estimator = boardedEstimator()
        let times = [stopTime(1, at: 600), stopTime(2, at: 780), stopTime(3, at: 960), stopTime(4, at: 1140)]
        // Reaches stop 2 at 900s - predicted 780s, so two minutes late.
        feed(estimator, fix(at: 2, speed: 3, seconds: 900))
        let adjusted = estimator.adjustedStopTimes(tripID: "T1", stops: tripStops, stopTimes: times)
        XCTAssertEqual(adjusted?[1].arrivalTime.date, base.addingTimeInterval(900))
        XCTAssertEqual(adjusted?[3].arrivalTime.date, base.addingTimeInterval(1260))
        XCTAssertEqual(adjusted?[0].arrivalTime.date, base.addingTimeInterval(600), "stops already passed stay put")
    }

    func testDelayTheFeedAlreadyHasIsNotCountedTwice() {
        let estimator = boardedEstimator()
        // The feed: stop 2 passed (timetable time, as the backend reports
        // passed stops), stops ahead already 2 min late.
        let times = [stopTime(1, at: 600), stopTime(2, at: 780),
                     stopTime(3, at: 960, predicted: 1080), stopTime(4, at: 1140, predicted: 1260)]
        // Passes stop 2 at 900s: two minutes late - what the feed says too.
        feed(estimator, fix(at: 2, speed: 3, seconds: 900))
        let adjusted = estimator.adjustedStopTimes(tripID: "T1", stops: tripStops, stopTimes: times)
        XCTAssertEqual(adjusted?[3].arrivalTime.date, base.addingTimeInterval(1260), "2 min late, not 4")
    }

    // MARK: - With the progress model

    func testProgressModelTracksAnEstimatedRide() {
        let walk1 = makeLeg(mode: "walk", from: nil, to: makeStop(1), departure: base, arrival: departure)
        let walk2 = makeLeg(mode: "walk", from: makeStop(4), to: nil, departure: arrival, arrival: arrival.addingTimeInterval(300))
        let plan = JourneyPlan(
            id: "p", startLat: 0, startLon: 0, endLat: 0, endLon: 0,
            departureTime: GoTime(date: base), arrivalTime: GoTime(date: arrival.addingTimeInterval(300)),
            totalDuration: GoDuration(nanoseconds: 0), transfers: 0, transferStops: nil, legs: [walk1, rideLeg, walk2], routeGeoJSON: nil
        )
        let estimator = boardedEstimator()
        let now = base.addingTimeInterval(900)
        let vehicle = feed(estimator, fix(at: 2.5, speed: 10, seconds: 900))!

        let snapshot = JourneyProgressModel().update(
            plan: plan, displayPlan: plan, now: now, vehiclesByTripID: ["T1": vehicle], stopTimesByTripID: [:],
            journeyStarted: true, trackedStops: tripStops, userLocation: vehicle.position.coordinate, estimatedTripIDs: ["T1"]
        )
        XCTAssertEqual(snapshot.trackingLevel, .estimated)
        XCTAssertTrue(snapshot.boarded)
        XCTAssertEqual(snapshot.phase, .onboard)
        XCTAssertEqual(snapshot.progressLegIndex, 1)
        XCTAssertEqual(snapshot.trackedStopsAway, 1) // stop 3 next, then stop 4
    }
}

final class OfflineJourneyMomentsTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func leg(_ tripID: String, departs: TimeInterval, arrives: TimeInterval) -> JourneyLeg {
        JourneyLeg(
            mode: "transit", fromStop: nil, toStop: nil, tripID: tripID, routeID: tripID, route: nil,
            departureTime: GoTime(date: base.addingTimeInterval(departs)), arrivalTime: GoTime(date: base.addingTimeInterval(arrives)),
            duration: GoDuration(nanoseconds: 0), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
    }

    func testBoardAndAlightMomentsForEveryRideAhead() {
        let legs = [leg("A", departs: 600, arrives: 1200), leg("B", departs: 1500, arrives: 2100)]
        let moments = OfflineJourneyMoments.upcoming(legs: legs, progressLegIndex: 0, onboard: false, now: base)
        XCTAssertEqual(moments.map(\.key), ["A:board-soon", "A:alight-soon", "B:board-soon", "B:alight-soon"])
        XCTAssertEqual(moments[0].date, base.addingTimeInterval(420))
        XCTAssertEqual(moments[1].date, base.addingTimeInterval(1080))
    }

    func testBoardingHeadsUpIsDueFromThreeMinutesOut() {
        let legs = [leg("A", departs: 600, arrives: 1200)]
        XCTAssertNil(OfflineJourneyMoments.dueBoarding(legs: legs, progressLegIndex: 0, onboard: false, now: base.addingTimeInterval(410)))
        XCTAssertEqual(OfflineJourneyMoments.dueBoarding(legs: legs, progressLegIndex: 0, onboard: false, now: base.addingTimeInterval(425))?.key, "A:board-soon")
        XCTAssertNil(OfflineJourneyMoments.dueBoarding(legs: legs, progressLegIndex: 0, onboard: false, now: base.addingTimeInterval(500)), "too late to be useful")
        XCTAssertNil(OfflineJourneyMoments.dueBoarding(legs: legs, progressLegIndex: 0, onboard: true, now: base.addingTimeInterval(425)))
    }

    func testOnBoardSkipsBoardingAndPastMoments() {
        let legs = [leg("A", departs: 600, arrives: 1200), leg("B", departs: 1500, arrives: 2100)]
        let moments = OfflineJourneyMoments.upcoming(legs: legs, progressLegIndex: 0, onboard: true, now: base.addingTimeInterval(700))
        XCTAssertEqual(moments.map(\.key), ["A:alight-soon", "B:board-soon", "B:alight-soon"])
    }
}
