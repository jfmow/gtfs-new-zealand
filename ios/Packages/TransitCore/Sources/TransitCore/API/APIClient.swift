import Foundation

/// Talks to the Go backend for whichever `Region` is currently selected.
/// One instance is shared app-wide (region switches - e.g. from a shared
/// link's `region=` - just call `setRegion`, no need to recreate it).
///
/// Mirrors `lib/url-context.tsx`'s `ApiFetch`: every request carries
/// `X-Trace-ID`, every response is unwrapped from its `{code,message,data,
/// trace_id}` envelope, and a non-2xx `code` becomes a thrown `APIError`.
public actor APIClient {
    public private(set) var region: Region
    private let session: URLSession
    private let traceID: String
    private let decoder: JSONDecoder
    private var deviceIdentity: DeviceIdentity?

    public init(region: Region = .auckland, session: URLSession = .shared, traceID: String? = nil) {
        self.region = region
        self.session = session
        self.traceID = traceID ?? InstallIdentity.traceID()
        self.decoder = JSONDecoder()
    }

    public func setRegion(_ region: Region) {
        self.region = region
    }

    /// Every `POST` from here on carries `X-Device-Id`/`X-Device-Secret`, so
    /// `/notifications/*` calls resolve to this device without needing to
    /// pass its identity as form fields each time (see backend
    /// `identityFromRequest`, which reads these headers first).
    public func setDeviceIdentity(_ identity: DeviceIdentity?) {
        self.deviceIdentity = identity
    }

    /// GET a path relative to the current region's base URL (e.g. "stops",
    /// "services/plan"), decoding the response envelope and returning `data`.
    @discardableResult
    public func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await send(buildRequest(method: "GET", path: path, query: query))
    }

    /// POST `application/x-www-form-urlencoded` to a path relative to the
    /// current region's base URL - every `/notifications/*` and `/devices/*`
    /// endpoint uses this shape (`c.FormValue` on the Go side), not JSON.
    @discardableResult
    public func postForm<T: Decodable>(_ path: String, form: [String: String]) async throws -> T {
        try await send(buildFormRequest(path: path, form: form), envelope: NotificationsEnvelope<T>.self)
    }

    /// `postForm` for the many `/notifications/*` endpoints that return
    /// `{code,message}` with a `data` of `null` on success (e.g. `/add`,
    /// `/remove`, `/history/clear`) - `postForm`'s "empty `data` means
    /// error" rule is right for endpoints that promise a payload, but wrong
    /// here, so this only checks `code`.
    public func postFormExpectingNoData(_ path: String, form: [String: String]) async throws {
        let request = try buildFormRequest(path: path, form: form)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(underlying: error)
        }
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        do {
            let decoded = try decoder.decode(CodeAndMessage.self, from: data)
            guard (200..<300).contains(decoded.code) else {
                throw APIError.server(code: decoded.code, message: decoded.message, traceID: nil)
            }
        } catch let error as APIError {
            throw error
        } catch {
            guard (200..<300).contains(statusCode) else {
                throw APIError.server(code: statusCode, message: "request failed", traceID: nil)
            }
            throw APIError.decoding(underlying: error, traceID: nil)
        }
    }

    // MARK: - Request building

    /// Percent-encodes one path segment, including "/" - stop names like
    /// "Customs St/Britomart 11815" are path segments on the backend
    /// (`/services/{stop}`), and an unencoded slash 404s.
    static func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    /// `TRANSIT_API_BASE` (e.g. `http://localhost:8090`) swaps the API host
    /// for every region, to run the app against a local backend. Read from
    /// the environment (scheme / UI test) or, so it also applies when iOS
    /// launches the app in the background (push-to-start, background
    /// fetch), from UserDefaults:
    /// `xcrun simctl spawn booted defaults write dev.suddsy.transit TRANSIT_API_BASE http://localhost:8090`.
    /// Ignored in Release builds.
    static func effectiveBaseURL(for region: Region) -> URL {
        #if DEBUG
        let override = ProcessInfo.processInfo.environment["TRANSIT_API_BASE"]
            ?? UserDefaults.standard.string(forKey: "TRANSIT_API_BASE")
        if let override, !override.isEmpty, let base = URL(string: override) {
            return base.appendingPathComponent(region.slug)
        }
        #endif
        return region.baseURL
    }

    private func buildRequest(method: String, path: String, query: [URLQueryItem]) throws -> URLRequest {
        // `path` arrives percent-encoded (dynamic parts go through
        // `pathSegment`), so it's appended verbatim - appendingPathComponent
        // would encode it again, and can't tell a "/" inside a stop name
        // ("Customs St/Britomart") from a path separator.
        guard var components = URLComponents(url: Self.effectiveBaseURL(for: region), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        let basePath = components.percentEncodedPath.hasSuffix("/") ? String(components.percentEncodedPath.dropLast()) : components.percentEncodedPath
        components.percentEncodedPath = basePath + "/" + path
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(traceID, forHTTPHeaderField: "X-Trace-ID")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func buildFormRequest(path: String, form: [String: String]) throws -> URLRequest {
        var request = try buildRequest(method: "POST", path: path, query: [])
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        if let deviceIdentity {
            request.setValue(deviceIdentity.id, forHTTPHeaderField: "X-Device-Id")
            request.setValue(deviceIdentity.secret, forHTTPHeaderField: "X-Device-Secret")
        }
        request.httpBody = form
            .map { key, value in "\(formEncode(key))=\(formEncode(value))" }
            .sorted()
            .joined(separator: "&")
            .data(using: .utf8)
        return request
    }

    private func formEncode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Response handling

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        try await send(request, envelope: Envelope<T>.self)
    }

    private func send<E: EnvelopeDecoding>(_ request: URLRequest, envelope: E.Type) async throws -> E.Value {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(underlying: error)
        }

        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0

        do {
            let decoded = try decoder.decode(E.self, from: data)
            guard (200..<300).contains(decoded.code) else {
                throw APIError.server(code: decoded.code, message: decoded.message, traceID: decoded.envelopeTraceID)
            }
            guard let value = decoded.value else {
                throw APIError.server(code: decoded.code, message: "empty response", traceID: decoded.envelopeTraceID)
            }
            return value
        } catch let error as APIError {
            throw error
        } catch {
            // A response that doesn't even match the envelope shape (e.g. the
            // rate limiter's bare `null` body on 429) - fall back to the HTTP
            // status so callers still get a meaningful error.
            guard (200..<300).contains(statusCode) else {
                throw APIError.server(code: statusCode, message: "request failed", traceID: nil)
            }
            throw APIError.decoding(underlying: error, traceID: nil)
        }
    }
}

/// Lets `send(_:envelope:)` work generically over both envelope shapes
/// (`Envelope<T>` for most endpoints, `NotificationsEnvelope<T>` for
/// `/notifications/*` and `/devices/*`, which omit `trace_id`).
private protocol EnvelopeDecoding: Decodable {
    associatedtype Value: Decodable
    var code: Int { get }
    var message: String { get }
    var value: Value? { get }
    var envelopeTraceID: String? { get }
}

extension Envelope: EnvelopeDecoding {
    fileprivate var value: T? { data }
    fileprivate var envelopeTraceID: String? { traceID }
}

extension NotificationsEnvelope: EnvelopeDecoding {
    fileprivate var value: T? { data }
    fileprivate var envelopeTraceID: String? { nil }
}

/// Just enough of the notifications envelope to check success -
/// `postFormExpectingNoData`'s decode target.
private struct CodeAndMessage: Decodable {
    let code: Int
    let message: String
}
