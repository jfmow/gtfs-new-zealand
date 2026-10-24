import Foundation

/// A journey's fare - `fares.Estimate` on the backend
/// (`providers/fares/fares.go`).
public struct FareEstimate: Codable, Hashable, Sendable {
    public struct Part: Codable, Hashable, Sendable {
        /// The plan's leg indexes this fare covers.
        public let legs: [Int]
        public let cents: Int
        public let label: String
        public let detail: String
    }

    public let cents: Int
    /// "NZD" | "AUD".
    public let currency: String
    /// "$4.90" - "$4.90+" when some rides couldn't be priced.
    public let label: String
    /// "AT HOP or contactless · 2 zones".
    public let detail: String
    /// Caps, off-peak.
    public let note: String?
    public let partial: Bool
    public let parts: [Part]
    /// The fare type priced - "adult" when the region has no fare for the
    /// one asked for. Absent from older servers.
    public let concession: String?
}

/// `GET fares`.
public struct FaresResponse: Codable, Sendable {
    /// Plan id -> fare; nil where it can't be estimated.
    public let fares: [String: FareEstimate?]
}

/// Settings' "Fare type" - which fare estimates show (`fares.Concession`
/// on the backend, `FareType` in the web's `lib/fare-type.ts`). A region
/// without the concession prices the adult fare and says so.
public enum FareType: String, CaseIterable, Sendable {
    case adult, child, youth, tertiary, community, supergold, accessible

    /// Each region's choice, as `region=type;...` - see `FareTypeChoices`.
    public static let storageKey = "fareTypes"
    /// Settings' "Show fares" - on unless the rider turns it off.
    public static let showFaresKey = "showFares"
}

/// A fare type the current region offers, in its own words -
/// `GET fares/types`.
public struct FareTypeOption: Codable, Hashable, Sendable, Identifiable {
    public let value: String
    public let label: String
    public let detail: String?
    public var id: String { value }

    public init(value: String, label: String, detail: String? = nil) {
        self.value = value
        self.label = label
        self.detail = detail
    }

    /// Until a region's list loads (or if it can't).
    public static let adultOnly = [FareTypeOption(value: FareType.adult.rawValue, label: "Adult")]
}

/// `GET fares/types`.
public struct FareTypesResponse: Codable, Sendable {
    public let types: [FareTypeOption]
}

/// Each region keeps its own fare type - one stored string,
/// `"at=child;wel=supergold"`, so every screen reading it updates together.
public enum FareTypeChoices {
    public static func choice(in stored: String, region: String) -> FareType {
        parse(stored)[region].flatMap(FareType.init(rawValue:)) ?? .adult
    }

    public static func setting(_ type: FareType, for region: String, in stored: String) -> String {
        var map = parse(stored)
        map[region] = type.rawValue
        return map.keys.sorted().map { "\($0)=\(map[$0]!)" }.joined(separator: ";")
    }

    private static func parse(_ stored: String) -> [String: String] {
        var map: [String: String] = [:]
        for pair in stored.split(separator: ";") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2 { map[String(parts[0])] = String(parts[1]) }
        }
        return map
    }
}
