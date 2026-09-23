import ActivityKit
import TransitCore
import UIKit

/// Starts, updates and ends the journey-progress Live Activity
/// (`JourneyActivityAttributes`, in `Shared/`), and keeps the server able to
/// update it while the app is closed:
///
/// - each activity's own push token is registered with the backend
///   (`/live-activities`), which pushes realtime updates in the background
/// - the device's push-to-start token is sent up too, so a leave-by
///   reminder can put the journey on the Lock Screen without the app open
/// - activities the server started that way are picked up
///   (`activityUpdates`) and registered like any other
///
/// Owned by `AppEnvironment`; `start()` is called once at launch and
/// `JourneyTrackingView` drives updates while it's on screen.
@MainActor
@Observable
final class LiveActivityCoordinator {
    private(set) var activity: Activity<JourneyActivityAttributes>?

    private let api: APIClient
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var observersStarted = false
    /// Supplies the device identity + environment for push-to-start token
    /// uploads - set by AppEnvironment once PushRegistrationService exists.
    var uploadPushToStartToken: ((String) async -> Void)?

    /// How long a state stays fresh before the widget shows "updating…".
    /// The app refreshes every 10s while open; the server heartbeats every
    /// 4 min while it's closed.
    static let staleAfter: TimeInterval = 6 * 60

    init(api: APIClient) {
        self.api = api
    }

    var isActive: Bool { activity != nil }

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Launch-time setup: adopt any journey activity already running
    /// (started last session, or push-started by a reminder), and start
    /// watching for push-to-start tokens and new remotely-started
    /// activities.
    func start() {
        guard !observersStarted else { return }
        observersStarted = true

        if let existing = Activity<JourneyActivityAttributes>.activities.first {
            adopt(existing)
        }

        Task { [weak self] in
            for await tokenData in Activity<JourneyActivityAttributes>.pushToStartTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                await self?.uploadPushToStartToken?(token)
            }
        }

        Task { [weak self] in
            for await newActivity in Activity<JourneyActivityAttributes>.activityUpdates {
                self?.adopt(newActivity)
            }
        }
    }

    /// Starts a new activity for this plan, ending any other journey
    /// activity first (only one journey is tracked at a time). If one for
    /// the same plan is already running - e.g. a reminder push-started it -
    /// that one is kept and updated instead.
    func start(planID: String, destinationLabel: String, region: Region, initialState: JourneyActivityAttributes.ContentState) async {
        guard areActivitiesEnabled else { return }
        if let existing = Activity<JourneyActivityAttributes>.activities.first(where: { $0.attributes.planID == planID }) {
            adopt(existing)
            await update(initialState)
            return
        }
        await endCurrent()

        let attributes = JourneyActivityAttributes(planID: planID, destinationLabel: destinationLabel, regionSlug: region.slug)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initialState, staleDate: Date().addingTimeInterval(Self.staleAfter)),
                pushType: .token
            )
            adopt(activity)
        } catch {
            // Best-effort - a journey still tracks fine in-app without one.
        }
    }

    /// Local, in-app update while the app has a fresh snapshot - immediate,
    /// no server round trip.
    func update(_ state: JourneyActivityAttributes.ContentState) async {
        guard let activity else { return }
        await activity.update(.init(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter)))
    }

    func end(finalState: JourneyActivityAttributes.ContentState?) async {
        guard let activity else { return }
        stopObservingToken(for: activity.id)
        if let finalState {
            await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .after(.now.addingTimeInterval(60)))
        } else {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        try? await api.endLiveActivity(activityID: activity.id)
        self.activity = nil
    }

    private func endCurrent() async {
        guard let activity else { return }
        stopObservingToken(for: activity.id)
        await activity.end(nil, dismissalPolicy: .immediate)
        try? await api.endLiveActivity(activityID: activity.id)
        self.activity = nil
    }

    #if DEBUG
    /// Debug only: `LA_DEMO_JSON` (launch environment) puts a Live Activity
    /// with exactly that content state on screen, local-only (no push
    /// registration) - lets UI tests screenshot every phase's layout.
    func startDemoIfRequested() async {
        guard let json = ProcessInfo.processInfo.environment["LA_DEMO_JSON"],
              let state = try? JSONDecoder().decode(JourneyActivityAttributes.ContentState.self, from: Data(json.utf8)) else { return }
        for existing in Activity<JourneyActivityAttributes>.activities {
            await existing.end(nil, dismissalPolicy: .immediate)
        }
        let attributes = JourneyActivityAttributes(planID: "demo", destinationLabel: "Newmarket", regionSlug: "at")
        let stale = ProcessInfo.processInfo.environment["LA_DEMO_STALE"] != nil ? Date().addingTimeInterval(2) : Date().addingTimeInterval(Self.staleAfter)
        _ = try? Activity.request(attributes: attributes, content: .init(state: state, staleDate: stale), pushType: nil)
    }
    #endif

    /// Makes this the tracked activity and registers its push token with
    /// the server (every rotation, not just the first).
    private func adopt(_ activity: Activity<JourneyActivityAttributes>) {
        guard activity.activityState == .active || activity.activityState == .stale else { return }
        self.activity = activity
        guard tokenTasks[activity.id] == nil else { return }

        let api = self.api
        tokenTasks[activity.id] = Task {
            var registered = false
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                if registered {
                    try? await api.updateLiveActivityToken(activityID: activity.id, pushToken: token)
                } else {
                    do {
                        try await api.startLiveActivity(
                            planID: activity.attributes.planID, activityID: activity.id, pushToken: token,
                            region: activity.attributes.regionSlug, environment: PushRegistrationService.apnsEnvironment
                        )
                        registered = true
                    } catch {
                        // Retried on the next token rotation.
                    }
                }
            }
        }
    }

    private func stopObservingToken(for id: String) {
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
    }
}

extension JourneyActivityAttributes.ContentState {
    /// Bridges TransitCore's builder output into the widget's type through
    /// JSON - the same bytes the server pushes - so the two can never
    /// disagree on a key.
    init(_ content: LiveActivityContent) {
        let data = (try? JSONEncoder().encode(content)) ?? Data("{}".utf8)
        // The decoder is lenient (every field has a default), so "{}" always
        // decodes - this can't fail.
        self = (try? JSONDecoder().decode(Self.self, from: data)) ?? (try! JSONDecoder().decode(Self.self, from: Data("{}".utf8)))
    }
}
