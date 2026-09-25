import Foundation

/// The `{code, message, data, trace_id}` envelope every non-notification
/// backend response is wrapped in (`providers.Response` on the Go side).
/// `data` is optional in the envelope (`omitempty`) - a few endpoints (e.g.
/// the plan-busy 503) return no data at all.
struct Envelope<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?
    let traceID: String

    enum CodingKeys: String, CodingKey {
        case code, message, data
        case traceID = "trace_id"
    }
}

/// The `{code, message, data}` envelope the `/notifications/*` group uses -
/// same shape minus `trace_id` (see providers/notifications.Response on the
/// Go side; it was never given a trace id field).
struct NotificationsEnvelope<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?
}
