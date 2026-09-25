import Foundation

/// Errors surfaced by APIClient. `server` carries the trace id the backend
/// returned (or the client generated, if the server never replied) so error
/// screens can show a "copy trace id" affordance the way the web app's
/// ErrorScreen does.
public enum APIError: Error, Sendable {
    case invalidURL
    case transport(underlying: any Error)
    case decoding(underlying: any Error, traceID: String?)
    /// The server replied with a non-2xx `code` in its envelope, or a non-2xx
    /// HTTP status with no decodable envelope at all.
    case server(code: Int, message: String, traceID: String?)
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid request URL."
        case .transport(let underlying):
            return underlying.localizedDescription
        case .decoding(let underlying, _):
            return "Couldn't understand the server's response: \(underlying.localizedDescription)"
        case .server(_, let message, _):
            return message.isEmpty ? "The server returned an error." : message
        }
    }

    /// The trace id to show for support/debugging, if one is known.
    public var traceID: String? {
        switch self {
        case .decoding(_, let traceID): return traceID
        case .server(_, _, let traceID): return traceID
        case .invalidURL, .transport: return nil
        }
    }
}
