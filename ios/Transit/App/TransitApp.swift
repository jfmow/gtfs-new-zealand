import SwiftData
import SwiftUI
import TransitCore

@main
struct TransitApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var environment = AppEnvironment()
    @State private var router = DeepLinkRouter()
    private let modelContainer: ModelContainer = {
        do {
            return try ModelContainer(for: FavouriteStop.self, SavedTrip.self, ActiveJourney.self, RecentSearchEntry.self)
        } catch {
            fatalError("Failed to create SwiftData ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment)
                .environment(router)
                .onOpenURL { router.handle($0) }
                .onAppear {
                    appDelegate.onAPNsToken = { [environment] data in
                        environment.push.didReceiveAPNsToken(data)
                    }
                }
                .task { await environment.push.start() }
        }
        .modelContainer(modelContainer)
    }
}
