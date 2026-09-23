import Foundation

/// One way to re-run the planner from mid-journey - `ReplanChoice` in the
/// web's `components/journey/helpers.ts`.
public struct ReplanChoice: Equatable, Sendable, Identifiable {
    public let key: String
    public let label: String
    public let detail: String
    public let originLabel: String
    public let origin: Coordinate
    public let departAt: Date

    public var id: String { key }
}

public enum JourneyReplan {
    /// The ways it makes sense to re-plan given where the rider is - usually
    /// two to pick from; empty on the final leg. Port of `replanChoices`.
    ///
    /// - Parameters:
    ///   - phase: walking | waiting | boarding | onboard (nil before start).
    ///   - vehicleNextStop: the tracked vehicle's next stop (name + position).
    public static func choices(
        legs: [JourneyLeg],
        progressLegIndex: Int,
        phase: String?,
        vehicleNextStop: (name: String, coordinate: Coordinate)?,
        vehicleNextStopETA: Date?,
        userLocation: Coordinate?,
        now: Date = Date()
    ) -> [ReplanChoice] {
        guard progressLegIndex >= 0, progressLegIndex < legs.count - 1 else { return [] }
        let leg = legs[progressLegIndex]
        var out: [ReplanChoice] = []

        func stopChoice(_ stop: Stop, key: String, label: String, detail: String, departAt: Date) -> ReplanChoice {
            ReplanChoice(key: key, label: label, detail: detail, originLabel: stop.stopName.isEmpty ? label : stop.stopName,
                         origin: stop.coordinate, departAt: departAt)
        }

        let ride = leg.mode == "transit" ? leg : legs[(progressLegIndex + 1)...].first { $0.mode == "transit" }
        let rideName: String = {
            if let name = ride?.route?.routeShortName, !name.isEmpty { return name }
            if let id = ride?.routeID, !id.isEmpty { return id }
            return "the next service"
        }()

        if phase == "onboard", leg.mode == "transit" {
            if let next = vehicleNextStop {
                out.append(ReplanChoice(
                    key: "next-stop",
                    label: "Get off at \(next.name)",
                    detail: vehicleNextStopETA.map { "re-route from ~\(LiveActivityContentBuilder.clock($0))" } ?? "re-route from there",
                    originLabel: next.name, origin: next.coordinate,
                    departAt: vehicleNextStopETA ?? now.addingTimeInterval(120)))
            }
            if let to = leg.toStop, let arrival = leg.arrivalTime.date {
                out.append(stopChoice(to, key: "alight", label: "Stay on to \(to.stopName)",
                                      detail: "re-route from there (arr \(LiveActivityContentBuilder.clock(arrival)))", departAt: arrival))
            }
            return out
        }

        if phase == "walking", leg.mode == "walk" {
            if let userLocation {
                out.append(ReplanChoice(key: "gps-now", label: "From where I am now", detail: "current location",
                                        originLabel: "Current location", origin: userLocation, departAt: now))
            }
            if let to = leg.toStop, let arrival = leg.arrivalTime.date {
                out.append(stopChoice(to, key: "target-stop", label: "From \(to.stopName)",
                                      detail: "when you get there (~\(LiveActivityContentBuilder.clock(arrival)))", departAt: arrival))
            }
            return out
        }

        // waiting / boarding: at (or reaching) a stop, about to take `ride`.
        if let here = leg.mode == "transit" ? leg.fromStop : leg.toStop {
            out.append(stopChoice(here, key: "here-now", label: "Leave from \(here.stopName) now",
                                  detail: "a different way from here", departAt: now))
        }
        if let ride, let to = ride.toStop, let arrival = ride.arrivalTime.date {
            out.append(stopChoice(to, key: "onward", label: "Take the \(rideName) anyway",
                                  detail: "re-route from \(to.stopName) (arr \(LiveActivityContentBuilder.clock(arrival)))", departAt: arrival))
        }
        return out
    }
}
