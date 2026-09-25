import Foundation
import SwiftData

// SwiftData models replacing the web app's localStorage keys (see
// `lib/url-store.ts`, `components/stops/favourites.tsx`,
// `components/journey/use-saved-trips.ts`/`use-active-journey.ts`). CRUD
// rules that live in view logic on the web (max 8 favourites, max 5 recents
// per category, evicting the oldest) belong in the view models that use
// these, not here - these are just the persisted shape.

/// A starred stop, shown in the home screen's favourites rail.
@Model
public final class FavouriteStop {
    /// The parent stop id (or a "name + code" search string, matching
    /// whichever the web app currently stores - to be confirmed once the
    /// favourites UI is built).
    public var stopID: String
    public var displayName: String
    /// Hex colour with no leading '#', cycled from a fixed swatch list on
    /// creation (`SWATCH_COLORS` on the web).
    public var colorHex: String
    /// Drag-reorder position; lower sorts first.
    public var sortOrder: Int
    public var createdAt: Date

    public init(stopID: String, displayName: String, colorHex: String, sortOrder: Int, createdAt: Date = Date()) {
        self.stopID = stopID
        self.displayName = displayName
        self.colorHex = colorHex
        self.sortOrder = sortOrder
        self.createdAt = createdAt
    }
}

/// A saved journey-planner search (start/end + planning options), shown in
/// the planner's "quick trips" rail.
@Model
public final class SavedTrip {
    public var name: String
    public var startLabel: String
    public var startLat: Double
    public var startLon: Double
    public var endLabel: String
    public var endLat: Double
    public var endLon: Double
    public var savedAt: Date
    public var maxWalkKm: Double
    public var walkSpeed: Double
    public var maxTransfers: Int
    public var colorHex: String
    /// Route ids this trip's planner results are filtered to; empty = no filter.
    public var onlyRouteIDs: [String]
    /// Display names for `onlyRouteIDs`, same order ("Only: 70, NX1").
    /// Added 2026-09-23 - defaulted so existing stores migrate in place.
    public var onlyRouteNames: [String] = []
    /// "Show N journeys" (3/5/8). Added 2026-09-23.
    public var minResults: Int = 3
    /// `TravelMode` raw values this trip plans with (empty = any), and the
    /// extra change time - set by the step-by-step planner. Added 2026-09-24.
    public var modes: [String] = []
    public var minTransferSec: Int = 0
    public var sortOrder: Int

    public init(
        name: String,
        startLabel: String, startCoordinate: Coordinate,
        endLabel: String, endCoordinate: Coordinate,
        savedAt: Date = Date(),
        maxWalkKm: Double = 1.0,
        walkSpeed: Double = 4.8,
        maxTransfers: Int = 5,
        colorHex: String,
        onlyRouteIDs: [String] = [],
        sortOrder: Int = 0
    ) {
        self.name = name
        self.startLabel = startLabel
        self.startLat = startCoordinate.latitude
        self.startLon = startCoordinate.longitude
        self.endLabel = endLabel
        self.endLat = endCoordinate.latitude
        self.endLon = endCoordinate.longitude
        self.savedAt = savedAt
        self.maxWalkKm = maxWalkKm
        self.walkSpeed = walkSpeed
        self.maxTransfers = maxTransfers
        self.colorHex = colorHex
        self.onlyRouteIDs = onlyRouteIDs
        self.sortOrder = sortOrder
    }

    public var startCoordinate: Coordinate { Coordinate(latitude: startLat, longitude: startLon) }
    public var endCoordinate: Coordinate { Coordinate(latitude: endLat, longitude: endLon) }
    public var travelModes: Set<TravelMode> {
        get { Set(modes.compactMap(TravelMode.init(rawValue:))) }
        set { modes = TravelMode.allCases.filter(newValue.contains).map(\.rawValue) }
    }
}

/// A place the rider has named - "Home", "Work", a friend's house - offered
/// first in every planner location field and as one-tap "get me there"
/// shortcuts on Home. Added 2026-09-25.
@Model
public final class SavedPlace {
    public var name: String
    /// The address or search label it was picked from ("12 Ponsonby Road").
    public var address: String
    public var latitude: Double
    public var longitude: Double
    /// A `SavedPlaceIcon` raw value; unknown values fall back to a pin.
    public var icon: String
    /// The region it was saved in - places only show in that region.
    public var regionSlug: String
    public var sortOrder: Int
    public var createdAt: Date

    public init(name: String, address: String, coordinate: Coordinate, icon: String, regionSlug: String, sortOrder: Int, createdAt: Date = Date()) {
        self.name = name
        self.address = address
        self.latitude = coordinate.latitude
        self.longitude = coordinate.longitude
        self.icon = icon
        self.regionSlug = regionSlug
        self.sortOrder = sortOrder
        self.createdAt = createdAt
    }

    public var coordinate: Coordinate {
        get { Coordinate(latitude: latitude, longitude: longitude) }
        set {
            latitude = newValue.latitude
            longitude = newValue.longitude
        }
    }
}

/// The journey the rider is currently on (or was, within the resume grace
/// period) - drives the "resume journey" pill and the Live Activity.
///
/// Deliberately thin: unlike the web app's `localStorage["activeJourney"]`
/// (which caches the whole `JourneyType` object graph), this stores just
/// enough to refetch - `planID` + `regionSlug` - via `APIClient.plan(id:)`,
/// which the backend keeps cached for ~6h after arrival for exactly this
/// purpose. At most one row should exist at a time; the view model owns
/// enforcing that and the 45-minute-after-arrival expiry
/// (`RESUME_GRACE_MS` on the web).
@Model
public final class ActiveJourney {
    public var planID: String
    public var regionSlug: String
    public var startedAt: Date
    public var endLabel: String
    public var arrivalTime: Date
    /// The device-generated id of the Live Activity started for this
    /// journey, if any (nil until Live Activities are wired up).
    public var liveActivityID: String?
    /// `JourneyProgressModel.alightedThroughLeg`, saved as it advances so a
    /// relaunched tracker resumes on the right leg (-1 = none yet).
    public var alightedThroughLeg: Int = -1

    public init(planID: String, regionSlug: String, startedAt: Date = Date(), endLabel: String, arrivalTime: Date, liveActivityID: String? = nil) {
        self.planID = planID
        self.regionSlug = regionSlug
        self.startedAt = startedAt
        self.endLabel = endLabel
        self.arrivalTime = arrivalTime
        self.liveActivityID = liveActivityID
    }
}

/// One entry in a recent-searches list - stop search, route search, and each
/// journey-planner location field keep their own list (`category`
/// distinguishes them, mirroring the web's per-input `storageKey`), each
/// capped at 5 by the view model that reads/writes these.
@Model
public final class RecentSearchEntry {
    public var category: String
    public var text: String
    public var searchedAt: Date

    public init(category: String, text: String, searchedAt: Date = Date()) {
        self.category = category
        self.text = text
        self.searchedAt = searchedAt
    }
}
