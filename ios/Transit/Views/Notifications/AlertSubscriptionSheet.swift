import SwiftUI
import TransitCore

/// Alerts for one stop or one route - `components/notifications/index.tsx`
/// (stop) and `route-notifications.tsx` (route). Which routes at the stop,
/// which alert types, minimum severity, cancellations. Like the web, changes
/// save themselves a second after the last edit.
struct AlertSubscriptionSheet: View {
    enum Target: Equatable {
        /// `query` is a name/code or parent id - the server resolves either.
        case stop(query: String, title: String)
        case route(id: String, title: String)

        var title: String {
            switch self {
            case .stop(_, let title), .route(_, let title): return title
            }
        }
    }

    let target: Target
    var onChanged: (() -> Void)?

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true
    @State private var isSubscribed = false
    @State private var availableRoutes: [String] = []
    @State private var selectedRoutes: Set<String> = []
    @State private var causeGroups: Set<AlertCauseGroup> = []
    @State private var minSeverity = ""
    @State private var notifyCancellations = true
    @State private var isSaving = false
    @State private var hasInteracted = false
    @State private var saveTask: Task<Void, Never>?
    @State private var confirmingDisableAll = false

    private var isStop: Bool { if case .stop = target { return true } else { return false } }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    form
                }
            }
            .pageBackground()
            .navigationTitle(isSubscribed ? "Edit alerts" : "Enable alerts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        saveTask?.cancel()
                        if hasInteracted { Task { await save() } }
                        dismiss()
                    }
                }
            }
            .task { await load() }
            .alert("Disable all notifications?", isPresented: $confirmingDisableAll) {
                Button("Disable all", role: .destructive) { Task { await disableAll() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This turns off alerts for every stop.")
            }
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(target.title).font(.pageTitle)
                    Text(isSubscribed
                         ? "Your changes are saved automatically."
                         : (isStop ? "Select routes to receive notifications for delays or cancellations." : "Get notified about delays, cancellations and disruptions on this route."))
                        .font(.bodyText)
                        .foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !environment.push.isAuthorized {
                    HStack(spacing: 10) {
                        Image(systemName: "bell.slash").foregroundStyle(Theme.mutedForeground)
                        Text("Notifications are off for this app.").font(.bodyText)
                        Spacer(minLength: 8)
                        Button("Turn on") { Task { await environment.push.requestPermission() } }
                            .buttonStyle(.shad(.outline, size: .sm))
                    }
                    .padding(12)
                    .mutedPanel()
                }

                if isStop {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Routes").font(.meta).foregroundStyle(Theme.mutedForeground)
                        if availableRoutes.isEmpty {
                            Text("All routes at this stop").font(.bodyText).foregroundStyle(Theme.mutedForeground)
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading).mutedPanel()
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(availableRoutes.enumerated()), id: \.element) { index, route in
                                    if index > 0 { RowDivider() }
                                    checkboxRow(route, isOn: selectedRoutes.contains(route)) {
                                        if selectedRoutes.contains(route) { selectedRoutes.remove(route) } else { selectedRoutes.insert(route) }
                                        changed()
                                    }
                                }
                            }
                            .shadCardBackground(radius: Theme.radiusLG)
                            Text(selectedRoutes.isEmpty ? "None selected - you'll hear about every route." : "\(selectedRoutes.count) of \(availableRoutes.count) routes")
                                .font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Alert types (leave empty for all)").font(.meta).foregroundStyle(Theme.mutedForeground)
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(AlertCauseGroup.allCases, id: \.self) { group in
                            Chip(label: group.label, isActive: causeGroups.contains(group), systemImage: icon(for: group)) {
                                if causeGroups.contains(group) { causeGroups.remove(group) } else { causeGroups.insert(group) }
                                changed()
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Minimum severity").font(.meta).foregroundStyle(Theme.mutedForeground)
                    ShadSelect(
                        selection: Binding(get: { minSeverity }, set: { minSeverity = $0; changed() }),
                        options: [("", "Any severity"), ("WARNING", "Warning & above"), ("SEVERE", "Severe only")],
                        fullWidth: true
                    )
                }

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Trip cancellations").font(.bodyMedium)
                        Text(isStop ? "Notify when a service is cancelled" : "Notify when a service on this route is cancelled")
                            .font(.meta).foregroundStyle(Theme.mutedForeground)
                    }
                    Spacer(minLength: 8)
                    Toggle("Trip cancellations", isOn: Binding(get: { notifyCancellations }, set: { notifyCancellations = $0; changed() }))
                        .labelsHidden()
                        .tint(Theme.primary)
                }
                .padding(14)
                .shadCardBackground(radius: Theme.radiusLG)

                if isSaving {
                    Text("Saving changes...").font(.meta).foregroundStyle(Theme.mutedForeground)
                }

                VStack(spacing: 8) {
                    if isSubscribed {
                        Button(isStop ? "Disable alerts for this stop" : "Disable alerts for this route") {
                            Task { await unsubscribe() }
                        }
                        .buttonStyle(.shad(.destructive, size: .default, fullWidth: true))
                    } else {
                        Button("Enable alerts") {
                            hasInteracted = true
                            Task { await save() }
                        }
                        .buttonStyle(.shad(.default, size: .default, fullWidth: true))
                    }
                    if isStop {
                        Button("Disable all notifications") { confirmingDisableAll = true }
                            .buttonStyle(.shad(.outline, size: .default, fullWidth: true))
                    }
                }
            }
            .padding(16)
        }
    }

    private func checkboxRow(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18))
                    .foregroundStyle(isOn ? Theme.primary : Theme.mutedForeground)
                    .accessibilityHidden(true)
                Text(label).font(.bodyText)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func icon(for group: AlertCauseGroup) -> String {
        switch group {
        case .delaysCancellations: return "clock"
        case .safetyIncidents: return "shield"
        case .weather: return "cloud.rain"
        case .plannedWorks: return "hammer"
        }
    }

    // MARK: - Data

    private func changed() {
        hasInteracted = true
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func load() async {
        defer { isLoading = false }
        switch target {
        case .stop(let query, _):
            async let routes = try? environment.api.alerts(forStop: query).routesToDisplay
            async let state = environment.api.stopSubscription(query)
            availableRoutes = (await routes ?? []).sorted()
            if let state = await state {
                isSubscribed = true
                selectedRoutes = Set(state.routes ?? [])
                causeGroups = AlertCauseGroup.groups(for: state.causes ?? [])
                minSeverity = state.minSeverity
                notifyCancellations = state.notifyCancellations
                // Routes the subscription names that the alerts endpoint
                // didn't list - keep them visible so they can be unticked.
                for route in selectedRoutes where !availableRoutes.contains(route) { availableRoutes.append(route) }
            }
        case .route(let id, _):
            if let existing = try? await environment.api.mySubscriptions().routes?.first(where: { $0.routeID == id }) {
                isSubscribed = true
                causeGroups = AlertCauseGroup.groups(for: existing.causes ?? [])
                minSeverity = existing.minSeverity
                notifyCancellations = existing.notifyCancellations
            }
        }
    }

    private func save() async {
        guard hasInteracted else { return }
        if !environment.push.isAuthorized { await environment.push.requestPermission() }
        isSaving = true
        defer { isSaving = false }
        let causes = AlertCauseGroup.causes(for: causeGroups)
        do {
            switch target {
            case .stop(let query, let title):
                if isSubscribed {
                    try await environment.api.updateStopSubscription(query, routes: Array(selectedRoutes).sorted(), causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    environment.toasts.show("Updated alerts for \(title)")
                } else {
                    try await environment.api.subscribeToStop(query, routes: Array(selectedRoutes).sorted(), causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    isSubscribed = true
                    environment.toasts.show("Alerts enabled for \(title)")
                }
            case .route(let id, let title):
                if isSubscribed {
                    try await environment.api.updateRouteSubscription(id, causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    environment.toasts.show("Updated alerts for \(title)")
                } else {
                    try await environment.api.subscribeToRoute(id, causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    isSubscribed = true
                    environment.toasts.show("Alerts enabled for \(title)")
                }
            }
            hasInteracted = false
            onChanged?()
        } catch {
            environment.toasts.show("Failed to save alerts for \(target.title)", .error)
        }
    }

    private func unsubscribe() async {
        saveTask?.cancel()
        do {
            switch target {
            case .stop(let query, _): try await environment.api.unsubscribeFromStop(query)
            case .route(let id, _): try await environment.api.unsubscribeFromRoute(id)
            }
            environment.toasts.show("Notifications disabled for \(target.title)", .info)
            onChanged?()
            dismiss()
        } catch {
            environment.toasts.show("Failed to disable notifications for \(target.title)", .error)
        }
    }

    private func disableAll() async {
        do {
            try await environment.api.unsubscribeFromAllStops()
            environment.toasts.show("All notifications disabled", .info)
            onChanged?()
            dismiss()
        } catch {
            environment.toasts.show("Failed to disable notifications", .error)
        }
    }
}
