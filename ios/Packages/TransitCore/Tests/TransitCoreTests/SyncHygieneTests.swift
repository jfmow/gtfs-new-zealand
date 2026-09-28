import SwiftData
import XCTest
@testable import TransitCore

@MainActor
final class SyncHygieneTests: XCTestCase {
    private var container: ModelContainer!
    private var context: ModelContext { container.mainContext }

    override func setUp() async throws {
        container = try TransitStore.makeContainer(.inMemory)
    }

    private let britomart = Coordinate(latitude: -36.8442, longitude: 174.7645)
    private let ponsonby = Coordinate(latitude: -36.8570, longitude: 174.7400)

    func testDuplicateStopsKeepTheOldest() throws {
        context.insert(FavouriteStop(stopID: "133", displayName: "Britomart (iPad)", colorHex: "aaa", sortOrder: 0, createdAt: Date(timeIntervalSince1970: 200)))
        context.insert(FavouriteStop(stopID: "133", displayName: "Britomart", colorHex: "bbb", sortOrder: 0, createdAt: Date(timeIntervalSince1970: 100)))
        context.insert(FavouriteStop(stopID: "8000", displayName: "Newmarket", colorHex: "ccc", sortOrder: 1, createdAt: Date(timeIntervalSince1970: 150)))

        XCTAssertTrue(try SyncHygiene.run(in: context))

        let stops = try context.fetch(FetchDescriptor<FavouriteStop>(sortBy: [SortDescriptor(\.sortOrder)]))
        XCTAssertEqual(stops.map(\.displayName), ["Britomart", "Newmarket"])
        XCTAssertEqual(stops.map(\.sortOrder), [0, 1])
    }

    func testSecondRunChangesNothing() throws {
        context.insert(FavouriteStop(stopID: "133", displayName: "A", colorHex: "a", sortOrder: 3))
        context.insert(FavouriteStop(stopID: "133", displayName: "A", colorHex: "a", sortOrder: 3))
        XCTAssertTrue(try SyncHygiene.run(in: context))
        XCTAssertFalse(try SyncHygiene.run(in: context))
    }

    func testTiedTimestampsPickTheSameSurvivorWhateverTheInsertOrder() throws {
        let when = Date(timeIntervalSince1970: 100)
        for names in [["Home A", "Home B"], ["Home B", "Home A"]] {
            container = try TransitStore.makeContainer(.inMemory)
            for name in names {
                // Same key ("at/home"), different address.
                context.insert(SavedPlace(name: "Home", address: name, coordinate: britomart, icon: "home", regionSlug: "at", sortOrder: 0, createdAt: when))
            }
            try SyncHygiene.run(in: context)
            XCTAssertEqual(try context.fetch(FetchDescriptor<SavedPlace>()).map(\.address), ["Home A"])
        }
    }

    func testPlacesDedupeCaseInsensitivelyButPerRegion() throws {
        context.insert(SavedPlace(name: "Home", address: "1", coordinate: britomart, icon: "home", regionSlug: "at", sortOrder: 0, createdAt: Date(timeIntervalSince1970: 1)))
        context.insert(SavedPlace(name: "home", address: "2", coordinate: britomart, icon: "home", regionSlug: "at", sortOrder: 1, createdAt: Date(timeIntervalSince1970: 2)))
        context.insert(SavedPlace(name: "Home", address: "3", coordinate: britomart, icon: "home", regionSlug: "metlink", sortOrder: 0, createdAt: Date(timeIntervalSince1970: 3)))

        try SyncHygiene.run(in: context)

        let places = try context.fetch(FetchDescriptor<SavedPlace>(sortBy: [SortDescriptor(\.address)]))
        XCTAssertEqual(places.map(\.address), ["1", "3"])
        // Numbered within each region.
        XCTAssertEqual(places.map(\.sortOrder), [0, 0])
    }

    func testTripsDedupeOnNameAndEnds() throws {
        func trip(_ name: String, end: Coordinate, savedAt: TimeInterval) -> SavedTrip {
            let trip = SavedTrip(name: name, startLabel: "Britomart", startCoordinate: britomart, endLabel: "End", endCoordinate: end, colorHex: "a")
            trip.savedAt = Date(timeIntervalSince1970: savedAt)
            return trip
        }
        context.insert(trip("Work", end: ponsonby, savedAt: 1))
        context.insert(trip("Work", end: Coordinate(latitude: ponsonby.latitude + 0.00001, longitude: ponsonby.longitude), savedAt: 2))
        context.insert(trip("Work", end: britomart, savedAt: 3))
        context.insert(trip("Gym", end: ponsonby, savedAt: 4))

        try SyncHygiene.run(in: context)

        let trips = try context.fetch(FetchDescriptor<SavedTrip>(sortBy: [SortDescriptor(\.savedAt)]))
        XCTAssertEqual(trips.map(\.savedAt.timeIntervalSince1970), [1, 3, 4])
    }

    func testRenumberKeepsOrderAndBreaksTiesOldestFirst() throws {
        context.insert(FavouriteStop(stopID: "c", displayName: "C", colorHex: "", sortOrder: 7, createdAt: Date(timeIntervalSince1970: 1)))
        context.insert(FavouriteStop(stopID: "b", displayName: "B", colorHex: "", sortOrder: 2, createdAt: Date(timeIntervalSince1970: 5)))
        context.insert(FavouriteStop(stopID: "a", displayName: "A", colorHex: "", sortOrder: 2, createdAt: Date(timeIntervalSince1970: 3)))

        try SyncHygiene.run(in: context)

        let stops = try context.fetch(FetchDescriptor<FavouriteStop>(sortBy: [SortDescriptor(\.sortOrder)]))
        XCTAssertEqual(stops.map(\.stopID), ["a", "b", "c"])
    }

    func testOnDiskStoresAreSeparateFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }

        let container = try TransitStore.makeContainer(.localOnly, directory: directory)
        container.mainContext.insert(FavouriteStop(stopID: "133", displayName: "Britomart", colorHex: "a", sortOrder: 0))
        container.mainContext.insert(ActiveJourney(planID: "p", regionSlug: "at", endLabel: "Home", arrivalTime: Date()))
        try container.mainContext.save()

        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appending(path: "default.store").path()))
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appending(path: "local.store").path()))

        let reopened = try TransitStore.makeContainer(.localOnly, directory: directory)
        XCTAssertEqual(try reopened.mainContext.fetchCount(FetchDescriptor<FavouriteStop>()), 1)
        XCTAssertEqual(try reopened.mainContext.fetchCount(FetchDescriptor<ActiveJourney>()), 1)
    }
}

@MainActor
final class ReplaceExistingTripTests: XCTestCase {
    func testResavingATripReplacesTheOldCopyInPlace() throws {
        let container = try TransitStore.makeContainer(.inMemory)
        let context = container.mainContext
        let a = Coordinate(latitude: -36.8442, longitude: 174.7645)
        let b = Coordinate(latitude: -36.8570, longitude: 174.7400)
        context.insert(SavedTrip(name: "Gym", startLabel: "", startCoordinate: a, endLabel: "", endCoordinate: b, colorHex: "x", sortOrder: 0))
        let old = SavedTrip(name: "Work", startLabel: "", startCoordinate: a, endLabel: "", endCoordinate: b, maxWalkKm: 1, colorHex: "red", sortOrder: 1)
        context.insert(old)

        let new = SavedTrip(name: "Work", startLabel: "", startCoordinate: a, endLabel: "", endCoordinate: b, maxWalkKm: 2, colorHex: "blue", sortOrder: 2)
        context.replaceExistingCopy(of: new)
        context.insert(new)
        try context.save()

        let trips = try context.fetch(FetchDescriptor<SavedTrip>(sortBy: [SortDescriptor(\.sortOrder)]))
        XCTAssertEqual(trips.map(\.name), ["Gym", "Work"])
        XCTAssertEqual(trips[1].maxWalkKm, 2)
        XCTAssertEqual(trips[1].colorHex, "red")
        XCTAssertEqual(trips[1].sortOrder, 1)
    }
}
