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
        let regionSlug: String?
        switch link {
        case .journey(_, let region): regionSlug = region
        case .trip(_, let region): regionSlug = region
        }
        if let regionSlug, let region = Region.bySlug(regionSlug), region != environment.region {
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
