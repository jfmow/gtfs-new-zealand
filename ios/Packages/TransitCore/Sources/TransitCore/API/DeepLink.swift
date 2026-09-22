import Foundation

/// A parsed inbound link - a share link, a resumed journey, or a push
/// notification's deeplink. Mirrors the web app's query-param schema
/// (`useQueryParams` on `/journey` and `/trip`) so the same links work on
/// both platforms.
///
/// Currently only reachable via the `transit://` custom scheme
/// (`transit://journey?id=...&region=at`) - true universal links
/// (`https://<domain>/journey?...`) need an Associated Domains entitlement
/// and a hosted `apple-app-site-association` file on the web app's domain,
/// which isn't set up yet. `DeepLink.init(url:)` accepts either shape so
/// switching later doesn't change this parsing.
public enum DeepLink: Equatable, Sendable, Identifiable {
    case journey(id: String, region: String?)
    case trip(tripID: String, region: String?)

    /// For `.fullScreenCover(item:)`/`.sheet(item:)` - not the underlying
    /// journey/trip id (which could collide between the two cases).
    public var id: String {
        switch self {
        case .journey(let id, let region): return "journey:\(region ?? "")/\(id)"
        case .trip(let tripID, let region): return "trip:\(region ?? "")/\(tripID)"
        }
    }

    public init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        // `transit://journey?...` -> host="journey", the route. A universal
        // link (`https://<domain>/journey?...`) always has a host too (the
        // domain), so the route there is the path instead - can't just fall
        // back to path when host is nil, host is never nil for either shape.
        let route: String
        if components.scheme?.lowercased() == "transit" {
            route = (components.host ?? "").lowercased()
        } else {
            route = components.path
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .lowercased()
        }

        var query: [String: String] = [:]
        for item in components.queryItems ?? [] {
            if let value = item.value { query[item.name] = value }
        }

        switch route {
        case "journey":
            guard let id = query["id"], !id.isEmpty else { return nil }
            self = .journey(id: id, region: query["region"])
        case "trip":
            guard let tripID = query["tripId"], !tripID.isEmpty else { return nil }
            self = .trip(tripID: tripID, region: query["region"])
        default:
            return nil
        }
    }
}
