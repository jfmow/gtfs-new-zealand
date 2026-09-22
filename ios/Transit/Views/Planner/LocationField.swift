import SwiftUI
import TransitCore

/// A from/to input for the planner - search-as-you-type plus "use current
/// location", mirroring `components/map/search/index.tsx`'s autocomplete
/// (minus the "pick on map" option, deferred).
struct LocationField: View {
    let placeholder: String
    @Binding var location: PlannerLocation?

    @Environment(AppEnvironment.self) private var environment
    @State private var query = ""
    @State private var results: [LocationSearchResult] = []
    @State private var searchTask: Task<Void, Never>?
    @State private var isEditing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField(placeholder, text: $query)
                    .onChange(of: query) { _, newValue in
                        isEditing = true
                        if location?.label != newValue { location = nil }
                        scheduleSearch(newValue)
                    }
                if location != nil {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                }
            }

            Button {
                useCurrentLocation()
            } label: {
                Label("Use current location", systemImage: "location.fill")
                    .font(.caption)
            }

            if isEditing, !results.isEmpty {
                ForEach(results) { result in
                    Button {
                        select(result)
                    } label: {
                        Text(result.label).font(.caption).multilineTextAlignment(.leading)
                    }
                }
            }
        }
        .onAppear { query = location?.label ?? "" }
    }

    private func scheduleSearch(_ text: String) {
        searchTask?.cancel()
        guard text.count >= 2 else {
            results = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = (try? await environment.api.searchLocations(matching: text)) ?? []
        }
    }

    private func select(_ result: LocationSearchResult) {
        location = PlannerLocation(label: result.label, coordinate: result.coordinate)
        query = result.label
        results = []
        isEditing = false
    }

    private func useCurrentLocation() {
        environment.location.requestPermission()
        guard let coordinate = environment.location.coordinate else { return }
        Task {
            let label = (try? await environment.api.reverseGeocode(coordinate).name) ?? "Current location"
            location = PlannerLocation(label: label, coordinate: coordinate)
            query = label
            results = []
            isEditing = false
        }
    }
}
