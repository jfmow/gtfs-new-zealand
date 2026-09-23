import Foundation

/// `POST /{region}/live-activities`'s response.
public struct LiveActivityRegistered: Codable, Hashable, Sendable {
    public let id: Int
}
