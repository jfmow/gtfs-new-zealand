import XCTest
@testable import TransitCore

/// Decodes JSON fixtures captured from the live `https://trainapi.suddsy.dev/at`
/// API (2026-09-22) - these exist so a future backend response-shape change
/// is caught here first, not as a runtime crash in the app.
final class ModelDecodingTests: XCTestCase {
    func testDecodeStop() throws {
        let stop = try JSONDecoder().decode(Stop.self, from: FixtureLoader.data("stop"))
        XCTAssertEqual(stop.stopName, "Papatoetoe Train Station")
        XCTAssertEqual(stop.stopCode, "100")
        XCTAssertEqual(stop.stopType, "train")
        XCTAssertFalse(stop.isChildStop)
        XCTAssertEqual(stop.coordinate.latitude, -36.97766, accuracy: 0.0001)
    }

    /// Regression test for a real bug (found 2026-09-22): `boundingBox` was
    /// typed `[Double]?` but the live API sends it as an array of numeric
    /// *strings*, so any address/POI result with a populated bounding box
    /// failed to decode - which, since this decodes as part of an array,
    /// failed the whole array and made the planner's address search look
    /// like it silently found nothing for every real query.
    func testDecodeLocationSearchResults() throws {
        let results = try JSONDecoder().decode([LocationSearchResult].self, from: FixtureLoader.data("location_search"))
        XCTAssertEqual(results.count, 2)
        XCTAssertEqual(results[1].label, "Westfield Newmarket 277 Broadway Newmarket Auckland 1023 New Zealand / Aotearoa")
        XCTAssertEqual(results[1].boundingBox?.count, 4)
        XCTAssertEqual(results[1].coordinate.latitude, -36.8708593, accuracy: 0.0001)
    }

    func testDecodeDeparture() throws {
        let departure = try JSONDecoder().decode(Departure.self, from: FixtureLoader.data("departure"))
        XCTAssertFalse(departure.tripID.isEmpty)
        XCTAssertEqual(departure.route.id, "S-C-201")
        XCTAssertEqual(departure.stop.parentStopID, "100-56c57897")
        // A row with both tracking flags set, not cancelled/skipped/departed,
        // must be tappable.
        if !departure.canceled, !departure.skipped, !departure.departed,
           departure.locationTracking || departure.tripUpdateTracking {
            XCTAssertTrue(departure.isTrackable)
        }
    }

    func testDecodeJourneyPlan() throws {
        let plan = try JSONDecoder().decode(JourneyPlan.self, from: FixtureLoader.data("journey_plan"))
        XCTAssertFalse(plan.id.isEmpty)
        XCTAssertEqual(plan.legs.count, 3)
        XCTAssertEqual(plan.legs.first?.mode, "walk")
        XCTAssertEqual(plan.transitLegs.count, 1)

        let transitLeg = try XCTUnwrap(plan.transitLegs.first)
        XCTAssertNotNil(transitLeg.route)
        XCTAssertNotNil(transitLeg.fromStop)
        XCTAssertNotNil(transitLeg.toStop)
        XCTAssertNotNil(transitLeg.realtimeStatus)
        // delay_seconds is `omitempty` on the Go side - this capture's leg is
        // "on_time" with exactly 0 delay, so the key is dropped entirely and
        // must decode to nil here, not throw. Display logic should treat a
        // present realtimeStatus + nil delaySeconds as a 0s delay.
        XCTAssertEqual(transitLeg.realtimeStatus, "on_time")
        XCTAssertNil(transitLeg.delaySeconds)
        XCTAssertNotNil(transitLeg.scheduledDepartureTime.date, "a transit leg has a real schedule")

        // The first leg is a walk leg - its schedule fields are Go's zero
        // time and must decode to nil, not a bogus 1st-century date.
        let walkLeg = try XCTUnwrap(plan.legs.first)
        XCTAssertNil(walkLeg.scheduledDepartureTime.date)
        XCTAssertNotNil(walkLeg.departureTime.date, "the realtime-adjusted time is always real, even on a walk leg")

        XCTAssertGreaterThan(plan.totalDuration.timeInterval, 0)
        XCTAssertNotNil(plan.routeGeoJSON)
        XCTAssertFalse(plan.routeGeoJSON?.features.isEmpty ?? true)
    }

    func testDecodeStopsArrayFromEnvelopeShape() throws {
        // Simulates the actual wire envelope ({code,message,data,trace_id})
        // around a single-stop array, since APIClient decodes through
        // Envelope<T> rather than the bare fixture.
        let stopJSON = try FixtureLoader.data("stop")
        var envelope = try XCTUnwrap(String(data: stopJSON, encoding: .utf8))
        envelope = "{\"code\":200,\"message\":\"\",\"data\":[\(envelope)],\"trace_id\":\"abc\"}"

        struct Envelope: Decodable { let code: Int; let data: [Stop] }
        let decoded = try JSONDecoder().decode(Envelope.self, from: Data(envelope.utf8))
        XCTAssertEqual(decoded.code, 200)
        XCTAssertEqual(decoded.data.count, 1)
    }
}
