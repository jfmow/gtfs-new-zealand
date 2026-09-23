import XCTest
@testable import TransitCore

final class VehicleProgressRatchetTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(next: Int, state: String, lat: Double = 0) -> Vehicle {
        func stop(_ seq: Int) -> TripStopRef {
            TripStopRef(lat: 0, lon: 0, parentStopID: "p\(seq)", name: "Stop \(seq)", platform: "", sequence: seq, childStopID: "c\(seq)")
        }
        return Vehicle(
            tripID: "T1", route: RouteSummary(id: "R", name: "70", color: "", type: "Bus"),
            trip: VehicleTrip(firstStop: nil, nextStop: stop(next), finalStop: nil, currentStop: stop(next - 1), headsign: ""),
            occupancy: 1, licensePlate: "", position: VehiclePosition(lat: lat, lon: 0, bearing: 0),
            type: "bus", state: state, offCourse: false
        )
    }

    func testForwardProgressPassesThrough() {
        let ratchet = VehicleProgressRatchet()
        XCTAssertEqual(ratchet.apply(vehicle(next: 5, state: "Arriving"), now: base).trip?.nextStop?.sequence, 5)
        XCTAssertEqual(ratchet.apply(vehicle(next: 6, state: "AtStop"), now: base.addingTimeInterval(10)).trip?.nextStop?.sequence, 6)
    }

    func testABriefStepBackIsHeld() {
        // STOPPED_AT stop 5 (next 6), then the feed says INCOMING_AT 5 again.
        let ratchet = VehicleProgressRatchet()
        ratchet.apply(vehicle(next: 6, state: "AtStop"), now: base)
        let flicker = ratchet.apply(vehicle(next: 5, state: "Arriving", lat: 1), now: base.addingTimeInterval(10))
        XCTAssertEqual(flicker.trip?.nextStop?.sequence, 6)
        XCTAssertEqual(flicker.state, "AtStop")
        XCTAssertEqual(flicker.position.lat, 1, "still the newest position")
    }

    func testAStepBackThatLastsIsBelieved() {
        let ratchet = VehicleProgressRatchet()
        ratchet.apply(vehicle(next: 6, state: "AtStop"), now: base)
        ratchet.apply(vehicle(next: 5, state: "Arriving"), now: base.addingTimeInterval(10))
        let later = ratchet.apply(vehicle(next: 5, state: "Arriving"), now: base.addingTimeInterval(31))
        XCTAssertEqual(later.trip?.nextStop?.sequence, 5)
    }

    func testMovingOnClearsAHeldStepBack() {
        let ratchet = VehicleProgressRatchet()
        ratchet.apply(vehicle(next: 6, state: "AtStop"), now: base)
        ratchet.apply(vehicle(next: 5, state: "Arriving"), now: base.addingTimeInterval(10))
        XCTAssertEqual(ratchet.apply(vehicle(next: 7, state: "Travelling"), now: base.addingTimeInterval(20)).trip?.nextStop?.sequence, 7)
        // A fresh flicker after that gets its own full hold.
        XCTAssertEqual(ratchet.apply(vehicle(next: 6, state: "Arriving"), now: base.addingTimeInterval(35)).trip?.nextStop?.sequence, 7)
    }
}
