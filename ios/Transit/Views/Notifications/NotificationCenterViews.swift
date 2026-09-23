import SwiftUI
import TransitCore

/// The bell's popover - `components/notifications/bell.tsx`: recent
/// notifications (tap to open, x to dismiss), Clear all, Manage.
struct NotificationsBellSheet: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    private var feed: NotificationFeed { environment.notificationFeed }

    var body: some View {
        NavigationStack {
            Group {
                if feed.entries.isEmpty {
                    EmptyState(systemImage: "bell", title: "No notifications yet",
                               message: "Stop and route alerts, and leave-by reminders, show up here.")
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(feed.entries.prefix(30).enumerated()), id: \.element.id) { index, entry in
                                if index > 0 { RowDivider() }
                                row(entry)
                            }
                        }
                        .shadCardBackground()
                        .padding(16)
                    }
                }
            }
            .pageBackground()
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !feed.entries.isEmpty {
                        Button("Clear all") { Task { await feed.clearAll() } }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    NavigationLink("Manage") { ManageNotificationsView() }
                }
            }
            .task { await feed.refresh() }
            .refreshable { await feed.refresh() }
        }
    }

    private func row(_ entry: RecentNotificationEntry) -> some View {
        HStack(alignment: .top, spacing: 4) {
            Button {
                guard let url = entry.url, !url.isEmpty else { return }
                dismiss()
                router.handle(notificationURL: url)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.title ?? "Notification").font(.bodyMedium).foregroundStyle(Theme.foreground)
                    if let body = entry.body, !body.isEmpty {
                        Text(body).font(.meta).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                    }
                    if let seen = entry.seenAt, seen > 0 {
                        Text(Date(timeIntervalSince1970: TimeInterval(seen)).formatted(.dateTime.day().month().hour().minute()))
                            .font(.geist(11, relativeTo: .caption2)).foregroundStyle(Theme.mutedForeground.opacity(0.7))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(DropdownRowStyle())
            .disabled(entry.url?.isEmpty ?? true)

            Button {
                Task { await feed.dismiss(entry) }
            } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.shad(.ghost, size: .iconSm))
            .foregroundStyle(Theme.mutedForeground)
            .padding(.top, 6)
            .padding(.trailing, 4)
            .accessibilityLabel("Dismiss notification")
        }
    }
}

/// "Reminders & alerts" - `components/notifications/manage-sheet.tsx`:
/// leave-by reminders, route alerts and stop alerts, each with its detail
/// line, edit and delete. Pushed (from Settings / the bell) or presented
/// inside a NavigationStack (the menu's "My reminders").
struct ManageNotificationsView: View {
    @Environment(AppEnvironment.self) private var environment

    @State private var subscriptions: MySubscriptions?
    @State private var reminders: [JourneyReminderDTO] = []
    @State private var isLoading = true
    @State private var editing: AlertSubscriptionSheet.Target?

    private var stops: [StopSubscription] { subscriptions?.stops ?? [] }
    private var routes: [RouteSubscription] { subscriptions?.routes ?? [] }

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if stops.isEmpty && routes.isEmpty && reminders.isEmpty {
                EmptyState(systemImage: "bell.badge", title: "Nothing set up yet",
                           message: "Add a repeating \"leave by\" reminder from the journey planner, or turn on alerts for a stop or route - they'll all show here.")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if !reminders.isEmpty {
                            section("Leave-by reminders") {
                                ForEach(Array(reminders.enumerated()), id: \.element.id) { index, reminder in
                                    if index > 0 { RowDivider() }
                                    row(title: "\(reminder.routeShortName?.isEmpty == false ? reminder.routeShortName! : "Journey") → \(reminder.endLabel.isEmpty ? "destination" : reminder.endLabel)",
                                        detail: SubscriptionDetail.text(for: reminder),
                                        onEdit: nil,
                                        onDelete: { Task { await removeReminder(reminder) } })
                                }
                            }
                        }
                        if !routes.isEmpty {
                            section("Route alerts") {
                                ForEach(Array(routes.enumerated()), id: \.element.id) { index, route in
                                    if index > 0 { RowDivider() }
                                    row(title: "Route \(route.routeID)",
                                        detail: SubscriptionDetail.text(causes: route.causes, minSeverity: route.minSeverity, notifyCancellations: route.notifyCancellations),
                                        onEdit: { editing = .route(id: route.routeID, title: "Route \(route.routeID)") },
                                        onDelete: { Task { await removeRoute(route) } })
                                }
                            }
                        }
                        if !stops.isEmpty {
                            section("Stop alerts") {
                                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                                    if index > 0 { RowDivider() }
                                    row(title: "Stop \(stop.parentStopID)",
                                        detail: SubscriptionDetail.text(causes: stop.causes, minSeverity: stop.minSeverity, notifyCancellations: stop.notifyCancellations,
                                                                        extra: (stop.routes ?? []).isEmpty ? "All routes" : (stop.routes ?? []).joined(separator: ", ")),
                                        onEdit: { editing = .stop(query: stop.parentStopID, title: "Stop \(stop.parentStopID)") },
                                        onDelete: { Task { await removeStop(stop) } })
                                }
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .pageBackground()
        .navigationTitle("Reminders & alerts")
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

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            VStack(spacing: 0) { content() }.shadCardBackground()
        }
    }

    private func row(title: String, detail: String, onEdit: (() -> Void)?, onDelete: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.bodyMedium).lineLimit(1)
                Text(detail).font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
            }
            Spacer(minLength: 8)
            if let onEdit {
                Button(action: onEdit) { Image(systemName: "pencil").font(.system(size: 13)) }
                    .buttonStyle(.shad(.ghost, size: .iconSm))
                    .accessibilityLabel("Edit \(title)")
            }
            Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 13)) }
                .buttonStyle(.shad(.ghost, size: .iconSm))
                .foregroundStyle(Theme.danger)
                .accessibilityLabel("Remove \(title)")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
    }

    private func load() async {
        async let subs = try? environment.api.mySubscriptions()
        async let rems = (try? await environment.api.journeyReminders()) ?? []
        subscriptions = await subs
        reminders = await rems
        isLoading = false
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
            environment.toasts.show("Notifications removed for route \(route.routeID)")
            await load()
        } catch {
            environment.toasts.show("Failed to remove subscription", .error)
        }
    }

    private func removeStop(_ stop: StopSubscription) async {
        do {
            try await environment.api.unsubscribeFromStop(stop.parentStopID)
            environment.toasts.show("Notifications removed for stop")
            await load()
        } catch {
            environment.toasts.show("Failed to remove subscription", .error)
        }
    }
}
