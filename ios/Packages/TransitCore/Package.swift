// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "TransitCore",
    // .macOS(.v14) is needed so `swift build`/`swift test` (which build for
    // the host, macOS, unless cross-compiling) satisfy SwiftData's own
    // macOS 14 availability floor - the app itself only ships on iOS 17.2+.
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TransitCore", targets: ["TransitCore"])
    ],
    targets: [
        .target(name: "TransitCore"),
        .testTarget(
            name: "TransitCoreTests",
            dependencies: ["TransitCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
