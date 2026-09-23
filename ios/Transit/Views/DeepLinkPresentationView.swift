import SwiftUI
import TransitCore

/// Presents a `DeepLink` - a shared `/journey` link reopens its plan by id
/// (the backend keeps it cached ~6h after arrival, see `plan_store.go`); a
/// `/trip` link goes straight to that trip's live tracking. Mirrors
/// `pages/journey.tsx`/`pages/trip.tsx`'s loading/error states.
struct DeepLinkPresentationView: View {
    let link: DeepLink

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var plan: JourneyPlan?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                switch link {
                case .journey(let id, _):
                    journeyContent(id: id)
                case .trip(let tripID, _):
                    VehicleQuickLookView(tripID: tripID)
                case .stop(let query):
                    StopBoardView(stopQuery: query, title: query)
                case .stopAlerts(let query):
                    AlertsView(stopQuery: query, title: query)
                case .routeAlerts(let routeID):
                    RouteAlertsLinkView(routeID: routeID)
                case .notifications:
                    ManageNotificationsView()
                case .plan:
                    // Routed to the Planner tab by DeepLinkRouter instead.
                    EmptyView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .task { await applyRegionIfNeeded() }
    }

    @ViewBuilder
    private func journeyContent(id: String) -> some View {
        if let plan {
            JourneyDetailView(plan: plan)
        } else if let errorMessage {
            ContentUnavailableView("This journey link has expired", systemImage: "clock.badge.xmark", description: Text(errorMessage))
        } else {
            ProgressView().task { await loadPlan(id: id) }
        }
    }

    private func applyRegionIfNeeded() async {
        if let regionSlug = link.region, let region = Region.bySlug(regionSlug), region != environment.region {
            environment.region = region
        }
    }

    private func loadPlan(id: String) async {
        do {
            let plans = try await environment.api.plan(id: id)
            guard let first = plans.first else {
                errorMessage = "No journey specified"
                return
            }
            plan = first
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// A route's service alerts, opened from a route-alert push.
private struct RouteAlertsLinkView: View {
    let routeID: String

    @Environment(AppEnvironment.self) private var environment
    @State private var alerts: [TransitAlert]?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let alerts {
                if alerts.isEmpty {
                    ContentUnavailableView("No alerts for route \(routeID)", systemImage: "checkmark.circle")
                } else {
                    List(Array(alerts.enumerated()), id: \.offset) { _, alert in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(alert.title).font(.subheadline.weight(.semibold))
                            Text(alert.description).font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            } else if let errorMessage {
                ContentUnavailableView("Couldn't load alerts", systemImage: "wifi.slash", description: Text(errorMessage))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Route \(routeID)")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                alerts = try await environment.api.alerts(forRoute: routeID)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
