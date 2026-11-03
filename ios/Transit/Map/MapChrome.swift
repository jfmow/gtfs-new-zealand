import SwiftUI
import TransitCore

/// Stops / Vehicles, as a capsule on the map itself. Plain buttons, not a
/// segmented Picker (see `ios-ux-pass`: the Picker dropped first taps).
struct MapModeSwitch: View {
    @Binding var mode: DeepLinkRouter.MapMode
    var onMaterial = true
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        if environment.region.hasRealtime {
            HStack(spacing: 2) {
                segment("Stops", .stops)
                segment("Vehicles", .vehicles)
            }
            .padding(3)
            .background {
                if onMaterial {
                    Capsule().fill(.regularMaterial)
                } else {
                    Capsule().fill(Theme.muted)
                }
            }
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: onMaterial ? 1 : 0))
            .accessibilityElement(children: .contain)
        }
    }

    private func segment(_ title: String, _ value: DeepLinkRouter.MapMode) -> some View {
        Button { mode = value } label: {
            Text(title)
                .font(.geist(14, .medium, relativeTo: .subheadline))
                .foregroundStyle(mode == value ? Theme.primaryForeground : Theme.foreground)
                .padding(.horizontal, 14)
                .frame(minHeight: 32)
                .background(mode == value ? Theme.primary : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(mode == value ? .isSelected : [])
    }
}

/// A round button floating on the map.
struct MapCircleButton<Label: View>: View {
    let accessibilityLabel: String
    let action: () -> Void
    @ViewBuilder var label: Label

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .frame(width: 40, height: 40)
                .background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Settings, floating on the map (the Map tab has no top bar in the new
/// layouts).
struct MapSettingsButton: View {
    @State private var isShowing = false

    var body: some View {
        MapCircleButton(accessibilityLabel: "Settings", action: { isShowing = true }) {
            Image(systemName: "gearshape")
        }
        .sheet(isPresented: $isShowing) {
            NavigationStack { SettingsView() }.shadSheet(detents: [.large])
        }
    }
}

/// The filter label for the map's menu button: what's shown, if not all.
func mapFilterIcon(active: Bool) -> String {
    active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
}

