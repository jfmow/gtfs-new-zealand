import Foundation
import Network

/// Whether the device has a usable network path. Only half the story on its
/// own - a phone can be "connected" to wifi that goes nowhere - so the
/// journey tracker also counts itself offline when its own requests keep
/// failing (`JourneyTrackingSession.isOffline`).
@MainActor
@Observable
final class NetworkMonitor {
    private(set) var isConnected = true
    @ObservationIgnored var onChange: ((Bool) -> Void)?

    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.isConnected != connected else { return }
                self.isConnected = connected
                self.onChange?(connected)
            }
        }
        monitor.start(queue: DispatchQueue(label: "dev.suddsy.transit.network-monitor"))
    }
}
