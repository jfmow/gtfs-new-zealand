import SwiftData
import SwiftUI
import TransitCore

@main
struct TransitApp: App {
    @State private var environment = AppEnvironment()
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
        }
        .modelContainer(modelContainer)
    }
}
