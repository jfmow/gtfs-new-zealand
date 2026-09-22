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
            List {
                Section("Region") {
                    ForEach(Region.all) { region in
                        Button {
                            environment.region = region
                        } label: {
                            HStack {
                                Circle().fill(Theme.accent(for: region)).frame(width: 12, height: 12)
                                Text(region.displayName).foregroundStyle(Theme.ink)
                                Spacer()
                                if environment.region == region {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.accent(for: region))
                                }
                            }
                        }
                        .boardRow()
                    }
                }

                Section("Appearance") {
                    Picker("Appearance", selection: $appearanceModeRaw) {
                        ForEach(AppearanceMode.allCases, id: \.rawValue) { mode in
                            Text(mode.label).tag(mode.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                    .boardRow()
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.appVersionString)
                        .foregroundStyle(Theme.steel)
                }
                .boardRow()
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Settings")
            .tint(Theme.accent(for: environment.region))
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
