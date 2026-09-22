import SwiftUI

/// The Map tab's root - a switch between the stops browser and the vehicles
/// browser (`pages/stops.tsx` and `pages/vehicles.tsx` are separate routes
/// on the web; combined into one tab here since a 5-tab phone shell has no
/// room for both).
struct MapTabView: View {
    private enum Mode: String, CaseIterable { case stops = "Stops", vehicles = "Vehicles" }
    @State private var mode: Mode = .stops

    var body: some View {
        NavigationStack {
            Group {
                switch mode {
                case .stops: StopsMapView()
                case .vehicles: VehiclesMapView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 200)
                }
            }
        }
    }
}
