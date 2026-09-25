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

/// The map's basemap style, independent of the app theme - web
/// `setMapThemeOverride`. Applied by `TransitMapView`.
enum MapStyle: String, CaseIterable {
    case auto, light, dark

    var label: String {
        switch self {
        case .auto: return "Auto"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .auto: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// `pages/settings.tsx`: one bordered card of rows - title, muted
/// description, and the control on the right. The reference screen for the
/// v3 component kit.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearanceMode") private var appearanceModeRaw = AppearanceMode.system.rawValue
    @AppStorage("mapStyle") private var mapStyleRaw = MapStyle.auto.rawValue
    @AppStorage(PlannerStyle.storageKey) private var plannerStyleRaw = PlannerStyle.standard.rawValue

    var body: some View {
        @Bindable var environment = environment
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SettingsGroup {
                    notificationsRow
                    RowDivider()

                    NavigationLink {
                        ManageNotificationsView()
                    } label: {
                        SettingsRow(icon: "bell.badge", title: "Reminders & alerts", detail: "Repeating leave-by reminders, and stop & route alerts") {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    .buttonStyle(.plain)

                    RowDivider()
                    SettingsRow(title: "Region", detail: "Your transit provider") {
                        ShadSelect(
                            selection: $environment.region,
                            options: Region.all.map { ($0, $0.displayName) }
                        )
                    }

                    RowDivider()
                    SettingsRow(title: "Appearance", detail: "Light, dark, or match system") {
                        ShadSelect(
                            selection: $appearanceModeRaw,
                            options: AppearanceMode.allCases.map { ($0.rawValue, $0.label) }
                        )
                    }

                    RowDivider()
                    SettingsRow(title: "Map style", detail: "Basemap colours, independent of the app theme") {
                        ShadSelect(
                            selection: $mapStyleRaw,
                            options: MapStyle.allCases.map { ($0.rawValue, $0.label) }
                        )
                    }

                    RowDivider()
                    SettingsRow(title: "Planner", detail: "Step by step asks 4 simple questions, with large text and buttons") {
                        ShadSelect(
                            selection: $plannerStyleRaw,
                            options: PlannerStyle.allCases.map { ($0.rawValue, $0.label) }
                        )
                    }
                }

                Text("Version \(Bundle.main.appVersionString)")
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }
}

extension SettingsView {
    /// One row saying whether notifications work here; the permission /
    /// registration / token details and the test push live one level down.
    var notificationsRow: some View {
        let push = environment.push
        let ok = push.isAuthorized && push.isRegisteredWithBackend && push.hasUploadedToken
        let detail = !push.isAuthorized ? "Off - turn on to get alerts and reminders"
            : ok ? "On" : "Setting up - tap for details"
        return NavigationLink {
            ScrollView {
                ShadCard { PushStatusCard() }.padding(16)
            }
            .pageBackground()
            .navigationTitle("Notification diagnostics")
            .navigationBarTitleDisplayMode(.inline)
        } label: {
            SettingsRow(icon: ok ? "bell" : "bell.slash", title: "Notifications", detail: detail) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
        .buttonStyle(.plain)
    }
}

/// `max-w-lg divide-y border rounded-xl bg-card` - rows separated by
/// hairlines inside one card.
struct SettingsGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .shadCardBackground()
    }
}

/// The `divide-y` hairline between `SettingsGroup` rows.
struct RowDivider: View {
    var body: some View {
        Rectangle().fill(Theme.border).frame(height: 1)
    }
}

struct SettingsRow<Accessory: View>: View {
    var icon: String?
    let title: String
    var detail: String?
    @ViewBuilder var accessory: Accessory

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 20)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.bodyMedium).foregroundStyle(Theme.foreground)
                if let detail {
                    Text(detail)
                        .font(.meta)
                        .foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            accessory
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

extension Bundle {
    var appVersionString: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
