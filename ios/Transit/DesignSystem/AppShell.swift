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

// MARK: - Stops / Vehicles tab roots (separate routes, as on the web)

struct StopsTabView: View {
    var body: some View {
        NavigationStack {
            StopsMapView().appToolbar()
                .toolbarBackground(Theme.background, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
        }
    }
}

struct VehiclesTabView: View {
    var body: some View {
        NavigationStack {
            VehiclesMapView().appToolbar()
                .toolbarBackground(Theme.background, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
        }
    }
}
