import Foundation

/// A Go `time.Duration`, which the backend always serializes as a raw
/// integer count of nanoseconds (`JourneyPlan.TotalDuration`,
/// `JourneyLeg.Duration`) - never a string, so this decodes a bare `Int64`.
public struct GoDuration: Codable, Hashable, Sendable {
    public let nanoseconds: Int64

    public init(nanoseconds: Int64) { self.nanoseconds = nanoseconds }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        nanoseconds = try container.decode(Int64.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(nanoseconds)
    }

    public var timeInterval: TimeInterval { TimeInterval(nanoseconds) / 1_000_000_000 }
}

/// A Go `time.Time`, serialized as an RFC3339 string - sometimes with
/// fractional seconds (`"2026-09-22T16:24:00.838434226+12:00"`), sometimes
/// without (`"2026-09-22T16:27:00+12:00"`), and sometimes as Go's zero value
/// (`"0001-01-01T00:00:00Z"`, used by `JourneyLeg.scheduled_departure_time`/
/// `scheduled_arrival_time` on a walk leg, which has no schedule). The zero
/// value decodes to `date == nil` rather than a bogus 1st-century Date.
public struct GoTime: Codable, Hashable, Sendable {
    public let date: Date?
    public let raw: String

    private static let zeroTimePrefix = "0001-01-01T00:00:00"

    private static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let withoutFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    public init(date: Date?, raw: String = "") {
        self.date = date
        self.raw = raw
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self.raw = raw
        if raw.hasPrefix(Self.zeroTimePrefix) {
            self.date = nil
        } else {
            self.date = Self.withFractionalSeconds.date(from: raw) ?? Self.withoutFractionalSeconds.date(from: raw)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(raw)
    }
}

/// A Go `time.Time` serialized as epoch milliseconds (`realtime/stop-times`'s
/// `arrival_time`/`departure_time`/`scheduled_time` - unlike `GoTime`, these
/// three are integers, not RFC3339 strings).
public struct GoEpochMillis: Codable, Hashable, Sendable {
    public let milliseconds: Int64

    public init(milliseconds: Int64) { self.milliseconds = milliseconds }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        milliseconds = try container.decode(Int64.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(milliseconds)
    }

    public var date: Date { Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000) }
}
