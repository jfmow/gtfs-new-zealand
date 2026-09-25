import SwiftUI
import TransitCore

/// The bell's sheet - `components/notifications/bell.tsx` as a native list:
/// Today / Earlier, tap to open, swipe to dismiss, Clear all, and the way
/// into "Alerts & reminders".
struct NotificationsBellSheet: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    private var feed: NotificationFeed { environment.notificationFeed }

    private var groups: [(title: String, entries: [RecentNotificationEntry])] {
        let entries = Array(feed.entries.prefix(50))
        let startOfDay = Calendar.current.startOfDay(for: Date())
        let isToday: (RecentNotificationEntry) -> Bool = { entry in
            guard let seen = entry.seenAt else { return false }
            return Date(timeIntervalSince1970: TimeInterval(seen)) >= startOfDay
        }
        return [("Today", entries.filter(isToday)), ("Earlier", entries.filter { !isToday($0) })].filter { !$0.entries.isEmpty }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        ManageNotificationsView()
                    } label: {
                        Label("Alerts & reminders", systemImage: "bell.badge")
                    }
                    .listRowBackground(Theme.card)
                }
                ForEach(groups, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.entries) { entry in
                            row(entry)
                                .listRowBackground(Theme.card)
                                .swipeActions {
                                    Button("Dismiss", role: .destructive) { Task { await feed.dismiss(entry) } }
                                }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .overlay {
                if feed.entries.isEmpty {
                    EmptyState(systemImage: "bell", title: "No notifications yet",
                               message: "Stop and route alerts, and leave-by reminders, show up here.")
                        .padding(.top, 80)
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !feed.entries.isEmpty {
                        Button("Clear all") { Task { await feed.clearAll() } }
                    }
                }
                DoneButton()
            }
            .task { await feed.refresh() }
            .refreshable { await feed.refresh() }
        }
    }

    private func row(_ entry: RecentNotificationEntry) -> some View {
        Button {
            guard let url = entry.url, !url.isEmpty else { return }
            dismiss()
            router.handle(notificationURL: url)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.title ?? "Notification").font(.bodyMedium).foregroundStyle(Theme.foreground)
                    Spacer(minLength: 8)
                    if let seen = entry.seenAt, seen > 0 {
                        Text(Date(timeIntervalSince1970: TimeInterval(seen)), style: .time)
                            .font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground)
                    }
                }
                if let body = entry.body, !body.isEmpty {
                    Text(body).font(.meta).foregroundStyle(Theme.mutedForeground).lineLimit(3)
                }
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(entry.url?.isEmpty == false ? "Opens it. Swipe to dismiss." : "Swipe to dismiss.")
    }
}

/// "Alerts & reminders" - `components/notifications/manage-sheet.tsx` as a
/// native list: leave-by reminders, route alerts and stop alerts with their
/// details; tap to edit, swipe to remove. Stops and routes show their real
/// names (the subscriptions only store ids).
struct ManageNotificationsView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var subscriptions: MySubscriptions?
    @State private var reminders: [JourneyReminderDTO] = []
    @State private var stopNames: [String: String] = [:]
    @State private var routesByID: [String: Route] = [:]
    @State private var isLoading = true
    @State private var editing: AlertSubscriptionSheet.Target?

    private var stops: [StopSubscription] { subscriptions?.stops ?? [] }
    private var routes: [RouteSubscription] { subscriptions?.routes ?? [] }

    var body: some View {
        List {
            if !reminders.isEmpty {
                Section("Leave-by reminders") {
                    ForEach(reminders) { reminder in
                        detailRow(
                            title: "\(reminder.startLabel.isEmpty ? "Start" : reminder.startLabel) → \(reminder.endLabel.isEmpty ? "destination" : reminder.endLabel)",
                            detail: SubscriptionDetail.text(for: reminder)
                        ) {
                            Image(systemName: "alarm").foregroundStyle(Theme.mutedForeground)
                        }
                        .swipeActions { Button("Delete", role: .destructive) { Task { await removeReminder(reminder) } } }
                    }
                }
            }
            if !routes.isEmpty {
                Section("Routes") {
                    ForEach(routes) { route in
                        let info = routesByID[route.routeID]
                        let name = info.map { $0.routeShortName.isEmpty ? $0.routeID : $0.routeShortName } ?? route.routeID
                        Button { editing = .route(id: route.routeID, title: "Route \(name)") } label: {
                            detailRow(title: info?.routeLongName.isEmpty == false ? info!.routeLongName : "Route \(name)",
                                      detail: SubscriptionDetail.text(causes: route.causes, minSeverity: route.minSeverity, notifyCancellations: route.notifyCancellations)) {
                                RouteBadge(name: name, colorHex: info?.routeColor ?? "", size: 12)
                            }
                        }
                        .buttonStyle(.plain)
                        .swipeActions { Button("Remove", role: .destructive) { Task { await removeRoute(route) } } }
                    }
                }
            }
            if !stops.isEmpty {
                Section("Stops") {
                    ForEach(stops) { stop in
                        let name = stopNames[stop.parentStopID] ?? "Stop \(stop.parentStopID)"
                        Button { editing = .stop(query: stop.parentStopID, title: name) } label: {
                            detailRow(title: name,
                                      detail: SubscriptionDetail.text(causes: stop.causes, minSeverity: stop.minSeverity, notifyCancellations: stop.notifyCancellations,
                                                                      extra: (stop.routes ?? []).isEmpty ? "All routes" : (stop.routes ?? []).joined(separator: ", "))) {
                                Image(systemName: "mappin.and.ellipse").foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .buttonStyle(.plain)
                        .swipeActions { Button("Remove", role: .destructive) { Task { await removeStop(stop) } } }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .groupedPageBackground()
        .overlay {
            if isLoading {
                ProgressView()
            } else if stops.isEmpty && routes.isEmpty && reminders.isEmpty {
                EmptyState(systemImage: "bell.badge", title: "Nothing set up yet",
                           message: "Set a leave-by reminder from the journey planner, or turn on alerts from a stop's bell button.")
            }
        }
        .navigationTitle("Alerts & reminders")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: Binding(get: { editing.map(EditingTarget.init) }, set: { editing = $0?.target })) { item in
            AlertSubscriptionSheet(target: item.target) { Task { await load() } }
                .shadSheet(detents: [.large])
        }
    }

    private struct EditingTarget: Identifiable {
        let target: AlertSubscriptionSheet.Target
        var id: String {
            switch target {
            case .stop(let query, _): return "stop:\(query)"
            case .route(let id, _): return "route:\(id)"
            }
        }
    }

    private func detailRow<Leading: View>(title: String, detail: String, @ViewBuilder leading: () -> Leading) -> some View {
        HStack(alignment: .top, spacing: 12) {
            leading().frame(minWidth: 28, alignment: .leading).padding(.top, 1).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.bodyMedium).foregroundStyle(Theme.foreground).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.meta).foregroundStyle(Theme.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .listRowBackground(Theme.card)
    }

    private func load() async {
        async let subs = try? environment.api.mySubscriptions()
        async let rems = (try? await environment.api.journeyReminders()) ?? []
        subscriptions = await subs
        reminders = await rems
        isLoading = false
        if !routes.isEmpty, routesByID.isEmpty {
            routesByID = (try? await environment.api.routes()) ?? [:]
        }
        for stop in stops where stopNames[stop.parentStopID] == nil {
            if let found = try? await environment.api.stop(stopID: stop.parentStopID) {
                stopNames[stop.parentStopID] = found.stopName
            }
        }
    }

    private func removeReminder(_ reminder: JourneyReminderDTO) async {
        do {
            try await environment.api.removeJourneyReminder(id: reminder.id)
            reminders.removeAll { $0.id == reminder.id }
            environment.toasts.show("Reminder removed")
        } catch {
            environment.toasts.show("Failed to remove reminder", .error)
        }
    }

    private func removeRoute(_ route: RouteSubscription) async {
        do {
            try await environment.api.unsubscribeFromRoute(route.routeID)
            environment.toasts.show("Route alerts removed")
            await load()
        } catch {
            environment.toasts.show("Failed to remove subscription", .error)
        }
    }

    private func removeStop(_ stop: StopSubscription) async {
        do {
            try await environment.api.unsubscribeFromStop(stop.parentStopID)
            environment.toasts.show("Stop alerts removed")
            await load()
        } catch {
            environment.toasts.show("Failed to remove subscription", .error)
        }
    }
}
