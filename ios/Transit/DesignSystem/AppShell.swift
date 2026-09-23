import SwiftData
import SwiftUI
import TransitCore

// The app's chrome, matching the web header (components/nav.tsx): every tab
// root carries the notifications bell (with its unread count) and a menu
// holding what the web's hamburger drawer holds - Settings and "My
// reminders". Toasts mirror the web's sonner toasts.

// MARK: - Toasts

@MainActor
@Observable
final class ToastCenter {
    enum Kind { case success, error, info }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let kind: Kind
    }

    private(set) var current: Toast?
    private var dismissTask: Task<Void, Never>?

    func show(_ message: String, _ kind: Kind = .success) {
        current = Toast(message: message, kind: kind)
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(kind == .error ? 4 : 2.5))
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }
}

private struct ToastView: View {
    let toast: ToastCenter.Toast
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint)
            Text(toast.message)
                .font(.bodyMedium)
                .foregroundStyle(Theme.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Theme.popover, in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, 16)
        .onTapGesture(perform: onDismiss)
        .accessibilityAddTraits(.isStaticText)
    }

    private var icon: String {
        switch toast.kind {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        case .info: return "info.circle.fill"
        }
    }

    private var tint: Color {
        switch toast.kind {
        case .success: return Theme.success
        case .error: return Theme.danger
        case .info: return Theme.live
        }
    }
}

extension View {
    /// Shows `ToastCenter` toasts at the top of the screen, like the web's
    /// `<Toaster position="top-center">`.
    func toastOverlay(_ center: ToastCenter) -> some View {
        overlay(alignment: .top) {
            if let toast = center.current {
                ToastView(toast: toast) { center.dismiss() }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 4)
            }
        }
        .animation(.spring(duration: 0.3), value: center.current)
    }
}

// MARK: - Notification feed (bell badge)

/// The in-app notification history behind the bell - polled once for the
/// whole app (not per tab), read state kept locally the way the web keeps
/// it in localStorage (`notifications_last_seen`).
@MainActor
@Observable
final class NotificationFeed {
    private(set) var entries: [RecentNotificationEntry] = []
    private(set) var lastSeen: Int64 = Int64(UserDefaults.standard.integer(forKey: "notifications_last_seen"))

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    var unreadCount: Int {
        entries.filter { ($0.seenAt ?? 0) > lastSeen }.count
    }

    func refresh() async {
        guard let subscriptions = try? await api.mySubscriptions() else { return }
        entries = (subscriptions.recentNotifications ?? [])
            .filter { $0.dismissed != true }
            .sorted { ($0.seenAt ?? 0) > ($1.seenAt ?? 0) }
    }

    func markSeen() {
        lastSeen = Int64(Date().timeIntervalSince1970)
        UserDefaults.standard.set(Int(lastSeen), forKey: "notifications_last_seen")
    }

    func dismiss(_ entry: RecentNotificationEntry) async {
        entries.removeAll { $0.id == entry.id }
        try? await api.dismissNotification(id: entry.id)
    }

    func clearAll() async {
        entries = []
        try? await api.clearNotificationHistory()
    }

    /// Polls every 60s for as long as the calling task lives.
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(60))
        }
    }
}

// MARK: - Toolbar (bell + menu)

private struct AppToolbar: ViewModifier {
    @Environment(AppEnvironment.self) private var environment
    @State private var sheet: AppSheet?

    enum AppSheet: String, Identifiable {
        case notifications, reminders, settings, findVehicle
        var id: String { rawValue }
    }

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        environment.notificationFeed.markSeen()
                        sheet = .notifications
                    } label: {
                        Image(systemName: "bell")
                            .overlay(alignment: .topTrailing) {
                                let unread = environment.notificationFeed.unreadCount
                                if unread > 0 {
                                    Text(unread > 9 ? "9+" : "\(unread)")
                                        .font(.geist(9, .semibold, relativeTo: .caption2))
                                        .foregroundStyle(Theme.destructiveForeground)
                                        .padding(.horizontal, 3)
                                        .frame(minWidth: 15, minHeight: 15)
                                        .background(Theme.danger, in: Capsule())
                                        .offset(x: 8, y: -7)
                                }
                            }
                    }
                    .accessibilityLabel(environment.notificationFeed.unreadCount > 0 ? "Notifications, \(environment.notificationFeed.unreadCount) unread" : "Notifications")

                    Menu {
                        Button { sheet = .reminders } label: { Label("My reminders", systemImage: "bell.badge") }
                        Button { sheet = .findVehicle } label: { Label("Find my vehicle", systemImage: "location.viewfinder") }
                        Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                    }
                    .accessibilityLabel("Menu")
                }
            }
            .sheet(item: $sheet) { sheet in
                Group {
                    switch sheet {
                    case .notifications:
                        NotificationsBellSheet()
                    case .reminders:
                        NavigationStack { ManageNotificationsView().toolbar { DoneButton() } }
                    case .settings:
                        NavigationStack { SettingsView() }
                    case .findVehicle:
                        FindMyVehicleSheet()
                    }
                }
                .shadSheet(detents: sheet == .notifications ? [.medium, .large] : [.large])
            }
    }
}

/// "Done" for a sheet's root screen.
struct DoneButton: ToolbarContent {
    @Environment(\.dismiss) private var dismiss
    var body: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
    }
}

extension View {
    /// Adds the bell + menu to a tab root's navigation bar.
    func appToolbar() -> some View { modifier(AppToolbar()) }
}

// MARK: - Resume journey (resume-journey-prompt.tsx)

/// "You're mid-journey" - shown until dismissed, the journey ends, or it's
/// 45 min past arrival. Tapping it reopens live tracking.
///
/// iOS 26.1+: the tab bar's own bottom accessory (like Music's mini
/// player) - glass, sits on the tab bar, shrinks into it inline. Earlier
/// iOS: a card docked above each tab's bottom edge.
extension View {
    /// On the `TabView`.
    func resumeJourneyAccessory() -> some View {
        modifier(ResumeJourneyAccessoryModifier())
    }

    /// On each tab's root - the pre-iOS 26.1 fallback; does nothing where
    /// the tab bar accessory is available.
    func resumeJourneyInset() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            if #unavailable(iOS 26.1) {
                ResumeJourneyCard().padding(.bottom, 8)
            }
        }
    }
}

/// Which journey (if any) the resume control should offer right now.
@MainActor
private enum ResumeJourneyVisibility {
    static let grace: TimeInterval = 45 * 60

    static func journey(_ journeys: [ActiveJourney], dismissedPlanID: String, router: DeepLinkRouter, now: Date) -> ActiveJourney? {
        guard let journey = journeys.first,
              now < journey.arrivalTime.addingTimeInterval(grace),
              dismissedPlanID != journey.planID,
              router.visibleJourneyDetailPlanID != journey.planID,
              !router.isTrackingVisible, !router.isFullScreenMapVisible, router.activeLink == nil else { return nil }
        return journey
    }
}

private struct ResumeJourneyAccessoryModifier: ViewModifier {
    @Environment(DeepLinkRouter.self) private var router
    @Query(sort: \ActiveJourney.startedAt, order: .reverse) private var journeys: [ActiveJourney]
    @AppStorage("dismissedResumePlanID") private var dismissedPlanID = ""
    @State private var now = Date()

    func body(content: Content) -> some View {
        let journey = ResumeJourneyVisibility.journey(journeys, dismissedPlanID: dismissedPlanID, router: router, now: now)
        Group {
            if #available(iOS 26.1, *) {
                content.tabViewBottomAccessory(isEnabled: journey != nil) {
                    if let journey {
                        ResumeJourneyAccessoryContent(journey: journey) { dismissedPlanID = journey.planID }
                    }
                }
            } else {
                content
            }
        }
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { now = $0 }
    }
}

@available(iOS 26.1, *)
private struct ResumeJourneyAccessoryContent: View {
    let journey: ActiveJourney
    let onDismiss: () -> Void
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        ResumeJourneyRow(journey: journey, compact: placement == .inline, onDismiss: onDismiss) {
            router.resume(planID: journey.planID, regionSlug: journey.regionSlug)
        }
        .padding(.horizontal, placement == .inline ? 12 : 14)
    }
}

/// Pre-iOS 26.1: the same row on a card, docked above the tab bar.
struct ResumeJourneyCard: View {
    @Environment(DeepLinkRouter.self) private var router
    @Query(sort: \ActiveJourney.startedAt, order: .reverse) private var journeys: [ActiveJourney]
    @AppStorage("dismissedResumePlanID") private var dismissedPlanID = ""
    /// Hidden while typing - otherwise it floats above the keyboard, over
    /// search dropdowns.
    @State private var isKeyboardVisible = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            if let journey = ResumeJourneyVisibility.journey(journeys, dismissedPlanID: dismissedPlanID, router: router, now: context.date),
               !isKeyboardVisible {
                ResumeJourneyRow(journey: journey, compact: false, onDismiss: { dismissedPlanID = journey.planID }) {
                    router.resume(planID: journey.planID, regionSlug: journey.regionSlug)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: Theme.radiusXL + 4, style: .continuous)
                        .fill(Theme.card)
                        .shadow(color: .black.opacity(0.18), radius: 14, y: 4)
                }
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusXL + 4, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                .padding(.horizontal, 16)
                .frame(maxWidth: 440)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: router.isTrackingVisible)
        .animation(.easeOut(duration: 0.15), value: isKeyboardVisible)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in isKeyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in isKeyboardVisible = false }
    }
}

/// Live icon, "Journey to Newmarket", "Arrives 8:10am", and a dismiss
/// button - tapping anywhere else resumes. `compact` is the one-line form
/// for the tab bar's inline accessory.
private struct ResumeJourneyRow: View {
    let journey: ActiveJourney
    let compact: Bool
    let onDismiss: () -> Void
    let onResume: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onResume) {
                HStack(spacing: 10) {
                    Image(systemName: "location.north.fill")
                        .font(.system(size: compact ? 11 : 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: compact ? 24 : 32, height: compact ? 24 : 32)
                        .background(Theme.live, in: Circle())
                        .accessibilityHidden(true)
                    if compact {
                        Text("To \(journey.endLabel)")
                            .font(.geist(14, .semibold))
                            .lineLimit(1)
                    } else {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Journey to \(journey.endLabel)")
                                .font(.geist(15, .semibold))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            HStack(spacing: 5) {
                                LiveDot(color: Theme.success)
                                Text("Arrives \(journey.arrivalTime.formatted(date: .omitted, time: .shortened)) · Tap to resume")
                                    .font(.meta)
                                    .foregroundStyle(Theme.mutedForeground)
                                    .lineLimit(1)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Resume journey to \(journey.endLabel), arrives \(journey.arrivalTime.formatted(date: .omitted, time: .shortened))")

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
    }
}

// MARK: - Stops / Vehicles tab roots (separate routes, as on the web)

struct StopsTabView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            StopsMapView(onOpenStop: { path.append($0) }).appToolbar()
                .toolbarBackground(Theme.background, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .navigationDestination(for: BoardDestination.self) { destination in
                    StopBoardView(stopQuery: destination.stopQuery, title: destination.title)
                }
        }
    }
}

struct VehiclesTabView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            VehiclesMapView(onOpenVehicle: { path.append(TripDestination(tripID: $0)) }).appToolbar()
                .toolbarBackground(Theme.background, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .navigationDestination(for: TripDestination.self) { destination in
                    VehicleQuickLookView(tripID: destination.tripID)
                }
        }
    }
}

/// A service-tracker navigation target (its own type so it can't collide
/// with other `String` destinations in the same stack).
struct TripDestination: Hashable {
    let tripID: String
    /// The stop the rider came from (a board) - marked as "your stop".
    var fromStopName: String?
}
