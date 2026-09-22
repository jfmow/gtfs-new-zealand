import Foundation

enum FixtureLoader {
    enum FixtureError: Error { case notFound(String) }

    /// Loads a JSON fixture captured from a live API response (see each
    /// fixture file's provenance note in the test that uses it).
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            throw FixtureError.notFound(name)
        }
        return try Data(contentsOf: url)
    }
}
