import TransitCore

/// A chosen from/to point in the planner - either typed and picked from
/// search, or "current location".
struct PlannerLocation: Hashable {
    var label: String
    var coordinate: Coordinate
}
