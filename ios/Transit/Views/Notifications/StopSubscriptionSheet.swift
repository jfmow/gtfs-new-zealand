import SwiftUI
import TransitCore

/// Subscribe to service alerts for a stop - `components/notifications/index.tsx`.
/// Reached from the bell button on `StopBoardView`.
struct StopSubscriptionSheet: View {
    let stopQuery: String
    let title: String

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    @State private var isSubscribed = false
    @State private var minSeverity = ""
    @State private var notifyCancellations = true
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var accent: Color { Theme.accent(for: environment.region) }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else {
                    Form {
                        Section {
                            Toggle("Notify me about this stop", isOn: $isSubscribed)
                        } footer: {
                            Text("You'll get a push notification for service alerts and cancellations affecting \(title).")
                        }

                        if isSubscribed {
                            Section("Minimum severity") {
                                Picker("Minimum severity", selection: $minSeverity) {
                                    Text("Any").tag("")
                                    Text("Warning").tag("WARNING")
                                    Text("Severe").tag("SEVERE")
                                }
                                .pickerStyle(.segmented)
                            }
                            Section {
                                Toggle("Trip cancellations", isOn: $notifyCancellations)
                            }
                        }

                        if !environment.push.isAuthorized {
                            Section {
                                Button("Enable notifications") {
                                    Task { await environment.push.requestPermission() }
                                }
                            }
                        }

                        if let errorMessage {
                            Section {
                                Text(errorMessage).foregroundStyle(Theme.alert).font(.footnote)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Alerts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(isSaving)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        // Best-effort match: `/mine` returns each subscription's canonical
        // parent stop id, but this view only has the board's "name + code"
        // query string (BoardDestination doesn't carry the canonical id) -
        // so an existing subscription may not pre-populate the toggle even
        // though saving/unsubscribing by name still works (the backend
        // resolves either form). Threading the real Stop through navigation
        // would fix this properly; not done yet.
        guard let subscriptions = try? await environment.api.mySubscriptions() else { return }
        if let match = subscriptions.stops?.first(where: { stopQuery.contains($0.parentStopID) || $0.parentStopID == stopQuery }) {
            isSubscribed = true
            minSeverity = match.minSeverity
            notifyCancellations = match.notifyCancellations
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            if isSubscribed {
                try await environment.api.subscribeToStop(stopQuery, minSeverity: minSeverity, notifyCancellations: notifyCancellations)
            } else {
                try await environment.api.unsubscribeFromStop(stopQuery)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
