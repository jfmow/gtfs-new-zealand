import CloudKit
import CoreData
import SwiftData
import TransitCore

/// Watches iCloud sync of saved stops, places and trips (the mirroring
/// itself is SwiftData's - `TransitStore`): tidies up after each import
/// (`SyncHygiene`), and tracks the account status and last sync for
/// Settings. See plans/icloud-sync.md.
@MainActor
@Observable
final class CloudSyncMonitor {
    enum Status: Equatable {
        /// Local-only container (a debug `-disableCloudSync YES` launch, or
        /// the CloudKit store wouldn't open).
        case off
        case checking
        case syncing
        case signedOut
        /// Signed in, but iCloud isn't usable on this device yet - pending
        /// verification, or an Advanced Data Protection account on a device
        /// that isn't trusted. Usually sorts itself out in Settings.
        case notReady
        /// Restricted (Screen Time / MDM), or Transit's iCloud switch off.
        case unavailable
    }

    private(set) var status: Status = .off
    private(set) var lastSynced: Date?
    private(set) var lastError: String?
    /// The first import after launch finished (or failed) - what's already
    /// in iCloud is now on this device.
    private(set) var hasFinishedFirstImport = false

    private var container: ModelContainer?
    private var tidyTask: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []

    func attach(_ container: ModelContainer, cloudSynced: Bool, openError: String? = nil) {
        self.container = container
        scheduleTidy(after: .zero)
        guard cloudSynced else {
            lastError = openError
            return
        }
        status = .checking
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: NSPersistentCloudKitContainer.eventChangedNotification, object: nil, queue: .main) { note in
                let event = note.userInfo?[NSPersistentCloudKitContainer.eventNotificationUserInfoKey] as? NSPersistentCloudKitContainer.Event
                MainActor.assumeIsolated { self.handle(event) }
            },
            // Posted for every change to the store, imports included.
            center.addObserver(forName: .NSPersistentStoreRemoteChange, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { self.scheduleTidy(after: .seconds(2)) }
            },
            center.addObserver(forName: .CKAccountChanged, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { Task { await self.refreshAccountStatus() } }
            },
        ]
        Task { await refreshAccountStatus() }
    }

    func appBecameActive() {
        scheduleTidy(after: .zero)
        guard status != .off else { return }
        Task { await refreshAccountStatus() }
    }

    /// Waits (up to `timeout`) for what's already in iCloud to arrive -
    /// returns at once when there's no iCloud to wait for.
    func waitForFirstImport(timeout: Duration) async {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            switch status {
            case .off, .signedOut, .notReady, .unavailable: return
            case .checking, .syncing: if hasFinishedFirstImport { return }
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    private func refreshAccountStatus() async {
        guard status != .off else { return }
        let account = try? await CKContainer(identifier: TransitStore.cloudKitContainerID).accountStatus()
        switch account {
        case .available: status = .syncing
        case .noAccount: status = .signedOut
        case .temporarilyUnavailable: status = .notReady
        case .restricted: status = .unavailable
        case .couldNotDetermine, nil: status = .unavailable
        @unknown default: status = .unavailable
        }
    }

    private func handle(_ event: NSPersistentCloudKitContainer.Event?) {
        guard let event, let endDate = event.endDate else { return }
        if let error = event.error {
            lastError = error.localizedDescription
        } else if event.type != .setup {
            lastSynced = endDate
            lastError = nil
        }
        if event.type == .import {
            hasFinishedFirstImport = true
            scheduleTidy(after: .zero)
        }
    }

    /// Debounced: an import lands as a burst of store changes.
    private func scheduleTidy(after delay: Duration) {
        tidyTask?.cancel()
        tidyTask = Task {
            if delay > .zero {
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
            }
            guard let context = container?.mainContext else { return }
            do {
                try SyncHygiene.run(in: context)
            } catch {
                lastError = error.localizedDescription
            }
        }
    }
}
