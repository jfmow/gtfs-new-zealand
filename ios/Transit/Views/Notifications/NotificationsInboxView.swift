import SwiftUI
import TransitCore

/// Notification history + active leave-by reminders for this device -
/// `components/notifications/manage-sheet.tsx` + the nav bell's history.
struct NotificationsInboxView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var subscriptions: MySubscriptions?
    @State private var reminders: [JourneyReminderDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var accent: Color { Theme.accent(for: environment.region) }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if let errorMessage {
                    ContentUnavailableView("Couldn't load notifications", systemImage: "wifi.slash", description: Text(errorMessage))
                } else {
                    List {
                        if !environment.push.isAuthorized {
                            Section {
                                Button {
                                    Task { await environment.push.requestPermission() }
                                } label: {
                                    TransitCard {
                                        HStack(spacing: 12) {
                                            CircularBadge(fill: accent) {
                                                Image(systemName: "bell.badge.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                                            }
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("Enable notifications").foregroundStyle(Theme.ink)
                                                Text("Get alerts for your subscribed stops and routes").font(.caption).foregroundStyle(Theme.steel)
                                            }
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                                .cardListRow()
                            }
                        }

                        if !reminders.isEmpty {
                            Section("Leave-by reminders") {
                                ForEach(reminders) { reminder in
                                    TransitCard { ReminderRow(reminder: reminder) }
                                        .cardListRow()
                                        .swipeActions {
                                            Button("Remove", role: .destructive) {
                                                Task { await remove(reminder) }
                                            }
                                        }
                                }
                            }
                        }

                        if let stops = subscriptions?.stops, !stops.isEmpty {
                            Section("Stop alerts") {
                                ForEach(stops) { stop in
                                    TransitCard {
                                        HStack(spacing: 12) {
                                            CircularBadge(diameter: 32, fill: Theme.steel) {
                                                Image(systemName: "mappin").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                                            }
                                            Text(stop.parentStopID).foregroundStyle(Theme.ink).lineLimit(1)
                                            Spacer()
                                        }
                                    }
                                    .cardListRow()
                                }
                            }
                        }

                        if let recent = subscriptions?.recentNotifications, !recent.isEmpty {
                            Section("Recent") {
                                ForEach(recent) { entry in
                                    TransitCard { RecentNotificationRow(entry: entry) }
                                        .cardListRow()
                                }
                            }
                        }

                        if (subscriptions?.stops?.isEmpty ?? true), reminders.isEmpty, (subscriptions?.recentNotifications?.isEmpty ?? true) {
                            ContentUnavailableView("No notifications yet", systemImage: "bell.slash", description: Text("Subscribe to a stop's alerts or set a leave-by reminder to see them here."))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Theme.paper)
                    .refreshable { await load() }
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = subscriptions == nil
        defer { isLoading = false }
        async let subs = try? environment.api.mySubscriptions()
        async let rems = (try? await environment.api.journeyReminders()) ?? []
        subscriptions = await subs
        reminders = await rems
        errorMessage = nil
    }

    private func remove(_ reminder: JourneyReminderDTO) async {
        try? await environment.api.removeJourneyReminder(id: reminder.id)
        reminders.removeAll { $0.id == reminder.id }
    }
}

struct ReminderRow: View {
    let reminder: JourneyReminderDTO

    var body: some View {
        HStack(spacing: 12) {
            CircularBadge(diameter: 34, fill: Theme.delayed) {
                Image(systemName: "figure.walk.departure").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(reminder.routeShortName?.isEmpty == false ? "\(reminder.routeShortName!) from \(reminder.boardStopName ?? "")" : "Leave-by reminder")
                    .font(.subheadline.weight(.semibold))
                if let local = reminder.nextLeaveLocal {
                    Text("Leave by \(local)").font(.caption).foregroundStyle(Theme.steel)
                } else {
                    Text(reminder.status.capitalized).font(.caption).foregroundStyle(Theme.steel)
                }
            }
            Spacer()
        }
    }
}

struct RecentNotificationRow: View {
    let entry: RecentNotificationEntry

    var body: some View {
        HStack(spacing: 12) {
            CircularBadge(diameter: 30, fill: Theme.steel) {
                Image(systemName: "bell.fill").font(.system(size: 12)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title ?? "Notification").font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                if let body = entry.body {
                    Text(body).font(.caption).foregroundStyle(Theme.steel).lineLimit(2)
                }
            }
            Spacer()
        }
    }
}
