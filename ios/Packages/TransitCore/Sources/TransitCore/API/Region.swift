import Foundation

/// One of the transit authorities the backend serves, each behind its own URL
/// prefix (`/at`, `/wel`, `/christ`, `/otago`, `/seq`) on the shared API host.
/// Mirrors `UrlOption`/`urlOptions` in the web app's `lib/url-store.ts` - keep
/// the slug, base URL, brand colour, country, time zone and realtime flag in
/// sync with that file if either changes.
public struct Region: Identifiable, Hashable, Sendable {
    /// The URL path segment and the value shared links carry as `region=`.
    public let slug: String
    public let displayName: String
    public let baseURL: URL
    /// Brand colour used for route badges etc. that don't have their own
    /// colour from the API, as a "RRGGBB" hex string (no leading '#').
    public let brandColorHex: String
    public let defaultMapCenter: Coordinate
    /// Groups the region pickers.
    public let country: Country
    /// The zone the feed's timetable is written in - service dates and
    /// clock times sent to the backend are in it.
    public let timeZone: TimeZone
    /// False for a region that publishes no GTFS-RT (no live vehicles or
    /// alerts) - timetable only.
    public let hasRealtime: Bool

    public var id: String { slug }

    public enum Country: String, CaseIterable, Sendable {
        case newZealand = "NZ"
        case australia = "AU"

        public var displayName: String {
            switch self {
            case .newZealand: return "New Zealand"
            case .australia: return "Australia"
            }
        }
    }

    public init(
        slug: String,
        displayName: String,
        baseURL: URL,
        brandColorHex: String,
        defaultMapCenter: Coordinate,
        country: Country = .newZealand,
        timeZone: TimeZone = TimeZone(identifier: "Pacific/Auckland")!,
        hasRealtime: Bool = true
    ) {
        self.slug = slug
        self.displayName = displayName
        self.baseURL = baseURL
        self.brandColorHex = brandColorHex
        self.defaultMapCenter = defaultMapCenter
        self.country = country
        self.timeZone = timeZone
        self.hasRealtime = hasRealtime
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

    public static let otago = Region(
        slug: "otago",
        displayName: "Otago",
        baseURL: URL(string: "https://trainapi.suddsy.dev/otago")!,
        brandColorHex: "00ff00",
        defaultMapCenter: Coordinate(latitude: -45.8788, longitude: 170.5028),
        hasRealtime: false
    )

    public static let southEastQueensland = Region(
        slug: "seq",
        displayName: "South East Queensland",
        baseURL: URL(string: "https://trainapi.suddsy.dev/seq")!,
        brandColorHex: "ff0000",
        defaultMapCenter: Coordinate(latitude: -27.4698, longitude: 153.0251),
        country: .australia,
        timeZone: TimeZone(identifier: "Australia/Brisbane")!
    )

    public static let all: [Region] = [.auckland, .wellington, .christchurch, .otago, .southEastQueensland]

    /// `all` split by country, in `Country` order, for the region pickers.
    public static var byCountry: [(country: Country, regions: [Region])] {
        Country.allCases.compactMap { country in
            let regions = all.filter { $0.country == country }
            return regions.isEmpty ? nil : (country, regions)
        }
    }

    /// Looks a region up by its URL slug (`at`/`wel`/`christ`/`otago`/`seq`) - used when a
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
