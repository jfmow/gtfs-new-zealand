import Foundation
import TransitCore
import UserNotifications

/// Local notifications standing in for the server's journey pushes while
/// the phone has no connection. Two kinds, sharing one identifier per
/// moment (`JourneyAlertCenter`'s key) so they never double up:
/// - scheduled ahead from the timetable (`OfflineJourneyMoments`), so they
///   fire even if iOS suspends the app;
/// - delivered straight away when GPS tracking detects the moment, which
///   replaces the scheduled stand-in.
@MainActor
final class JourneyOfflineNotifications {
    nonisolated private static let prefix = "journey-offline:"
    private let center = UNUserNotificationCenter.current()
    private var scheduled: [String: Date] = [:]
    /// Starts true so the first cancel also clears any left pending by a
    /// previous launch.
    private var mayHavePending = true

    private static func identifier(_ key: String) -> String { prefix + key }

    private static func content(title: String, body: String, url: String) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .active
        content.threadIdentifier = "journey"
        // Same shape as the server's journey pushes: AppDelegate hides the
        // banner while the tracker is on screen, and a tap resumes it.
        content.userInfo = ["kind": "journey", "url": url]
        return content
    }

    /// Replaces the scheduled set with `moments` - only touching the
    /// notification center when something actually moved.
    func schedule(_ moments: [OfflineJourneyMoments.Moment], url: String) {
        var wanted: [String: Date] = [:]
        for moment in moments { wanted[moment.key] = moment.date }
        let stale = scheduled.keys.filter { key in
            guard let date = wanted[key] else { return true }
            return abs(date.timeIntervalSince(scheduled[key]!)) >= 30
        }
        if !stale.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: stale.map(Self.identifier))
            for key in stale { scheduled[key] = nil }
        }

        for moment in moments where scheduled[moment.key] == nil {
            let interval = moment.date.timeIntervalSinceNow
            guard interval > 1 else { continue }
            let request = UNNotificationRequest(
                identifier: Self.identifier(moment.key),
                content: Self.content(title: moment.title, body: moment.body, url: url),
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            )
            center.add(request)
            scheduled[moment.key] = moment.date
            mayHavePending = true
        }
    }

    /// Shows a GPS-detected moment now - unless its scheduled stand-in
    /// already went off.
    func deliverNow(key: String, title: String, body: String?, url: String) async {
        guard await takeOver(key: key) else { return }
        let id = Self.identifier(key)
        let request = UNNotificationRequest(identifier: id, content: Self.content(title: title, body: body ?? "", url: url), trigger: nil)
        try? await center.add(request)
    }

    /// A GPS-detected moment is being shown some other way (the Live
    /// Activity's alert): drops its scheduled stand-in. False if the stand-in
    /// already went off, so the moment shouldn't be shown again.
    func takeOver(key: String) async -> Bool {
        let id = Self.identifier(key)
        let delivered = await center.deliveredNotifications()
        guard !delivered.contains(where: { $0.request.identifier == id }) else { return false }
        center.removePendingNotificationRequests(withIdentifiers: [id])
        scheduled[key] = nil
        return true
    }

    /// Drops everything still pending - back online (the server takes
    /// over again) or back in the app (in-app alerts do).
    func cancelPending() {
        guard mayHavePending else { return }
        mayHavePending = false
        scheduled = [:]
        center.getPendingNotificationRequests { requests in
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            guard !ids.isEmpty else { return }
            Task { @MainActor [weak self] in
                // Anything scheduled again since this was asked for stays.
                let keep = Set((self?.scheduled.keys).map { $0.map(Self.identifier) } ?? [])
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids.filter { !keep.contains($0) })
            }
        }
    }

    /// The journey's over: pending and already-shown ones both go.
    func clearAll() async {
        cancelPending()
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(withIdentifiers: delivered.map(\.request.identifier).filter { $0.hasPrefix(Self.prefix) })
    }
}
