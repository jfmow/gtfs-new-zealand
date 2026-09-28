import SwiftData
import SwiftUI
import TransitCore

@main
struct TransitApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var environment: AppEnvironment
    @State private var router = DeepLinkRouter()
    private let modelContainer: ModelContainer

    init() {
        ChromeAppearance.apply()
        let environment = AppEnvironment()
        _environment = State(initialValue: environment)
        let (container, cloudError) = Self.makeModelContainer()
        modelContainer = container
        environment.cloudSync.attach(container, cloudSynced: cloudError == nil, openError: cloudError)
        // Started here rather than in a view's `.task`: iOS also launches
        // the app in the background (a reminder push-starting a Live
        // Activity, which then needs its update token registered), and no
        // scene - so no view task - may ever run in that case.
        Task { @MainActor in
            await environment.push.start()
            environment.liveActivity.start()
            #if DEBUG
            await environment.liveActivity.startDemoIfRequested()
            #endif
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment)
                .environment(router)
                .onOpenURL { router.handle($0) }
                .task {
                    // AppDelegate buffers a token or tapped notification that
                    // arrived before these were set, and replays it here.
                    appDelegate.onAPNsToken = { [environment] data in
                        environment.push.didReceiveAPNsToken(data)
                    }
                    appDelegate.onAPNsRegistrationFailure = { [environment] error in
                        environment.push.didFailToRegister(error)
                    }
                    appDelegate.onOpenNotificationURL = { [router] url in
                        router.handle(notificationURL: url)
                    }
                    appDelegate.isJourneyTrackerVisible = { [router] in
                        router.isTrackingVisible
                    }
                    AppAction.relay.handler = { [router] action in
                        switch action {
                        case .planJourney:
                            router.openPlanner()
                        case .goTo(let name, let coordinate):
                            router.plan(to: PlannerLocation(label: name, coordinate: coordinate))
                        }
                    }
                }
        }
        .modelContainer(modelContainer)
        // A hardware keyboard (mostly iPad): shown in the menu bar and the
        // hold-⌘ shortcut list.
        .commands { GoCommands(router: router) }
        .onChange(of: scenePhase) { _, phase in
            environment.journey.setAppActive(phase != .background)
            if phase == .active {
                Task { await environment.push.refreshAuthorizationStatus() }
                environment.cloudSync.appBecameActive()
            }
        }
    }

    /// Saved stops/places/trips sync through iCloud (`TransitStore`). If
    /// the CloudKit-backed store won't open, the same file opens local-only
    /// rather than the app failing to launch; a Debug launch with
    /// `-disableCloudSync YES` (the UI tests) skips iCloud entirely.
    /// The error is why iCloud is off - shown in Settings.
    private static func makeModelContainer() -> (ModelContainer, cloudError: String?) {
        #if DEBUG
        let wantsCloud = !UserDefaults.standard.bool(forKey: "disableCloudSync")
        #else
        let wantsCloud = true
        #endif
        let directory = TransitStore.storeDirectory(appGroup: SharedStore.appGroup)
        var cloudError = "Turned off for this launch"
        if wantsCloud {
            do {
                return (try TransitStore.makeContainer(.cloudSynced, directory: directory), nil)
            } catch {
                cloudError = String(describing: error)
            }
        }
        do {
            return (try TransitStore.makeContainer(.localOnly, directory: directory), cloudError)
        } catch {
            fatalError("Failed to create SwiftData ModelContainer: \(error)")
        }
    }
}

/// The Go menu: ⌘1-⌘4 for the tabs, ⌘F for stop search.
private struct GoCommands: Commands {
    let router: DeepLinkRouter

    var body: some Commands {
        CommandMenu("Go") {
            Button("Home") { router.select(.schedule) }.keyboardShortcut("1")
            Button("Planner") { router.select(.planner) }.keyboardShortcut("2")
            Button("Map") { router.select(.map) }.keyboardShortcut("3")
            Button("Alerts") { router.select(.alerts) }.keyboardShortcut("4")
            Divider()
            Button("Search Stops") { router.focusStopSearch() }.keyboardShortcut("f")
        }
    }
}
