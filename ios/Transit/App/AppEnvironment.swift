import Foundation
import TransitCore

/// App-wide shared state: the current region and the one `APIClient` every
/// screen talks through. Mirrors `lib/url-context.tsx`'s `UrlProvider` -
/// switching `region` (e.g. from a shared link's `region=`) immediately
/// repoints every subsequent request, with nothing else needing to know.
@MainActor
@Observable
final class AppEnvironment {
    let api: APIClient
    let location: LocationProvider
    let network: NetworkMonitor
    let push: PushRegistrationService
    let liveActivity: LiveActivityCoordinator
    let toasts = ToastCenter()
    let notificationFeed: NotificationFeed
    let journey: JourneyTrackingSession
    var region: Region {
        didSet {
            guard region != oldValue else { return }
            let api = self.api
            let region = self.region
            Task { await api.setRegion(region) }
        }
    }

    /// The rider's own choice (Settings, first launch) - saved, unlike a
    /// shared link's `region=`, which only switches for this session.
    func choose(region: Region) {
        self.region = region
        SharedStore.regionSlug = region.slug
    }

    init(region: Region = SharedStore.regionSlug.flatMap(Region.bySlug) ?? .auckland) {
        self.region = region
        let api = APIClient(region: region)
        self.api = api
        let push = PushRegistrationService(api: api)
        self.push = push
        let liveActivity = LiveActivityCoordinator(api: api)
        self.liveActivity = liveActivity
        self.notificationFeed = NotificationFeed(api: api)
        let location = LocationProvider()
        let network = NetworkMonitor()
        self.location = location
        self.network = network
        self.journey = JourneyTrackingSession(api: api, location: location, network: network, liveActivity: liveActivity, push: push)
        liveActivity.uploadPushToStartToken = { [weak push] token in
            await push?.uploadPushToStartToken(token)
        }
    }
}
