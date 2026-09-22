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
                            TransitCard {
                                HStack(spacing: 12) {
                                    CircularBadge(diameter: 34, fill: Theme.accent(for: region)) {
                                        Text(String(region.displayName.prefix(1)))
                                            .font(.system(size: 14, weight: .bold, design: .rounded))
                                            .foregroundStyle(.white)
                                    }
                                    Text(region.displayName).foregroundStyle(Theme.ink)
                                    Spacer()
                                    if environment.region == region {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent(for: region))
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .cardListRow()
                    }
                }

                Section("Appearance") {
                    TransitCard {
                        Picker("Appearance", selection: $appearanceModeRaw) {
                            ForEach(AppearanceMode.allCases, id: \.rawValue) { mode in
                                Text(mode.label).tag(mode.rawValue)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .cardListRow()
                }

                Section {
                    TransitCard {
                        LabeledContent("Version", value: Bundle.main.appVersionString)
                            .foregroundStyle(Theme.steel)
                    }
                }
                .cardListRow()
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
