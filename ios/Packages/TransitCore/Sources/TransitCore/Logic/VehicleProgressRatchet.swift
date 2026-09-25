import Foundation

/// Keeps a tracked vehicle from appearing to go backwards along its trip.
///
/// AT's feed jitters around stops - STOPPED_AT and INCOMING_AT for the same
/// stop alternate, and a stopped vehicle whose GPS sits more than 100m from
/// the stop's coordinates falls back to a timetable guess - so from one poll
/// to the next the next stop could step back by one, and "2 stops away"
/// would flick back to 3. A vehicle doesn't reverse along its trip, so a
/// lower next stop is only believed once it has lasted `holdSeconds`
/// (a genuine correction); until then the furthest point reached stands,
/// with the new position.
public final class VehicleProgressRatchet {
    public static let holdSeconds: TimeInterval = 20

    private struct Held {
        var vehicle: Vehicle
        var regressedSince: Date?
    }

    private var held: [String: Held] = [:]

    public init() {}

    public func reset() { held = [:] }

    public func apply(_ vehicle: Vehicle, now: Date) -> Vehicle {
        guard let next = vehicle.trip?.nextStop?.sequence,
              let previous = held[vehicle.tripID],
              let heldNext = previous.vehicle.trip?.nextStop?.sequence,
              next < heldNext
        else {
            held[vehicle.tripID] = Held(vehicle: vehicle)
            return vehicle
        }

        let since = previous.regressedSince ?? now
        if now.timeIntervalSince(since) >= Self.holdSeconds {
            held[vehicle.tripID] = Held(vehicle: vehicle)
            return vehicle
        }
        held[vehicle.tripID] = Held(vehicle: previous.vehicle, regressedSince: since)
        return Vehicle(
            tripID: vehicle.tripID, route: vehicle.route, trip: previous.vehicle.trip,
            occupancy: vehicle.occupancy, licensePlate: vehicle.licensePlate, position: vehicle.position,
            type: vehicle.type, state: previous.vehicle.state, offCourse: vehicle.offCourse
        )
    }
}
