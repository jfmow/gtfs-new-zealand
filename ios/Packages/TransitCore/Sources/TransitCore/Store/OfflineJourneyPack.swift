import Foundation

/// Everything a tracked journey needs with no connection, downloaded while
/// the rider still has one (typically on home wifi, before leaving): the
/// plan itself, each ride's stop list (with coordinates - what
/// `OfflineRideEstimator` matches the rider's GPS against), the last
/// realtime predictions, each ride's route shape and turn-by-turn
/// directions for each walk.
///
/// Kept up to date on every successful poll, so going offline mid-journey
/// keeps the latest predictions rather than the ones from the start.
public struct OfflineJourneyPack: Codable, Sendable {
    public var plan: JourneyPlan
    public var regionSlug: String
    public var tripStops: [String: [TripStopRef]] = [:]
    public var stopTimes: [String: [StopTimeUpdate]] = [:]
    public var rideShapes: [String: RouteShape] = [:]
    /// By leg index.
    public var walkDirections: [Int: WalkingDirections] = [:]
    /// Boarded / got off, as worked out from GPS - optional so packs saved
    /// before it existed still load.
    public var rides: [String: OfflineRideEstimator.Progress]?
    public var savedAt: Date

    public init(plan: JourneyPlan, regionSlug: String, savedAt: Date = Date()) {
        self.plan = plan
        self.regionSlug = regionSlug
        self.savedAt = savedAt
    }

    /// Every ride has its stop list - the one thing GPS tracking can't
    /// do without.
    public var isComplete: Bool {
        plan.transitLegs.allSatisfy { !(tripStops[$0.tripID] ?? []).isEmpty }
    }

    /// The walk legs' start and end, for fetching their directions: the
    /// plan's own start/end stand in for a walk from or to an address.
    public static func walkEndpoints(_ plan: JourneyPlan) -> [(index: Int, from: Coordinate, to: Coordinate)] {
        plan.legs.indices.compactMap { index in
            let leg = plan.legs[index]
            guard leg.mode == "walk" else { return nil }
            let from = leg.fromStop?.coordinate ?? (index == 0 ? Coordinate(latitude: plan.startLat, longitude: plan.startLon) : nil)
            let to = leg.toStop?.coordinate ?? (index == plan.legs.count - 1 ? Coordinate(latitude: plan.endLat, longitude: plan.endLon) : nil)
            guard let from, let to else { return nil }
            return (index, from, to)
        }
    }
}

/// One JSON file per journey, in Application Support.
public struct OfflineJourneyStore: Sendable {
    public let directory: URL

    public init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineJourneys", isDirectory: true)
    }

    private func url(planID: String) -> URL {
        let safe = planID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? planID
        return directory.appendingPathComponent("\(safe).json")
    }

    public func load(planID: String) -> OfflineJourneyPack? {
        guard let data = try? Data(contentsOf: url(planID: planID)) else { return nil }
        return try? JSONDecoder().decode(OfflineJourneyPack.self, from: data)
    }

    public func save(_ pack: OfflineJourneyPack) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(pack)
            try data.write(to: url(planID: pack.plan.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            // Best-effort: without it the journey just needs a connection.
        }
    }

    public func delete(planID: String) {
        try? FileManager.default.removeItem(at: url(planID: planID))
    }

    /// Removes every pack but `keeping` - only one journey is tracked at a time.
    public func deleteAll(keeping planID: String? = nil) {
        let keep = planID.map { url(planID: $0).lastPathComponent }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.lastPathComponent != keep {
            try? FileManager.default.removeItem(at: file)
        }
    }
}
