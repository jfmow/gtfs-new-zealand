import SwiftUI
import TransitCore

/// Shows whether push actually works on this device - permission, backend
/// registration, token upload, APNs environment - and sends a real test
/// push through the server. Every "notifications don't arrive" report
/// starts here.
struct PushStatusCard: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var isTesting = false
    @State private var testResult: PushTestResult?
    @State private var testError: String?

    private var push: PushRegistrationService { environment.push }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            statusRow("Permission", ok: push.isAuthorized, detail: permissionLabel)
            statusRow("Registered with server", ok: push.isRegisteredWithBackend, detail: nil)
            statusRow("Push token sent", ok: push.hasUploadedToken, detail: PushRegistrationService.apnsEnvironment)

            if let error = push.lastRegistrationError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }

            if !push.isAuthorized {
                Button("Turn on notifications") {
                    Task {
                        if push.authorizationStatus == .denied, let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                            await UIApplication.shared.open(url)
                        } else {
                            await push.requestPermission()
                        }
                    }
                }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
            }

            Button {
                Task { await sendTest() }
            } label: {
                HStack(spacing: 6) {
                    if isTesting { ProgressView().controlSize(.small) }
                    Text(isTesting ? "Sending…" : "Send test notification")
                }
            }
            .font(.subheadline.weight(.medium))
            // Borderless: two plain buttons inside one List row would
            // otherwise both fire on any tap in the row.
            .buttonStyle(.borderless)
            .disabled(isTesting || !push.isRegisteredWithBackend)

            if let testResult {
                Text(testResultText(testResult))
                    .font(.caption)
                    .foregroundStyle(testResult.sent ? Theme.success : Theme.danger)
            } else if let testError {
                Text(testError).font(.caption).foregroundStyle(Theme.danger)
            }
        }
    }

    private var permissionLabel: String {
        switch push.authorizationStatus {
        case .authorized: return "Allowed"
        case .provisional: return "Quiet"
        case .ephemeral: return "Temporary"
        case .denied: return "Off in Settings"
        case .notDetermined: return "Not asked yet"
        @unknown default: return "Unknown"
        }
    }

    private func statusRow(_ label: String, ok: Bool, detail: String?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(ok ? Theme.success : Theme.danger)
            Text(label).font(.subheadline)
            Spacer()
            if let detail {
                Text(detail).font(.caption).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private func testResultText(_ result: PushTestResult) -> String {
        if result.sent { return "Sent. It should arrive in a few seconds." }
        if !result.hasToken { return "The server has no push token for this device yet. Turn on notifications, then reopen the app." }
        return "The server couldn't send it: \(result.error)"
    }

    private func sendTest() async {
        isTesting = true
        defer { isTesting = false }
        testResult = nil
        testError = nil
        do {
            testResult = try await push.sendTestNotification()
        } catch {
            testError = error.localizedDescription
        }
    }
}
