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
    @AppStorage(Map3D.defaultKey) private var map3DDefault = false
    @AppStorage(Map3D.storageKey) private var map3D = false
    @AppStorage(VehicleRoute.glidingKey) private var glidesVehicles = true
    @AppStorage(PlannerStyle.storageKey) private var plannerStyleRaw = PlannerStyle.standard.rawValue
    @AppStorage(CloudSyncMonitor.enabledKey) private var iCloudSyncEnabled = true

    var body: some View {
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
                    iCloudRow

                    RowDivider()
                    SettingsRow(title: "Region", detail: "Your transit provider") {
                        ShadSelect(
                            selection: Binding(get: { environment.region }, set: { environment.choose(region: $0) }),
                            options: Region.all.map { ($0, $0.displayName) },
                            sections: Region.byCountry.map { ($0.country.displayName, $0.regions) }
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
                    SettingsRow(title: "Default map view", detail: "3D tilts the map and follows vehicles from behind") {
                        ShadSelect(
                            selection: Binding(get: { map3DDefault }, set: { map3DDefault = $0; map3D = $0 }),
                            options: [(false, "2D"), (true, "3D")]
                        )
                    }

                    RowDivider()
                    SettingsRow(title: "Smooth vehicle movement", detail: "Move the vehicle you're on with your phone's location between live updates") {
                        Toggle("Smooth vehicle movement", isOn: $glidesVehicles)
                            .labelsHidden()
                            .tint(Theme.primary)
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
    /// Whether saved stops, places and trips are syncing, and the switch to
    /// stop them leaving the device (Transit's iCloud switch in the
    /// Settings app works too).
    var iCloudRow: some View {
        let sync = environment.cloudSync
        var detail: String
        switch sync.status {
        case .syncing:
            detail = sync.lastSynced.map { "Saved stops, places and trips - synced \($0.formatted(.relative(presentation: .named)))" }
                ?? "Syncing saved stops, places and trips"
        case .checking: detail = "Checking iCloud..."
        case .signedOut: detail = "Sign in to iCloud to sync saved stops, places and trips across your devices"
        case .notReady: detail = "Waiting for iCloud - check your Apple Account in the Settings app"
        case .unavailable: detail = "Off - turn on iCloud for Transit in the Settings app"
        case .off: detail = "Off on this device"
        case .disabled: detail = "Off - saved stops, places and trips stay on this device"
        }
        if let note = sync.pendingChangeNote(enabled: iCloudSyncEnabled) { detail = note }
        return SettingsRow(icon: "icloud", title: "iCloud sync", detail: detail) {
            HStack(spacing: 8) {
                if let error = sync.lastError, sync.status == .syncing || sync.status == .off {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(Theme.warning)
                        .accessibilityLabel(error)
                        .help(error)
                }
                Toggle("iCloud sync", isOn: $iCloudSyncEnabled)
                    .labelsHidden()
                    .tint(Theme.primary)
            }
        }
    }

    /// The notifications switch. Apps can't grant or revoke the permission
    /// themselves, so turning it on asks (or opens Settings once denied) and
    /// turning it off opens Settings; it re-reads the status on return.
    var notificationsRow: some View {
        let push = environment.push
        let toggle = Binding(
            get: { push.isAuthorized },
            set: { on in
                Task {
                    if on, push.authorizationStatus == .notDetermined {
                        _ = await push.requestPermission()
                    } else if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                        await UIApplication.shared.open(url)
                    }
                }
            }
        )
        return SettingsRow(icon: push.isAuthorized ? "bell" : "bell.slash", title: "Notifications", detail: "Alerts and leave-by reminders") {
            Toggle("Notifications", isOn: toggle)
                .labelsHidden()
                .tint(Theme.primary)
        }
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
