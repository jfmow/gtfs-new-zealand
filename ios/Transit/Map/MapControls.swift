import SwiftUI
import TransitCore

/// A floating "recenter on me" button, mirroring the web map's own locate
/// control (`components/map/map.tsx`'s geolocate button) - shown only when
/// location is actually on, since there's nowhere useful to recenter to
/// otherwise. Sits bottom-trailing over the map, above the safe area.
struct RecenterButton: View {
    let isAuthorized: Bool
    let action: () -> Void

    var body: some View {
        if isAuthorized {
            Button(action: action) {
                Image(systemName: "location.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                    .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
                    .contentShape(.hoverEffect, Circle())
                    .hoverEffect()
            }
            .accessibilityLabel("Centre on my location")
        }
    }
}

/// The maps' 3D mode - one setting shared by every `TransitMapView`.
/// `storageKey` is the live mode the map button toggles; each launch resets
/// it to `defaultKey` (Settings > Default map view).
enum Map3D {
    static let storageKey = "map3D"
    static let defaultKey = "map3DDefault"
    /// Camera tilt in 3D, in degrees - MapKit lowers it when zoomed out.
    static let pitch: Double = 60
    /// The chase camera's steeper tilt, looking along the vehicle's path.
    static let followPitch: Double = 70

    static func resetToDefault() {
        let defaults = UserDefaults.standard
        defaults.set(defaults.bool(forKey: defaultKey), forKey: storageKey)
    }
}

/// Toggles the maps between flat and 3D (tilted, with terrain and
/// buildings). Labelled with the mode it switches to, like Apple Maps.
struct Map3DButton: View {
    @AppStorage(Map3D.storageKey) private var is3D = false

    var body: some View {
        Button {
            is3D.toggle()
        } label: {
            Text(is3D ? "2D" : "3D")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.foreground)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
                .contentShape(.hoverEffect, Circle())
                .hoverEffect()
        }
        .accessibilityLabel(is3D ? "Show flat map" : "Show 3D map")
    }
}

/// Wraps a toolbar-style control (a `Button`, a `Menu`) in the same floating
/// pill/circle look as `RecenterButton`, for buttons sitting directly over a
/// full-bleed map - the system navigation bar's default (near-transparent)
/// button styling has poor contrast there.
struct FloatingBarButton<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.foreground)
            .frame(minWidth: 44, minHeight: 44)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 6, x: 0, y: 2)
            .contentShape(.hoverEffect, Capsule())
            .hoverEffect()
    }
}

/// The mode filter floating over the Stops and Vehicles maps - All / Bus /
/// Train / Ferry pills, then any extra chips the map adds (`trailing`).
/// One component so the two maps can't drift apart.
struct MapModeFilterBar<Mode: Hashable, Trailing: View>: View {
    let modes: [Mode]
    let label: (Mode) -> String
    @Binding var selection: Mode
    @ViewBuilder var trailing: Trailing

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(modes, id: \.self) { mode in
                    FilterChip(title: label(mode), isSelected: selection == mode) {
                        selection = mode
                    }
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                }
                trailing
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }
}

extension MapModeFilterBar where Trailing == EmptyView {
    init(modes: [Mode], label: @escaping (Mode) -> String, selection: Binding<Mode>) {
        self.init(modes: modes, label: label, selection: selection) { EmptyView() }
    }
}
