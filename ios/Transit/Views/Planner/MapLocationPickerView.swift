import MapKit
import SwiftUI
import TransitCore

/// "Pick on map" - drag the map to move a fixed centre pin, then confirm to
/// reverse-geocode that point into a location. Matches the web search
/// dropdown's "Pick on map" option (`components/map/search/index.tsx`),
/// missing from the iOS port until 2026-09-23.
struct MapLocationPickerView: View {
    let initialCoordinate: Coordinate?
    let onConfirm: (PlannerLocation) -> Void

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var cameraPosition: MapCameraPosition
    @State private var centerCoordinate: CLLocationCoordinate2D
    @State private var resolveTask: Task<Void, Never>?
    @State private var isResolving = false
    @State private var resolvedLabel: String?

    init(initialCoordinate: Coordinate?, onConfirm: @escaping (PlannerLocation) -> Void) {
        self.initialCoordinate = initialCoordinate
        self.onConfirm = onConfirm
        let start = initialCoordinate.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            ?? CLLocationCoordinate2D(latitude: -36.8485, longitude: 174.7633) // Auckland CBD fallback
        _cameraPosition = State(initialValue: .region(MKCoordinateRegion(center: start, latitudinalMeters: 1200, longitudinalMeters: 1200)))
        _centerCoordinate = State(initialValue: start)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $cameraPosition)
                    .mapControls { MapCompass() }
                    .onMapCameraChange(frequency: .continuous) { context in
                        centerCoordinate = context.region.center
                        resolvedLabel = nil
                    }
                    .onMapCameraChange(frequency: .onEnd) { _ in scheduleResolve() }
                    .ignoresSafeArea()

                // Fixed centre pin - the map moves under it, not the other
                // way round, so its tip always marks exactly the coordinate
                // being picked.
                Image(systemName: "mappin")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .shadow(color: .black.opacity(0.25), radius: 3, y: 2)
                    .offset(y: -17)
                    .allowsHitTesting(false)

                VStack {
                    Spacer()
                    VStack(spacing: 10) {
                        Group {
                            if isResolving {
                                ProgressView()
                            } else {
                                Text(resolvedLabel ?? "Drag the map to choose a point")
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        .font(.subheadline)
                        .foregroundStyle(Theme.foreground)
                        .frame(minHeight: 36)

                        Button("Use this location") { confirm() }
                            .buttonStyle(.shad(.default, size: .pill, fullWidth: true))
                            .disabled(isResolving)
                    }
                    .padding(16)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
            }
            .navigationTitle("Pick on map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { scheduleResolve() }
        }
    }

    private func scheduleResolve() {
        resolveTask?.cancel()
        let coordinate = centerCoordinate
        isResolving = true
        resolveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let point = Coordinate(latitude: coordinate.latitude, longitude: coordinate.longitude)
            let label = (try? await environment.api.reverseGeocode(point).name) ?? "Dropped pin"
            guard !Task.isCancelled else { return }
            resolvedLabel = label
            isResolving = false
        }
    }

    private func confirm() {
        let point = Coordinate(latitude: centerCoordinate.latitude, longitude: centerCoordinate.longitude)
        onConfirm(PlannerLocation(label: resolvedLabel ?? "Dropped pin", coordinate: point))
        dismiss()
    }
}
