import XCTest
@testable import TransitCore

final class DepartureBoardTests: XCTestCase {
    private func makeDeparture(
        tripID: String,
        timeTillArrival: Double,
        departed: Bool = false,
        canceled: Bool = false,
        skipped: Bool = false
    ) -> Departure {
        Departure(
            tripID: tripID, headsign: "Test", arrivalTime: "12:00:00", platform: "1",
            stopsAway: 0, occupancy: 0, canceled: canceled, skipped: skipped,
            bikesAllowed: 0, wheelchairsAllowed: 0,
            route: RouteSummary(id: "R", name: "R", color: "000000", type: nil),
            stop: TripStopRef(lat: 0, lon: 0, parentStopID: "p", name: "n", platform: "1", sequence: 0, childStopID: "c"),
            locationTracking: true, tripUpdateTracking: true, departed: departed,
            timeTillArrival: timeTillArrival, stopState: "Unknown", tripStarted: true, platformChanged: false
        )
    }

    func testDropsRowsWellPastArrival() {
        let departures = [
            makeDeparture(tripID: "a", timeTillArrival: -1),   // kept: within -2 min grace
            makeDeparture(tripID: "b", timeTillArrival: -3),   // dropped: past -2 min grace, not cancelled
            makeDeparture(tripID: "c", timeTillArrival: -15, canceled: true), // kept: cancelled grace is -20
            makeDeparture(tripID: "d", timeTillArrival: -25, skipped: true),  // dropped: past -20 min grace
        ]
        // Both survive filtering (neither "departed"), so they sort by
        // ascending timeTillArrival like any other pair: -15 before -1.
        let result = DepartureBoard.filterAndSort(departures).map(\.tripID)
        XCTAssertEqual(result, ["c", "a"])
    }

    func testDepartedRowsSortFirstThenAscendingTimeTillArrival() {
        let departures = [
            makeDeparture(tripID: "future-far", timeTillArrival: 20),
            makeDeparture(tripID: "departed", timeTillArrival: -1, departed: true),
            makeDeparture(tripID: "future-near", timeTillArrival: 5),
        ]
        let result = DepartureBoard.filterAndSort(departures).map(\.tripID)
        XCTAssertEqual(result, ["departed", "future-near", "future-far"])
    }
}
