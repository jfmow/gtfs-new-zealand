import ActivityKit
import ExpoModulesCore
import SQLite3
import WidgetKit

/// The native side of the Expo app on iOS - what iOS `LiveActivityCoordinator`
/// and `SharedStore` did: start/update/end the journey Live Activity, stream
/// its push and push-to-start tokens, adopt activities the server
/// push-started, and write the app group the widgets and Siri read.
public class TransitNativeModule: Module {
    private static let appGroup = "group.dev.suddsy.transit"
    private var observers: [Task<Void, Never>] = []
    private var cloudObserver: NSObjectProtocol?

    public func definition() -> ModuleDefinition {
        Name("TransitNative")

        Events("onActivityPushToken", "onPushToStartToken", "onActivityStarted", "onActivityEnded", "onTripActivityPushToken", "onTripActivityEnded", "onCloudChange")

        OnStartObserving {
            self.startObserving()
        }

        OnStopObserving {
            self.observers.forEach { $0.cancel() }
            self.observers = []
            self.watchedTrips = []
            if let cloudObserver = self.cloudObserver { NotificationCenter.default.removeObserver(cloudObserver) }
            self.cloudObserver = nil
        }

        // MARK: app group

        Function("setSharedString") { (key: String, value: String?) in
            let defaults = UserDefaults(suiteName: Self.appGroup)
            defaults?.set(value, forKey: key)
        }

        /// JSON stored as Data - the shape `SharedStore` decodes.
        Function("setSharedJSON") { (key: String, json: String) in
            UserDefaults(suiteName: Self.appGroup)?.set(Data(json.utf8), forKey: key)
        }

        Function("reloadWidgets") {
            WidgetCenter.shared.reloadAllTimelines()
        }

        // MARK: migration from the SwiftUI app (plans/expo-app.md phase 7)

        /// The SwiftUI app's saved stops, places and trips, read straight from
        /// its SwiftData store (`default.store` in the app group) - plus the
        /// region it last had selected. Nil when there's no store.
        Function("readLegacyStore") { () -> [String: Any]? in
            Self.readLegacyStore()
        }

        // MARK: iCloud sync (src/lib/cloud-sync.ts)

        // Saved stops, places and trips sync through the iCloud key-value
        // store - one JSON document per kind; the merging happens in JS.

        Function("cloudGet") { (key: String) -> String? in
            NSUbiquitousKeyValueStore.default.string(forKey: key)
        }

        Function("cloudSet") { (key: String, json: String) in
            NSUbiquitousKeyValueStore.default.set(json, forKey: key)
            NSUbiquitousKeyValueStore.default.synchronize()
        }

        /// Pulls what iCloud has now (it's otherwise fetched lazily).
        Function("cloudSynchronize") { () -> Bool in
            NSUbiquitousKeyValueStore.default.synchronize()
        }

        /// Signed in to iCloud with iCloud Drive/data allowed for the app.
        Function("cloudSignedIn") { () -> Bool in
            FileManager.default.ubiquityIdentityToken != nil
        }

        // MARK: Live Activities

        Function("liveActivitiesEnabled") { () -> Bool in
            ActivityAuthorizationInfo().areActivitiesEnabled
        }

        Function("activeActivities") { () -> [[String: String]] in
            Activity<JourneyActivityAttributes>.activities.map { ["id": $0.id, "planId": $0.attributes.planID] }
        }

        AsyncFunction("startActivity") { (planId: String, destinationLabel: String, regionSlug: String, contentJSON: String) -> String in
            // One journey at a time: adopt one already running for this plan.
            if let existing = Activity<JourneyActivityAttributes>.activities.first(where: { $0.attributes.planID == planId }) {
                self.watchToken(existing)
                return existing.id
            }
            for other in Activity<JourneyActivityAttributes>.activities {
                await other.end(nil, dismissalPolicy: .immediate)
            }
            let state = try Self.decode(contentJSON)
            let attributes = JourneyActivityAttributes(planID: planId, destinationLabel: destinationLabel, regionSlug: regionSlug)
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: Date().addingTimeInterval(15 * 60)),
                pushType: .token
            )
            self.watchToken(activity)
            return activity.id
        }

        /// With a title and body, the update also alerts (expands the Dynamic Island).
        AsyncFunction("updateActivity") { (id: String, contentJSON: String, alertTitle: String?, alertBody: String?) in
            guard let activity = Activity<JourneyActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
            let state = try Self.decode(contentJSON)
            var alert: AlertConfiguration?
            if let alertTitle, let alertBody {
                alert = AlertConfiguration(title: LocalizedStringResource(stringLiteral: alertTitle), body: LocalizedStringResource(stringLiteral: alertBody), sound: .default)
            }
            await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(15 * 60)), alertConfiguration: alert)
        }

        AsyncFunction("endActivity") { (id: String?) in
            for activity in Activity<JourneyActivityAttributes>.activities where id == nil || activity.id == id {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }

        // MARK: Trip Live Activities (one vehicle, to your stop)

        Function("activeTripActivities") { () -> [[String: String]] in
            Activity<TripActivityAttributes>.activities.map { ["id": $0.id, "tripId": $0.attributes.tripID, "stopId": $0.attributes.stopID] }
        }

        /// One trip at a time: the same trip and stop is adopted, anything else ends.
        AsyncFunction("startTripActivity") { (attributesJSON: String, contentJSON: String) -> String in
            let attributes = try JSONDecoder().decode(TripActivityAttributes.self, from: Data(attributesJSON.utf8))
            let state = try JSONDecoder().decode(TripActivityAttributes.ContentState.self, from: Data(contentJSON.utf8))
            for other in Activity<TripActivityAttributes>.activities {
                if other.attributes.tripID == attributes.tripID, other.attributes.stopID == attributes.stopID, other.attributes.kind == attributes.kind {
                    self.watchTripToken(other)
                    await other.update(.init(state: state, staleDate: Date().addingTimeInterval(10 * 60)))
                    return other.id
                }
                await other.end(nil, dismissalPolicy: .immediate)
            }
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: Date().addingTimeInterval(10 * 60)),
                pushType: .token
            )
            self.watchTripToken(activity)
            return activity.id
        }

        AsyncFunction("updateTripActivity") { (id: String, contentJSON: String, alertTitle: String?, alertBody: String?) in
            guard let activity = Activity<TripActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
            let state = try JSONDecoder().decode(TripActivityAttributes.ContentState.self, from: Data(contentJSON.utf8))
            var alert: AlertConfiguration?
            if let alertTitle, let alertBody {
                alert = AlertConfiguration(title: LocalizedStringResource(stringLiteral: alertTitle), body: LocalizedStringResource(stringLiteral: alertBody), sound: .default)
            }
            await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(10 * 60)), alertConfiguration: alert)
        }

        AsyncFunction("endTripActivity") { (id: String?) in
            for activity in Activity<TripActivityAttributes>.activities where id == nil || activity.id == id {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private static func readLegacyStore() -> [String: Any]? {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appending(path: "Library/Application Support") else { return nil }
        let path = dir.appending(path: "default.store").path
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else { return nil }
        defer { sqlite3_close(db) }

        // SwiftData is Core Data underneath: entity FavouriteStop -> table
        // ZFAVOURITESTOP, property stopID -> column ZSTOPID.
        func rows(_ sql: String) -> [[String: Any]] {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { return [] }
            defer { sqlite3_finalize(stmt) }
            var out: [[String: Any]] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                var row: [String: Any] = [:]
                for i in 0..<sqlite3_column_count(stmt) {
                    let name = String(cString: sqlite3_column_name(stmt, i))
                    switch sqlite3_column_type(stmt, i) {
                    case SQLITE_INTEGER: row[name] = Int(sqlite3_column_int64(stmt, i))
                    case SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, i)
                    case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, i))
                    default: break
                    }
                }
                out.append(row)
            }
            return out
        }
        return [
            "region": UserDefaults(suiteName: appGroup)?.string(forKey: "regionSlug") ?? "",
            // The SwiftUI app's Settings > iCloud sync switch (`CloudSyncMonitor.enabledKey`) - on unless turned off.
            "cloudSyncEnabled": UserDefaults.standard.object(forKey: "iCloudSyncEnabled") as? Bool ?? true,
            "stops": rows("SELECT ZSTOPID AS stopId, ZDISPLAYNAME AS name, ZCOLORHEX AS color, ZSORTORDER AS sortOrder FROM ZFAVOURITESTOP ORDER BY ZSORTORDER"),
            "places": rows("SELECT ZNAME AS name, ZLATITUDE AS lat, ZLONGITUDE AS lon, ZICON AS icon, ZREGIONSLUG AS region FROM ZSAVEDPLACE ORDER BY ZSORTORDER"),
            "trips": rows("SELECT ZNAME AS name, ZSTARTLABEL AS startLabel, ZSTARTLAT AS startLat, ZSTARTLON AS startLon, ZENDLABEL AS endLabel, ZENDLAT AS endLat, ZENDLON AS endLon, ZCOLORHEX AS color FROM ZSAVEDTRIP ORDER BY ZSORTORDER"),
        ]
    }

    private static func decode(_ json: String) throws -> JourneyActivityAttributes.ContentState {
        try JSONDecoder().decode(JourneyActivityAttributes.ContentState.self, from: Data(json.utf8))
    }

    private func watchToken(_ activity: Activity<JourneyActivityAttributes>) {
        observers.append(Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                self?.sendEvent("onActivityPushToken", ["id": activity.id, "planId": activity.attributes.planID, "token": token])
            }
        })
        observers.append(Task { [weak self] in
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                self?.sendEvent("onActivityEnded", ["id": activity.id, "planId": activity.attributes.planID])
            }
        })
    }

    private var watchedTrips = Set<String>()

    private func watchTripToken(_ activity: Activity<TripActivityAttributes>) {
        guard watchedTrips.insert(activity.id).inserted else { return }
        observers.append(Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                self?.sendEvent("onTripActivityPushToken", ["id": activity.id, "tripId": activity.attributes.tripID, "token": token])
            }
        })
        observers.append(Task { [weak self] in
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                self?.sendEvent("onTripActivityEnded", ["id": activity.id, "tripId": activity.attributes.tripID])
            }
        })
    }

    private func startObserving() {
        // Another device changed the iCloud key-value store (or the first
        // download after install landed, or the iCloud account changed).
        // reason: 0 server change, 1 initial sync, 2 quota exceeded, 3 account change.
        if cloudObserver == nil {
            cloudObserver = NotificationCenter.default.addObserver(
                forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
                object: NSUbiquitousKeyValueStore.default, queue: .main
            ) { [weak self] note in
                let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? 0
                let keys = note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
                self?.sendEvent("onCloudChange", ["reason": reason, "keys": keys])
            }
            NSUbiquitousKeyValueStore.default.synchronize()
        }
        // Push-to-start: the server starts the activity ahead of a reminder.
        observers.append(Task { [weak self] in
            for await data in Activity<JourneyActivityAttributes>.pushToStartTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                self?.sendEvent("onPushToStartToken", ["token": token])
            }
        })
        // An activity the server push-started while the app was closed: adopt it.
        observers.append(Task { [weak self] in
            for await activity in Activity<JourneyActivityAttributes>.activityUpdates {
                self?.watchToken(activity)
                self?.sendEvent("onActivityStarted", ["id": activity.id, "planId": activity.attributes.planID])
            }
        })
        for activity in Activity<JourneyActivityAttributes>.activities { watchToken(activity) }
        for activity in Activity<TripActivityAttributes>.activities { watchTripToken(activity) }
    }
}
