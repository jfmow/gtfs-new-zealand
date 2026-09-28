import Foundation
import SwiftData

/// Tidies the synced models after iCloud merges another device's changes.
///
/// CloudKit has no uniqueness constraints and merges record by record, so
/// two devices that both saved "Britomart" (or both set up "Home") before
/// they first synced end up with two copies each, and drag-reorders made on
/// two devices leave tied or gappy `sortOrder`s. This merges duplicates and
/// renumbers. It writes nothing when there's nothing to fix, so its own
/// save (which syncs back out) settles after one pass.
public enum SyncHygiene {
    /// Returns true if it changed (and saved) anything.
    @MainActor @discardableResult
    public static func run(in context: ModelContext) throws -> Bool {
        var changed = false
        changed = try dedupe(FavouriteStop.self, in: context, created: \.createdAt) || changed
        changed = try dedupe(SavedPlace.self, in: context, created: \.createdAt) || changed
        changed = try dedupe(SavedTrip.self, in: context, created: \.savedAt) || changed

        let stops = try context.fetch(FetchDescriptor<FavouriteStop>())
        changed = renumber(stops, created: \.createdAt) || changed
        let trips = try context.fetch(FetchDescriptor<SavedTrip>())
        changed = renumber(trips, created: \.savedAt) || changed
        // Places are listed (and reordered) per region.
        let places = try context.fetch(FetchDescriptor<SavedPlace>())
        for regionPlaces in Dictionary(grouping: places, by: \.regionSlug).values {
            changed = renumber(regionPlaces, created: \.createdAt) || changed
        }

        if changed { try context.save() }
        return changed
    }

    /// Keeps the earliest-created copy of each `dedupeKey`. The choice must
    /// come out the same on every device - each one runs this on its own
    /// copy, and if two picked different survivors both would be deleted -
    /// so ties break on content, never on local ids.
    @MainActor
    private static func dedupe<M: PersistentModel & SyncDeduplicable>(
        _ type: M.Type, in context: ModelContext, created: KeyPath<M, Date>
    ) throws -> Bool {
        let all = try context.fetch(FetchDescriptor<M>())
        var changed = false
        for group in Dictionary(grouping: all, by: \.dedupeKey).values where group.count > 1 {
            let ordered = group.sorted {
                ($0[keyPath: created], $0.contentFingerprint) < ($1[keyPath: created], $1.contentFingerprint)
            }
            for duplicate in ordered.dropFirst() { context.delete(duplicate) }
            changed = true
        }
        return changed
    }

    /// Renumbers `sortOrder` to 0..<n, keeping the current order (ties
    /// broken oldest first). Only touches rows whose number changes.
    private static func renumber<M: SyncDeduplicable>(_ models: [M], created: KeyPath<M, Date>) -> Bool {
        let ordered = models.filter { !$0.isDeleted }.sorted {
            ($0.sortOrder, $0[keyPath: created], $0.dedupeKey) < ($1.sortOrder, $1[keyPath: created], $1.dedupeKey)
        }
        var changed = false
        for (index, model) in ordered.enumerated() where model.sortOrder != index {
            model.sortOrder = index
            changed = true
        }
        return changed
    }
}

/// What makes two synced rows "the same thing" to the rider.
public protocol SyncDeduplicable: PersistentModel {
    var dedupeKey: String { get }
    /// Every user-visible field, to order exact-timestamp ties identically
    /// on every device.
    var contentFingerprint: String { get }
    var sortOrder: Int { get set }
}

extension FavouriteStop: SyncDeduplicable {
    public var dedupeKey: String { stopID }
    public var contentFingerprint: String { "\(stopID)|\(displayName)|\(colorHex)" }
}

extension SavedPlace: SyncDeduplicable {
    /// Matches `SharedStore.SavedPlace.id` (case-insensitive): one "Home"
    /// per region.
    public var dedupeKey: String { "\(regionSlug)/\(name.lowercased())" }
    public var contentFingerprint: String { "\(dedupeKey)|\(address)|\(latitude),\(longitude)|\(icon)" }
}

extension SavedTrip: SyncDeduplicable {
    /// Same name, same ends (to ~10m).
    public var dedupeKey: String {
        let ends = [startLat, startLon, endLat, endLon].map { String(format: "%.4f", $0) }.joined(separator: ",")
        return "\(name.lowercased())|\(ends)"
    }
    public var contentFingerprint: String {
        "\(dedupeKey)|\(startLabel)|\(endLabel)|\(maxWalkKm)|\(walkSpeed)|\(maxTransfers)|\(colorHex)|\(onlyRouteIDs)|\(modes)|\(minResults)|\(minTransferSec)"
    }
}

extension ModelContext {
    /// Call before inserting a newly saved trip: an existing trip with the
    /// same name and ends is replaced (keeping its place and colour) rather
    /// than left for `SyncHygiene` to merge - which would keep the old one.
    public func replaceExistingCopy(of trip: SavedTrip) {
        let key = trip.dedupeKey
        let existing = ((try? fetch(FetchDescriptor<SavedTrip>())) ?? [])
            .filter { $0 !== trip && $0.dedupeKey == key }
            .sorted { $0.sortOrder < $1.sortOrder }
        guard let first = existing.first else { return }
        trip.sortOrder = first.sortOrder
        trip.colorHex = first.colorHex
        existing.forEach(delete)
    }
}
