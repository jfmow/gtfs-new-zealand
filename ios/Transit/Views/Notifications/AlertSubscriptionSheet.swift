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
    @State private var lastSaved: Date?

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
            .groupedPageBackground()
            .navigationTitle(target.title)
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

    /// A native settings form: one switch to turn alerts on, then (once on)
    /// what to be alerted about. Changes save themselves.
    private var form: some View {
        Form {
            if !environment.push.isAuthorized {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "bell.slash").foregroundStyle(Theme.mutedForeground)
                        Text("Notifications are off for this app.").font(.bodyText)
                        Spacer(minLength: 8)
                        Button("Turn on") { Task { await environment.push.requestPermission() } }
                            .buttonStyle(.shad(.outline, size: .sm))
                    }
                    .listRowBackground(Theme.card)
                }
            }

            Section {
                Toggle(isOn: Binding(get: { isSubscribed }, set: { on in Task { on ? await enable() : await unsubscribe() } })) {
                    Text(isStop ? "Alerts for this stop" : "Alerts for this route").font(.bodyMedium)
                }
                .tint(Theme.success)
                .listRowBackground(Theme.card)
            } footer: {
                Text(isStop
                     ? "Get notified about delays, cancellations and disruptions at this stop."
                     : "Get notified about delays, cancellations and disruptions on this route.")
            }

            if isSubscribed {
                if isStop, !availableRoutes.isEmpty {
                    Section {
                        checkRow("All routes", isOn: selectedRoutes.isEmpty) {
                            selectedRoutes = []
                            changed()
                        }
                        ForEach(availableRoutes, id: \.self) { route in
                            checkRow(route, isOn: selectedRoutes.contains(route)) {
                                if selectedRoutes.contains(route) { selectedRoutes.remove(route) } else { selectedRoutes.insert(route) }
                                changed()
                            }
                        }
                    } header: {
                        Text("Routes")
                    }
                }

                Section {
                    NavigationLink {
                        AlertTypesPicker(selection: Binding(get: { causeGroups }, set: { causeGroups = $0; changed() }))
                    } label: {
                        LabeledContent("Alert types", value: causeGroups.isEmpty ? "All" : causeGroups.map(\.label).sorted().joined(separator: ", "))
                    }
                    .listRowBackground(Theme.card)
                    Picker("Severity", selection: Binding(get: { minSeverity }, set: { minSeverity = $0; changed() })) {
                        Text("Any").tag("")
                        Text("Warning and above").tag("WARNING")
                        Text("Severe only").tag("SEVERE")
                    }
                    .listRowBackground(Theme.card)
                    Toggle("Cancelled trips", isOn: Binding(get: { notifyCancellations }, set: { notifyCancellations = $0; changed() }))
                        .tint(Theme.success)
                        .listRowBackground(Theme.card)
                } footer: {
                    Text(isSaving ? "Saving..." : lastSaved != nil ? "Saved." : "Changes save automatically.")
                }
            }

            if isStop {
                Section {
                    Button("Turn off alerts for all stops", role: .destructive) { confirmingDisableAll = true }
                        .foregroundStyle(Theme.danger)
                        .listRowBackground(Theme.card)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .tint(Theme.primary)
    }

    private func checkRow(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label).font(.bodyText).foregroundStyle(Theme.foreground)
                Spacer()
                if isOn {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.primary)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .listRowBackground(Theme.card)
        .accessibilityAddTraits(isOn ? .isSelected : [])
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

    /// The switch turning alerts on: subscribe with the current settings
    /// (all routes and types by default).
    private func enable() async {
        hasInteracted = true
        await save()
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
                    _ = title
                } else {
                    try await environment.api.subscribeToStop(query, routes: Array(selectedRoutes).sorted(), causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    isSubscribed = true
                    environment.toasts.show("Alerts enabled for \(title)")
                }
            case .route(let id, let title):
                if isSubscribed {
                    try await environment.api.updateRouteSubscription(id, causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                } else {
                    try await environment.api.subscribeToRoute(id, causes: causes, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
                    isSubscribed = true
                    environment.toasts.show("Alerts enabled for \(title)")
                }
            }
            hasInteracted = false
            lastSaved = Date()
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
            isSubscribed = false
            environment.toasts.show("Alerts turned off for \(target.title)", .info)
            onChanged?()
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

/// Which kinds of alert to receive - none ticked means all of them.
private struct AlertTypesPicker: View {
    @Binding var selection: Set<AlertCauseGroup>

    var body: some View {
        Form {
            Section {
                row("All types", systemImage: "bell", isOn: selection.isEmpty) { selection = [] }
                ForEach(AlertCauseGroup.allCases, id: \.self) { group in
                    row(group.label, systemImage: icon(for: group), isOn: selection.contains(group)) {
                        if selection.contains(group) { selection.remove(group) } else { selection.insert(group) }
                    }
                }
            } footer: {
                Text("Pick the kinds you care about, or All types.")
            }
        }
        .scrollContentBackground(.hidden)
        .groupedPageBackground()
        .navigationTitle("Alert types")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ label: String, systemImage: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage).frame(width: 22).foregroundStyle(Theme.mutedForeground).accessibilityHidden(true)
                Text(label).foregroundStyle(Theme.foreground)
                Spacer()
                if isOn {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.primary)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .listRowBackground(Theme.card)
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
}
