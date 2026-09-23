import SwiftData
import SwiftUI
import TransitCore

@main
struct TransitApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var environment: AppEnvironment
    @State private var router = DeepLinkRouter()
    private let modelContainer: ModelContainer = {
        do {
            return try ModelContainer(for: FavouriteStop.self, SavedTrip.self, ActiveJourney.self, RecentSearchEntry.self)
        } catch {
            fatalError("Failed to create SwiftData ModelContainer: \(error)")
        }
    }()

    init() {
        ChromeAppearance.apply()
        let environment = AppEnvironment()
        _environment = State(initialValue: environment)
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
                }
        }
        .modelContainer(modelContainer)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await environment.push.refreshAuthorizationStatus() }
            }
        }
    }
}
