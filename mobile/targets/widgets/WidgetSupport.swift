import Foundation

// The few pieces of TransitCore the widget extension needs, so it builds on
// its own inside the Expo project (the old SwiftUI app's TransitCore package is gone).
// Keep in step with packages/shared: regions.ts, formatting.ts, logic/basics.ts.

struct Region: Hashable, Sendable {
    let slug: String
    let baseURL: URL

    static let auckland = Region(slug: "at", baseURL: URL(string: "https://trainapi.suddsy.dev/at")!)

    static func bySlug(_ slug: String) -> Region? {
        guard ["at", "wel", "christ", "otago", "seq"].contains(slug),
              let url = URL(string: "https://trainapi.suddsy.dev/\(slug)") else { return nil }
        return Region(slug: slug, baseURL: url)
    }
}

enum APIError: Error {
    case server(code: Int, message: String, traceID: String?)
    case transport
}

struct RouteSummary: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let color: String
}

/// One departures-board row - only the fields the widget shows.
struct Departure: Decodable, Hashable, Sendable {
    let headsign: String
    let route: RouteSummary
    let canceled: Bool
    let skipped: Bool
    let departed: Bool
    let timeTillArrival: Double
    let locationTracking: Bool
    let tripUpdateTracking: Bool

    enum CodingKeys: String, CodingKey {
        case headsign, route, canceled, skipped, departed
        case timeTillArrival = "time_till_arrival"
        case locationTracking = "location_tracking"
        case tripUpdateTracking = "trip_update_tracking"
    }
}

private struct Envelope<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?
}

struct APIClient {
    let region: Region

    init(region: Region) {
        self.region = region
    }

    func departures(stop: String, limit: Int) async throws -> [Departure] {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        let segment = stop.addingPercentEncoding(withAllowedCharacters: allowed) ?? stop
        guard let url = URL(string: "\(region.baseURL.absoluteString)/services/\(segment)?limit=\(limit)") else { throw APIError.transport }
        let (data, response) = try await URLSession.shared.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard let envelope = try? JSONDecoder().decode(Envelope<[Departure]>.self, from: data) else {
            throw APIError.server(code: status, message: "request failed", traceID: nil)
        }
        guard (200..<300).contains(envelope.code) else {
            throw APIError.server(code: envelope.code, message: envelope.message, traceID: nil)
        }
        return envelope.data ?? []
    }
}

enum TimeFormatting {
    static func timeTillArrivalString(minutes: Double) -> String {
        if minutes < 0 { return "Departed" }
        if minutes < 1 { return "Now" }
        let total = Int(minutes.rounded())
        if total >= 60 * 24 { let d = total / (60 * 24); return d == 1 ? "1 day" : "\(d) days" }
        if total < 60 { return "\(total) min" }
        let h = total / 60, m = total % 60
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }

    static func niceLookingWords(_ text: String, retainDigits: Bool = false) -> String {
        var words = text
        if !retainDigits { words = words.replacingOccurrences(of: #"\d+"#, with: "", options: .regularExpression) }
        words = words.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return words.split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}
