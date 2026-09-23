import ActivityKit
import Foundation

/// The Live Activity contract for journey progress - built by the app
/// (`LiveActivityContentBuilder` in TransitCore, while the app is open) and
/// by the backend (`journeyActivityState` in live_activity_state.go, pushed
/// while it isn't), and rendered by the widget extension. Lives in `Shared/`
/// because both the app and the widget need it; deliberately ActivityKit/
/// Foundation only so the widget doesn't pull in TransitCore.
public struct JourneyActivityAttributes: ActivityAttributes {
    /// v2 (2026-09-23). Times are plain Unix seconds, not `Date`s, so the
    /// server never has to guess which epoch ActivityKit decodes against.
    /// Every field decodes leniently (missing -> default), so a payload from
    /// an older or newer server still renders instead of failing silently.
    public struct ContentState: Codable, Hashable {
        public struct NextLeg: Codable, Hashable {
            public var routeShortName: String
            public var routeColorHex: String
            public var departureUnix: Double
            public var connectMinutes: Int
        }

        public struct LegChip: Codable, Hashable {
            public var mode: String
            public var shortName: String
            public var colorHex: String
        }

        public var version: Int
        public var legIndex: Int
        /// walking | waiting | boarding | onboard | arrived
        public var phase: String
        public var routeShortName: String
        public var routeColorHex: String
        public var headsign: String
        public var primaryText: String
        public var secondaryText: String
        /// "Leave in" / "Departs in" / "Arrives in" / "Arrive in"
        public var countdownLabel: String
        public var targetUnix: Double
        public var delayMinutes: Int
        /// onTime | delayed | early | cancelled | tightConnection | missedConnection | arrived
        public var status: String
        public var stopsAway: Int?
        public var arrivalUnix: Double
        public var progressFraction: Double
        public var totalLegs: Int
        public var platform: String?
        public var nextLeg: NextLeg?
        public var legChain: [LegChip]
        public var updatedUnix: Double
        public var isRealtime: Bool
        // v3
        public var boardStopName: String?
        public var alightStopName: String?
        public var nextStopName: String?
        public var rideStops: Int?
        public var walkMinutes: Int?
        public var walkMeters: Int?
        public var hasVehicle: Bool
        public var occupancy: Int?

        public var targetDate: Date { Date(timeIntervalSince1970: targetUnix) }
        public var arrivalDate: Date { Date(timeIntervalSince1970: arrivalUnix) }
        public var updatedDate: Date { Date(timeIntervalSince1970: updatedUnix) }

        enum CodingKeys: String, CodingKey {
            case version, legIndex, phase, routeShortName, routeColorHex, headsign, primaryText, secondaryText
            case countdownLabel, targetUnix, delayMinutes, status, stopsAway, arrivalUnix, progressFraction
            case totalLegs, platform, nextLeg, legChain, updatedUnix, isRealtime
            case boardStopName, alightStopName, nextStopName, rideStops, walkMinutes, walkMeters, hasVehicle, occupancy
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 1
            legIndex = (try? c.decodeIfPresent(Int.self, forKey: .legIndex)) ?? 0
            phase = (try? c.decodeIfPresent(String.self, forKey: .phase)) ?? "walking"
            routeShortName = (try? c.decodeIfPresent(String.self, forKey: .routeShortName)) ?? ""
            routeColorHex = (try? c.decodeIfPresent(String.self, forKey: .routeColorHex)) ?? ""
            headsign = (try? c.decodeIfPresent(String.self, forKey: .headsign)) ?? ""
            primaryText = (try? c.decodeIfPresent(String.self, forKey: .primaryText)) ?? ""
            secondaryText = (try? c.decodeIfPresent(String.self, forKey: .secondaryText)) ?? ""
            countdownLabel = (try? c.decodeIfPresent(String.self, forKey: .countdownLabel)) ?? ""
            targetUnix = (try? c.decodeIfPresent(Double.self, forKey: .targetUnix)) ?? 0
            delayMinutes = (try? c.decodeIfPresent(Int.self, forKey: .delayMinutes)) ?? 0
            status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "onTime"
            stopsAway = try? c.decodeIfPresent(Int.self, forKey: .stopsAway)
            arrivalUnix = (try? c.decodeIfPresent(Double.self, forKey: .arrivalUnix)) ?? 0
            progressFraction = (try? c.decodeIfPresent(Double.self, forKey: .progressFraction)) ?? 0
            totalLegs = (try? c.decodeIfPresent(Int.self, forKey: .totalLegs)) ?? 0
            platform = try? c.decodeIfPresent(String.self, forKey: .platform)
            nextLeg = try? c.decodeIfPresent(NextLeg.self, forKey: .nextLeg)
            legChain = (try? c.decodeIfPresent([LegChip].self, forKey: .legChain)) ?? []
            updatedUnix = (try? c.decodeIfPresent(Double.self, forKey: .updatedUnix)) ?? 0
            isRealtime = (try? c.decodeIfPresent(Bool.self, forKey: .isRealtime)) ?? false
            boardStopName = try? c.decodeIfPresent(String.self, forKey: .boardStopName)
            alightStopName = try? c.decodeIfPresent(String.self, forKey: .alightStopName)
            nextStopName = try? c.decodeIfPresent(String.self, forKey: .nextStopName)
            rideStops = try? c.decodeIfPresent(Int.self, forKey: .rideStops)
            walkMinutes = try? c.decodeIfPresent(Int.self, forKey: .walkMinutes)
            walkMeters = try? c.decodeIfPresent(Int.self, forKey: .walkMeters)
            hasVehicle = (try? c.decodeIfPresent(Bool.self, forKey: .hasVehicle)) ?? false
            occupancy = try? c.decodeIfPresent(Int.self, forKey: .occupancy)
        }
    }

    public var planID: String
    public var destinationLabel: String
    public var regionSlug: String

    public init(planID: String, destinationLabel: String, regionSlug: String) {
        self.planID = planID
        self.destinationLabel = destinationLabel
        self.regionSlug = regionSlug
    }

    /// Opens the journey's live tracking in the app - the activity's
    /// `widgetURL`.
    public var journeyURL: URL? {
        URL(string: "transit://journey?id=\(planID)&region=\(regionSlug)&track=1")
    }
}
