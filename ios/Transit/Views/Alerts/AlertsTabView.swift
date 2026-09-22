import SwiftUI
import TransitCore

/// The Alerts tab's landing screen. Unlike the other tabs, the web app has
/// no "browse every alert" page - alerts are always reached scoped to a
/// stop (`/alerts?s=`) or a route (`/alerts?r=`), usually from a departures
/// board or tracker. This search box is that entry point for a rider who
/// starts from the tab instead.
struct AlertsTabView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var searchText = ""
    @State private var results: [StopSearchResult] = []
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if searchText.isEmpty {
                    ContentUnavailableView("Search for a stop", systemImage: "exclamationmark.bubble", description: Text("Find a stop to see its service alerts."))
                } else {
                    ForEach(results) { result in
                        NavigationLink(value: BoardDestination(stopQuery: result.name, title: result.name)) {
                            StopRow(name: result.name, subtitle: result.typeOfStop.capitalized)
                        }
                    }
                }
            }
            .navigationTitle("Alerts")
            .searchable(text: $searchText, prompt: "Search stops")
            .onChange(of: searchText) { _, newValue in scheduleSearch(for: newValue) }
            .navigationDestination(for: BoardDestination.self) { destination in
                AlertsView(stopQuery: destination.stopQuery, title: destination.title)
            }
        }
    }

    private func scheduleSearch(for query: String) {
        searchTask?.cancel()
        guard query.count >= 2 else {
            results = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = (try? await environment.api.findStop(matching: query)) ?? []
        }
    }
}
