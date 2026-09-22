import SwiftUI
import TransitCore

/// All stops on a map, filterable by mode - `pages/stops.tsx`.
struct StopsMapView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var stops: [Stop] = []
    @State private var typeFilter: StopType = .all
    @State private var selectedStopID: String?
    @State private var errorMessage: String?

    var body: some View {
        ZStack(alignment: .top) {
            TransitMapView(
                stops: stops.map(StopAnnotation.init),
                camera: .region(center: environment.location.coordinate ?? environment.region.defaultMapCenter, radiusMeters: 6000),
                showsUserLocation: environment.location.isAuthorized,
                onSelectStop: { selectedStopID = $0 }
            )
            .ignoresSafeArea(edges: .bottom)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(StopType.filterCases, id: \.self) { type in
                        FilterChip(title: type.label, isSelected: typeFilter == type) {
                            typeFilter = type
                        }
                    }
                }
                .padding()
            }
            .background(.ultraThinMaterial)

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(.top, 44)
            }
        }
        .navigationTitle("Stops")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: typeFilter) { _, _ in Task { await load() } }
        .navigationDestination(item: Binding(get: { selectedStop }, set: { selectedStopID = $0?.stopID })) { stop in
            StopBoardView(stopQuery: stop.boardQuery, title: stop.stopName)
        }
    }

    private var selectedStop: Stop? {
        stops.first { $0.stopID == selectedStopID }
    }

    private func load() async {
        do {
            stops = try await environment.api.stops(includeChildren: false, type: typeFilter)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// StopType already conforms to Equatable/Hashable/CaseIterable via Swift's
// automatic synthesis (a raw-value enum with no associated values) - only
// the display label is added here.
extension StopType {
    static var filterCases: [StopType] { [.all, .bus, .train, .ferry] }

    var label: String {
        switch self {
        case .all: return "All"
        case .bus: return "Bus"
        case .train: return "Train"
        case .ferry: return "Ferry"
        }
    }
}
