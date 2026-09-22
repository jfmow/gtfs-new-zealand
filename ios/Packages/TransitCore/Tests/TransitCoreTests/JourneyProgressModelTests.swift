import XCTest
@testable import TransitCore

/// Covers the journey live-tracking state machine - see
/// `JourneyProgressModel`'s doc comment. `testDelayedTrainDoesNotAdvanceToWalkingLegBeforeAlighting`
/// specifically re-covers the bug fixed 2026-09-16 (see project memory
/// `journey-live-tracking-leg-advance`): a late-running train must not show
/// the walking leg as "current" while the rider is still on board.
final class JourneyProgressModelTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeStop(id: String, lat: Double = 0, lon: Double = 0) -> Stop {
        Stop(stopID: id, parentStation: "P-\(id)", stopName: id, stopCode: "1", stopHeadsign: "",
             stopLat: lat, stopLon: lon, platformNumber: "1", stopSequence: 0, isChildStop: true,
             locationType: 0, stopType: "train", wheelchairBoarding: 0)
    }

    private func makeLeg(mode: String, tripID: String = "", from: Stop? = nil, to: Stop? = nil, departure: Date?, arrival: Date?, durationSeconds: TimeInterval = 0) -> JourneyLeg {
        JourneyLeg(
            mode: mode, fromStop: from, toStop: to, tripID: tripID, routeID: tripID.isEmpty ? "" : "R", route: nil,
            departureTime: GoTime(date: departure), arrivalTime: GoTime(date: arrival),
            duration: GoDuration(nanoseconds: Int64(durationSeconds * 1_000_000_000)), distanceKm: 0, stopSequenceID: 0,
            scheduledDepartureTime: GoTime(date: nil), scheduledArrivalTime: GoTime(date: nil),
            realtimeStatus: nil, delaySeconds: nil, tripUsable: true
        )
    }

    private func makePlan(legs: [JourneyLeg]) -> JourneyPlan {
        JourneyPlan(
            id: "p1", startLat: 0, startLon: 0, endLat: 0, endLon: 0,
            departureTime: GoTime(date: legs.first?.departureTime.date), arrivalTime: GoTime(date: legs.last?.arrivalTime.date),
            totalDuration: GoDuration(nanoseconds: 0), transfers: 0, transferStops: nil, legs: legs, routeGeoJSON: nil
        )
    }

    private func makeVehicle(tripID: String, current: Int?, next: Int?, state: String, lat: Double = 0, lon: Double = 0, type: String = "train") -> Vehicle {
        let currentStop = current.map { TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "n", platform: "1", sequence: $0, childStopID: "c") }
        let nextStop = next.map { TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "n", platform: "1", sequence: $0, childStopID: "c") }
        let trip = VehicleTrip(firstStop: nil, nextStop: nextStop, finalStop: nil, currentStop: currentStop, headsign: "")
        return Vehicle(
            tripID: tripID, route: RouteSummary(id: "R", name: "R", color: "000", type: type.capitalized), trip: trip,
            occupancy: 0, licensePlate: "", position: VehiclePosition(lat: lat, lon: lon, bearing: 90),
            type: type, state: state, offCourse: false
        )
    }

    /// A standard 3-leg journey: walk to the station, ride the train, walk to the destination.
    private func makeThreeLegJourney(boardStop: Stop, alightStop: Stop, transitDeparture: Date, transitArrival: Date) -> JourneyPlan {
        let walk1 = makeLeg(mode: "walk", to: boardStop, departure: base, arrival: transitDeparture, durationSeconds: 300)
        let transit = makeLeg(mode: "transit", tripID: "T1", from: boardStop, to: alightStop, departure: transitDeparture, arrival: transitArrival, durationSeconds: transitArrival.timeIntervalSince(transitDeparture))
        let walk2 = makeLeg(mode: "walk", from: alightStop, departure: transitArrival, arrival: transitArrival.addingTimeInterval(300), durationSeconds: 300)
        return makePlan(legs: [walk1, transit, walk2])
    }

    // MARK: - The historical bug: don't advance off a transit leg early

    func testDelayedTrainDoesNotAdvanceToWalkingLegBeforeAlighting() {
        let board = makeStop(id: "board")
        let alight = makeStop(id: "alight")
        let scheduledDeparture = base.addingTimeInterval(300)
        let scheduledArrival = scheduledDeparture.addingTimeInterval(600)
        let plan = makeThreeLegJourney(boardStop: board, alightStop: alight, transitDeparture: scheduledDeparture, transitArrival: scheduledArrival)

        // "now" is 2 minutes past the transit leg's scheduled arrival - by
        // the raw clock the walking leg would already be current - but the
        // train is still live and hasn't reached the alight stop.
        let now = scheduledArrival.addingTimeInterval(120)
        let vehicle = makeVehicle(tripID: "T1", current: 3, next: 4, state: "Travelling") // mid-route, not yet at alight seq

        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: now, vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: nil
        )

        // The clock alone says leg 2 (final walk) is current...
        XCTAssertEqual(snapshot.currentLegIndex, 2)
        // ...but transitFloor holds at the transit leg because there's a
        // live vehicle for it, and guardedLegIndex/progressLegIndex must not
        // run ahead of that.
        XCTAssertEqual(snapshot.transitFloor, 1)
        XCTAssertEqual(snapshot.guardedLegIndex, 1)
        XCTAssertEqual(snapshot.progressLegIndex, 1)
        XCTAssertFalse(snapshot.journeyArrived)
    }

    func testTransitFloorAdvancesOnceAlightingIsConfirmed() {
        let board = makeStop(id: "board")
        let alight = makeStop(id: "alight")
        let scheduledDeparture = base.addingTimeInterval(300)
        let scheduledArrival = scheduledDeparture.addingTimeInterval(600)
        let plan = makeThreeLegJourney(boardStop: board, alightStop: alight, transitDeparture: scheduledDeparture, transitArrival: scheduledArrival)
        let now = scheduledArrival.addingTimeInterval(60)

        // Vehicle's current stop is now past the alight stop's sequence
        // (findStopSequence resolves "alight" -> sequence 5 in trackedStops).
        let vehicle = makeVehicle(tripID: "T1", current: 6, next: 7, state: "Travelling")
        let trackedStops = [
            TripStopRef(lat: 0, lon: 0, parentStopID: board.parentStation, name: "board", platform: "1", sequence: 3, childStopID: "board-child"),
            TripStopRef(lat: 0, lon: 0, parentStopID: alight.parentStation, name: "alight", platform: "1", sequence: 5, childStopID: "alight-child"),
        ]

        let model = JourneyProgressModel()

        // Tick 1: the ratchet latches mid-call, but transitFloor here still
        // reflects the pre-mutation state for this same tick (see update's
        // doc comment on the one-tick lag) - assert only the ratchet itself.
        _ = model.update(
            plan: plan, displayPlan: plan, now: now, vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        XCTAssertEqual(model.alightedThroughLeg, 1, "the ratchet should latch once hasDepartedStop confirms alighting")

        // Tick 2: transitFloor/progressLegIndex catch up to the now-settled ratchet.
        let settled = model.update(
            plan: plan, displayPlan: plan, now: now, vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        // transitFloor only ever names a transit leg's own index, or
        // legs.count once none remain pending - with only one transit leg
        // (now alighted), it jumps straight past the end, not to the next
        // (walking) leg's index. guardedLegIndex/progressLegIndex are what
        // actually resolve to that walking leg.
        XCTAssertEqual(settled.transitFloor, plan.legs.count)
        XCTAssertEqual(settled.progressLegIndex, 2, "the final walking leg is what the UI should show as current")
    }

    func testAlightedThroughLegRatchetNeverGoesBackwards() {
        let board = makeStop(id: "board")
        let alight = makeStop(id: "alight")
        let scheduledDeparture = base.addingTimeInterval(300)
        let scheduledArrival = scheduledDeparture.addingTimeInterval(600)
        let plan = makeThreeLegJourney(boardStop: board, alightStop: alight, transitDeparture: scheduledDeparture, transitArrival: scheduledArrival)
        let trackedStops = [
            TripStopRef(lat: 0, lon: 0, parentStopID: board.parentStation, name: "board", platform: "1", sequence: 3, childStopID: "board-child"),
            TripStopRef(lat: 0, lon: 0, parentStopID: alight.parentStation, name: "alight", platform: "1", sequence: 5, childStopID: "alight-child"),
        ]
        let model = JourneyProgressModel()

        // Tick 1: confirmed past the alight stop.
        _ = model.update(
            plan: plan, displayPlan: plan, now: scheduledArrival.addingTimeInterval(60),
            vehiclesByTripID: ["T1": makeVehicle(tripID: "T1", current: 6, next: 7, state: "Travelling")],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        XCTAssertEqual(model.alightedThroughLeg, 1)

        // Tick 2: the vehicle feed drops out entirely (e.g. trip ended) -
        // the ratchet must hold, not reset.
        let snapshot2 = model.update(
            plan: plan, displayPlan: plan, now: scheduledArrival.addingTimeInterval(120),
            vehiclesByTripID: [:], stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: nil
        )
        XCTAssertEqual(model.alightedThroughLeg, 1)
        XCTAssertEqual(snapshot2.transitFloor, plan.legs.count)
    }

    // MARK: - Phase machine

    func testWalkingPhaseBeforeReachingBoardStop() {
        let board = makeStop(id: "board")
        let plan = makePlan(legs: [makeLeg(mode: "walk", to: board, departure: base, arrival: base.addingTimeInterval(300), durationSeconds: 300)])
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base.addingTimeInterval(60), vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: nil
        )
        XCTAssertEqual(snapshot.phase, .walking)
    }

    func testWaitingPhaseAtBoardStopBeforeVehicleDeparts() {
        let board = makeStop(id: "board", lat: -36.85, lon: 174.76)
        let walk = makeLeg(mode: "walk", to: board, departure: base, arrival: base.addingTimeInterval(300), durationSeconds: 300)
        let transit = makeLeg(mode: "transit", tripID: "T1", from: board, to: makeStop(id: "alight"), departure: base.addingTimeInterval(300), arrival: base.addingTimeInterval(900))
        let plan = makePlan(legs: [walk, transit])
        let model = JourneyProgressModel()

        // Rider is standing at the board stop (hysteresis enter distance),
        // well before the transit leg's scheduled departure (base+300) minus
        // the 90s boarding window - so with no live vehicle, the phase comes
        // from the walk leg still being clock-current, not the schedule
        // fallback (which would itself say "boarding" once within 90s of
        // that departure - tested separately).
        let atStop = Coordinate(latitude: -36.85, longitude: 174.76)

        // Tick 1: atBoardStop's hysteresis flips true mid-call, but phase
        // here still reflects the pre-mutation (false) state for this same
        // tick (see update's doc comment on the one-tick lag).
        _ = model.update(
            plan: plan, displayPlan: plan, now: base.addingTimeInterval(280), vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: atStop
        )
        XCTAssertTrue(model.atBoardStop)

        // Tick 2: phase catches up to the now-settled hysteresis.
        let settled = model.update(
            plan: plan, displayPlan: plan, now: base.addingTimeInterval(285), vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: atStop
        )
        XCTAssertEqual(settled.phase, .waiting)
    }

    func testBoardingPhaseWhenNoLiveVehicleButWithinBoardingWindow() {
        let board = makeStop(id: "board")
        let transit = makeLeg(mode: "transit", tripID: "T1", from: board, to: makeStop(id: "alight"), departure: base.addingTimeInterval(60), arrival: base.addingTimeInterval(660))
        let plan = makePlan(legs: [transit])
        let model = JourneyProgressModel()
        // 60s before the scheduled departure, well within the 90s boarding window, no live vehicle.
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base, vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: nil
        )
        XCTAssertEqual(snapshot.phase, .boarding)
        XCTAssertEqual(snapshot.trackingLevel, .scheduled)
    }

    func testBoardingPhaseWhenBusIsWithinProximityThreshold() {
        let board = makeStop(id: "board", lat: 0, lon: 0)
        let transit = makeLeg(mode: "transit", tripID: "T1", from: board, to: makeStop(id: "alight"), departure: base, arrival: base.addingTimeInterval(600))
        let plan = makePlan(legs: [transit])
        let trackedStops = [TripStopRef(lat: 0, lon: 0, parentStopID: board.parentStation, name: "board", platform: "1", sequence: 3, childStopID: "board-child")]

        // Bus is ~300m away (within the 350m bus threshold), next stop is the board stop.
        let vehicle = makeVehicle(tripID: "T1", current: 2, next: 3, state: "Travelling", lat: 0.0027, lon: 0, type: "bus")
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base, vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        XCTAssertEqual(snapshot.phase, .boarding)
    }

    func testWaitingPhaseWhenBusIsTooFarEvenIfNextStopIsBoard() {
        let board = makeStop(id: "board", lat: 0, lon: 0)
        let transit = makeLeg(mode: "transit", tripID: "T1", from: board, to: makeStop(id: "alight"), departure: base, arrival: base.addingTimeInterval(600))
        let plan = makePlan(legs: [transit])
        let trackedStops = [TripStopRef(lat: 0, lon: 0, parentStopID: board.parentStation, name: "board", platform: "1", sequence: 3, childStopID: "board-child")]

        // Bus is ~1.1km away - beyond the 350m bus threshold.
        let vehicle = makeVehicle(tripID: "T1", current: 2, next: 3, state: "Travelling", lat: 0.01, lon: 0, type: "bus")
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base, vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        XCTAssertEqual(snapshot.phase, .waiting)
    }

    func testOnboardPhaseOnceBoarded() {
        let board = makeStop(id: "board")
        let transit = makeLeg(mode: "transit", tripID: "T1", from: board, to: makeStop(id: "alight"), departure: base, arrival: base.addingTimeInterval(600))
        let plan = makePlan(legs: [transit])
        let trackedStops = [TripStopRef(lat: 0, lon: 0, parentStopID: board.parentStation, name: "board", platform: "1", sequence: 3, childStopID: "board-child")]

        // Vehicle has passed the board stop's sequence and is moving.
        let vehicle = makeVehicle(tripID: "T1", current: 4, next: 5, state: "Travelling")
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base.addingTimeInterval(120), vehiclesByTripID: ["T1": vehicle],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: trackedStops, userLocation: nil
        )
        XCTAssertTrue(snapshot.boarded)
        XCTAssertEqual(snapshot.phase, .onboard)
        XCTAssertEqual(snapshot.trackingLevel, .live)
    }

    // MARK: - Not started / arrived

    func testNoPhaseOrProgressBeforeJourneyStarted() {
        let plan = makePlan(legs: [makeLeg(mode: "walk", departure: base, arrival: base.addingTimeInterval(300), durationSeconds: 300)])
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base, vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: false, trackedStops: [], userLocation: nil
        )
        XCTAssertNil(snapshot.phase)
        XCTAssertEqual(snapshot.progressLegIndex, -1)
        XCTAssertFalse(snapshot.journeyArrived)
    }

    func testJourneyArrivedOnceLastLegAndTransitFloorAgree() {
        let plan = makePlan(legs: [makeLeg(mode: "walk", departure: base, arrival: base.addingTimeInterval(300), durationSeconds: 300)])
        let model = JourneyProgressModel()
        let snapshot = model.update(
            plan: plan, displayPlan: plan, now: base.addingTimeInterval(301), vehiclesByTripID: [:],
            stopTimesByTripID: [:], journeyStarted: true, trackedStops: [], userLocation: nil
        )
        XCTAssertTrue(snapshot.journeyArrived)
        XCTAssertEqual(snapshot.progressLegIndex, 1, "arrived means the progress index runs one past the last leg")
    }
}
