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
    var region: Region {
        didSet {
            guard region != oldValue else { return }
            let api = self.api
            let region = self.region
            Task { await api.setRegion(region) }
        }
    }

    init(region: Region = .auckland) {
        self.region = region
        self.api = APIClient(region: region)
    }
}
