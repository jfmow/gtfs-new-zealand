import Foundation
import SwiftData

/// Builds the app's SwiftData container: two stores in one container.
///
/// - **Synced** - saved stops, places and trips, mirrored to the rider's
///   private iCloud database. It lives where SwiftData's default
///   configuration put the store before sync (`storeDirectory`), so an
///   install from before iCloud sync keeps its data and uploads it on the
///   first launch.
/// - **Local** - the active journey, which is tied to this device (its Live
///   Activity, GPS session and offline pack) and never syncs.
///
/// Signed out of iCloud, or Transit's iCloud switch off, the synced store
/// just works locally and catches up once iCloud is available.
public enum TransitStore {
    public static let cloudKitContainerID = "iCloud.dev.suddsy.transit"

    public static let syncedModels: [any PersistentModel.Type] = [FavouriteStop.self, SavedPlace.self, SavedTrip.self]
    public static let localModels: [any PersistentModel.Type] = [ActiveJourney.self]

    public enum Mode {
        /// On disk, synced models mirrored to iCloud.
        case cloudSynced
        /// On disk, nothing leaves the device - UI tests, or the fallback
        /// if the CloudKit-backed store won't open.
        case localOnly
        /// Previews and unit tests.
        case inMemory
    }

    /// Where the stores live: SwiftData's default (`groupContainer:
    /// .automatic`) is the first app group's Library/Application Support,
    /// which is where every existing install's `default.store` is.
    public static func storeDirectory(appGroup: String) -> URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appending(path: "Library/Application Support") ?? .applicationSupportDirectory
    }

    public static func makeContainer(_ mode: Mode, directory: URL = .applicationSupportDirectory) throws -> ModelContainer {
        let schema = Schema(syncedModels + localModels)
        let synced: ModelConfiguration
        let local: ModelConfiguration
        switch mode {
        case .inMemory:
            synced = ModelConfiguration("Synced", schema: Schema(syncedModels), isStoredInMemoryOnly: true, cloudKitDatabase: .none)
            local = ModelConfiguration("Local", schema: Schema(localModels), isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        case .cloudSynced, .localOnly:
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            synced = ModelConfiguration(
                "Synced",
                schema: Schema(syncedModels),
                url: directory.appending(path: "default.store"),
                cloudKitDatabase: mode == .cloudSynced ? .private(cloudKitContainerID) : .none
            )
            local = ModelConfiguration(
                "Local",
                schema: Schema(localModels),
                url: directory.appending(path: "local.store"),
                cloudKitDatabase: .none
            )
        }
        return try ModelContainer(for: schema, configurations: synced, local)
    }
}
