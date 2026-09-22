import XCTest
@testable import TransitCore

final class APIClientTests: XCTestCase {
    private func makeMockedClient(
        region: Region = .auckland,
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        MockURLProtocol.requestHandler = handler
        return APIClient(region: region, session: URLSession(configuration: config), traceID: "test-trace-id")
    }

    private func jsonResponse(_ url: URL, status: Int = 200, body: String) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (response, Data(body.utf8))
    }

    func testGetDecodesEnvelopeData() async throws {
        let client = makeMockedClient { request in
            self.jsonResponse(request.url!, body: """
            {"code":200,"message":"","data":[{"stop_id":"1","parent_station":"","stop_name":"Test","stop_code":"1",
            "stop_headsign":"","stop_lat":1.0,"stop_lon":2.0,"platform_number":"","stop_sequence":0,
            "is_child_stop":false,"location_type":0,"stop_type":"bus","wheelchair_boarding":0}],"trace_id":"abc"}
            """)
        }
        let stops: [Stop] = try await client.get("stops")
        XCTAssertEqual(stops.first?.stopName, "Test")
    }

    func testGetThrowsServerErrorForNon2xxEnvelopeCode() async {
        let client = makeMockedClient { request in
            self.jsonResponse(request.url!, status: 400, body: """
            {"code":400,"message":"invalid stop id","data":null,"trace_id":"xyz"}
            """)
        }
        do {
            let _: [Stop] = try await client.get("stops")
            XCTFail("expected an error")
        } catch let APIError.server(code, message, traceID) {
            XCTAssertEqual(code, 400)
            XCTAssertEqual(message, "invalid stop id")
            XCTAssertEqual(traceID, "xyz")
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func testGetFallsBackToHTTPStatusWhenBodyIsNotAnEnvelope() async {
        // The rate limiter returns a bare `null` body on 429, not the usual
        // {code,message,data,trace_id} shape.
        let client = makeMockedClient { request in
            self.jsonResponse(request.url!, status: 429, body: "null")
        }
        do {
            let _: [Stop] = try await client.get("stops")
            XCTFail("expected an error")
        } catch let APIError.server(code, _, _) {
            XCTAssertEqual(code, 429)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func testRequestCarriesTraceIDHeaderAndRegionBaseURL() async throws {
        var capturedRequest: URLRequest?
        let client = makeMockedClient(region: .wellington) { request in
            capturedRequest = request
            return self.jsonResponse(request.url!, body: #"{"code":200,"message":"","data":[],"trace_id":"t"}"#)
        }
        let _: [Stop] = try await client.get("stops")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Trace-ID"), "test-trace-id")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://trainapi.suddsy.dev/wel/stops")
    }

    func testSetRegionChangesSubsequentRequestsBaseURL() async throws {
        var capturedURLs: [URL] = []
        let client = makeMockedClient(region: .auckland) { request in
            capturedURLs.append(request.url!)
            return self.jsonResponse(request.url!, body: #"{"code":200,"message":"","data":[],"trace_id":"t"}"#)
        }
        let _: [Stop] = try await client.get("stops")
        await client.setRegion(.christchurch)
        let _: [Stop] = try await client.get("stops")

        XCTAssertEqual(capturedURLs.count, 2)
        XCTAssertTrue(capturedURLs[0].absoluteString.hasPrefix("https://trainapi.suddsy.dev/at"))
        XCTAssertTrue(capturedURLs[1].absoluteString.hasPrefix("https://trainapi.suddsy.dev/christ"))
    }

    func testPostFormEncodesBodyAndDecodesNotificationsEnvelope() async throws {
        var capturedRequest: URLRequest?
        var capturedBody: String?
        let client = makeMockedClient { request in
            capturedRequest = request
            if let stream = request.httpBodyStream {
                stream.open()
                var data = Data()
                let bufferSize = 1024
                var buffer = [UInt8](repeating: 0, count: bufferSize)
                while stream.hasBytesAvailable {
                    let read = stream.read(&buffer, maxLength: bufferSize)
                    if read > 0 { data.append(buffer, count: read) }
                }
                capturedBody = String(data: data, encoding: .utf8)
            } else if let body = request.httpBody {
                capturedBody = String(data: body, encoding: .utf8)
            }
            return self.jsonResponse(request.url!, body: #"{"code":200,"message":"added","data":{"id":1}}"#)
        }

        struct Created: Decodable { let id: Int }
        let created: Created = try await client.postForm("notifications/add", form: ["stopIdOrName": "Britomart", "routes": ""])

        XCTAssertEqual(created.id, 1)
        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        let body = try XCTUnwrap(capturedBody)
        XCTAssertTrue(body.contains("stopIdOrName=Britomart"))
        XCTAssertTrue(body.contains("routes="))
    }
}
