import Foundation

/// One of the three transit authorities the backend serves, each behind its
/// own URL prefix (`/at`, `/wel`, `/christ`) on the shared API host. Mirrors
/// `UrlOption`/`urlOptions` in the web app's `lib/url-store.ts` - keep the
/// slug, base URL and brand colour in sync with that file if either changes.
public struct Region: Identifiable, Hashable, Sendable {
    /// The URL path segment and the value shared links carry as `region=`.
    public let slug: String
    public let displayName: String
    public let baseURL: URL
    /// Brand colour used for route badges etc. that don't have their own
    /// colour from the API, as a "RRGGBB" hex string (no leading '#').
    public let brandColorHex: String
    public let defaultMapCenter: Coordinate

    public var id: String { slug }

    public init(slug: String, displayName: String, baseURL: URL, brandColorHex: String, defaultMapCenter: Coordinate) {
        self.slug = slug
        self.displayName = displayName
        self.baseURL = baseURL
        self.brandColorHex = brandColorHex
        self.defaultMapCenter = defaultMapCenter
    }

    public static let auckland = Region(
        slug: "at",
        displayName: "Auckland",
        baseURL: URL(string: "https://trainapi.suddsy.dev/at")!,
        brandColorHex: "0073bd",
        defaultMapCenter: Coordinate(latitude: -36.854, longitude: 174.763)
    )

    public static let wellington = Region(
        slug: "wel",
        displayName: "Wellington",
        baseURL: URL(string: "https://trainapi.suddsy.dev/wel")!,
        brandColorHex: "ced940",
        defaultMapCenter: Coordinate(latitude: -41.286, longitude: 174.776)
    )

    public static let christchurch = Region(
        slug: "christ",
        displayName: "Christchurch",
        baseURL: URL(string: "https://trainapi.suddsy.dev/christ")!,
        brandColorHex: "2a286b",
        defaultMapCenter: Coordinate(latitude: -43.532, longitude: 172.637)
    )

    public static let all: [Region] = [.auckland, .wellington, .christchurch]

    /// Looks a region up by its URL slug (`at`/`wel`/`christ`) - used when a
    /// shared link or push deeplink carries `region=` and the receiving
    /// device needs to switch to match it. Falls back to nil for an unknown
    /// slug so the caller can decide what "unknown region" means.
    public static func bySlug(_ slug: String) -> Region? {
        all.first { $0.slug == slug }
    }
}

/// A plain lat/lon pair - used instead of CoreLocation's CLLocationCoordinate2D
/// in TransitCore so this package has no dependency on a location framework.
public struct Coordinate: Hashable, Sendable, Codable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}
