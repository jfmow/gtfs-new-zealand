import SwiftUI
import TransitCore

/// "Appearance" storage key shared with `RootView`, which applies it via
/// `.preferredColorScheme`.
enum AppearanceMode: String, CaseIterable {
    case system, light, dark

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// `pages/settings.tsx` - region, appearance and (eventually) notification
/// management. Reminders/alert-subscription management is added in the push
/// phase.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var environment
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue

    var body: some View {
        NavigationStack {
            Form {
                Section("Region") {
                    Picker("Region", selection: Binding(get: { environment.region }, set: { environment.region = $0 })) {
                        ForEach(Region.all) { region in
                            Text(region.displayName).tag(region)
                        }
                    }
                }

                Section("Appearance") {
                    Picker("Appearance", selection: $appearanceModeRaw) {
                        ForEach(AppearanceMode.allCases, id: \.rawValue) { mode in
                            Text(mode.label).tag(mode.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.appVersionString)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

extension Bundle {
    var appVersionString: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}

#Preview {
    SettingsView()
        .environment(AppEnvironment())
}
