import Foundation

/// Typed wrappers over `APIClient.postForm` for `/devices/*` and
/// `/notifications/*` - every call here relies on `APIClient.setDeviceIdentity`
/// having been called first (the resulting `X-Device-Id`/`X-Device-Secret`
/// headers are how the backend resolves "this device", see
/// `identityFromRequest` on the Go side).
extension APIClient {
    // MARK: - Device registration

    @discardableResult
    public func registerDevice(_ identity: DeviceIdentity, apnsToken: String = "", environment: String, pushToStartToken: String = "") async throws -> DeviceRegistrationResult {
        try await postForm("devices/register", form: [
            "deviceId": identity.id, "secret": identity.secret,
            "apnsToken": apnsToken, "env": environment, "pushToStartToken": pushToStartToken,
        ])
    }

    @discardableResult
    public func updateDeviceToken(_ identity: DeviceIdentity, apnsToken: String = "", environment: String = "", pushToStartToken: String = "") async throws -> DeviceRegistrationResult {
        try await postForm("devices/update-token", form: [
            "deviceId": identity.id, "secret": identity.secret,
            "apnsToken": apnsToken, "env": environment, "pushToStartToken": pushToStartToken,
        ])
    }

    // MARK: - Stop alert subscriptions

    public func subscribeToStop(_ stopIdOrName: String, routes: [String] = [], causes: [String] = [], minSeverity: String = "", notifyCancellations: Bool = true) async throws {
        try await postFormExpectingNoData("notifications/add", form: [
            "stopIdOrName": stopIdOrName,
            "routes": jsonArray(routes),
            "causes": jsonArray(causes),
            "minSeverity": minSeverity,
            "notifyCancellations": notifyCancellations ? "true" : "false",
        ])
    }

    public func unsubscribeFromStop(_ stopIdOrName: String) async throws {
        try await postFormExpectingNoData("notifications/remove", form: ["stopIdOrName": stopIdOrName])
    }

    /// Updates an existing stop subscription's routes/filters
    /// (`notifications/edit`, as the web's `updateSubToStop`).
    public func updateStopSubscription(_ stopIdOrName: String, routes: [String], causes: [String], minSeverity: String, notifyCancellations: Bool) async throws {
        try await postFormExpectingNoData("notifications/edit", form: [
            "stopIdOrName": stopIdOrName,
            "routes": jsonArray(routes),
            "causes": jsonArray(causes),
            "minSeverity": minSeverity,
            "notifyCancellations": notifyCancellations ? "true" : "false",
        ])
    }

    /// This device's subscription to one stop, resolved by the server from
    /// a name/code or id - nil when not subscribed. The web's
    /// `checkStopSubscription` (`notifications/find-client`).
    public func stopSubscription(_ stopIdOrName: String) async -> StopSubscriptionState? {
        try? await postForm("notifications/find-client", form: ["stopIdOrName": stopIdOrName])
    }

    /// Turns off alerts for every stop ("Disable all notifications").
    public func unsubscribeFromAllStops() async throws {
        try await postFormExpectingNoData("notifications/remove", form: ["stopIdOrName": ""])
    }

    // MARK: - Route alert subscriptions

    public func subscribeToRoute(_ routeID: String, causes: [String] = [], minSeverity: String = "", notifyCancellations: Bool = true) async throws {
        try await postFormExpectingNoData("notifications/route/add", form: [
            "routeId": routeID, "causes": jsonArray(causes), "minSeverity": minSeverity,
            "notifyCancellations": notifyCancellations ? "true" : "false",
        ])
    }

    public func updateRouteSubscription(_ routeID: String, causes: [String], minSeverity: String, notifyCancellations: Bool) async throws {
        try await postFormExpectingNoData("notifications/route/edit", form: [
            "routeId": routeID, "causes": jsonArray(causes), "minSeverity": minSeverity,
            "notifyCancellations": notifyCancellations ? "true" : "false",
        ])
    }

    public func unsubscribeFromRoute(_ routeID: String) async throws {
        try await postFormExpectingNoData("notifications/route/remove", form: ["routeId": routeID])
    }

    // MARK: - My subscriptions + history

    public func mySubscriptions() async throws -> MySubscriptions {
        try await postForm("notifications/mine", form: [:])
    }

    public func dismissNotification(id: String) async throws {
        try await postFormExpectingNoData("notifications/history/dismiss", form: ["id": id])
    }

    public func clearNotificationHistory() async throws {
        try await postFormExpectingNoData("notifications/history/clear", form: [:])
    }

    /// Asks the server to push a test notification to this device right now,
    /// and returns what it knows about the device's push setup.
    public func sendTestNotification() async throws -> PushTestResult {
        try await postForm("notifications/test", form: [:])
    }

    // MARK: - One-shot trip reminders (get off / arriving / N stops away)

    public func addReminder(tripID: String, stopID: String, type: String, offset: Int? = nil) async throws {
        var form = ["tripId": tripID, "stopId": stopID, "type": type]
        if let offset { form["offset"] = String(offset) }
        try await postFormExpectingNoData("notifications/reminder", form: form)
    }

    // MARK: - Leave-by journey reminders

    public func journeyReminders() async throws -> [JourneyReminderDTO] {
        try await postForm("notifications/journey-reminders", form: [:])
    }

    public func removeJourneyReminder(id: Int) async throws {
        try await postFormExpectingNoData("notifications/journey-reminder/remove", form: ["id": String(id)])
    }

    /// Creates a "leave-by" reminder for a plan's first boarding leg
    /// (`kind: fixed_trip`). Recurring/no-fixed-trip reminders (`kind:
    /// journey_request`) aren't wired up yet - this covers "remind me to
    /// leave for the journey I just planned", the common case.
    @discardableResult
    public func addLeaveByReminder(for plan: JourneyPlan, offsets: [Int] = [30, 15, 5, 0], accessSeconds: Int? = nil) async throws -> JourneyReminderCreated {
        guard let boardLeg = plan.legs.first(where: { $0.mode == "transit" }),
              let boardStop = boardLeg.fromStop,
              let scheduledDeparture = boardLeg.scheduledDepartureTime.date ?? boardLeg.departureTime.date
        else {
            throw APIError.server(code: 400, message: "This journey has no boarding leg to remind you about.", traceID: nil)
        }
        let access = accessSeconds ?? Int(boardLeg.departureTime.date?.timeIntervalSince(plan.departureTime.date ?? boardLeg.departureTime.date ?? Date()) ?? 0)

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return try await postForm("notifications/journey-reminder", form: [
            "kind": "fixed_trip",
            "startLat": String(plan.startLat), "startLon": String(plan.startLon), "startLabel": "Start",
            "endLat": String(plan.endLat), "endLon": String(plan.endLon), "endLabel": "Destination",
            "timeType": "arriveat",
            "boardTripId": boardLeg.tripID,
            "boardStopId": boardStop.stopID,
            "scheduledDepartureIso": formatter.string(from: scheduledDeparture),
            "accessSeconds": String(max(0, access)),
            "routeShortName": boardLeg.route?.routeShortName ?? boardLeg.routeID,
            "boardStopName": boardStop.stopName,
            "offsets": jsonIntArray(offsets),
            "deeplink": "transit://journey?id=\(plan.id)",
        ])
    }

    // MARK: - Live Activities (journey progress)

    /// Registers a newly-started Live Activity so the server can push
    /// content-state updates while the app is backgrounded. The server
    /// loads the plan itself from `planId` (the existing plan cache, see
    /// `plan_store.go`) - the client doesn't upload leg data.
    @discardableResult
    public func startLiveActivity(planID: String, activityID: String, pushToken: String, region: String, environment: String = "") async throws -> LiveActivityRegistered {
        try await postForm("live-activities", form: [
            "planId": planID, "activityId": activityID, "pushToken": pushToken, "region": region, "env": environment,
        ])
    }

    /// ActivityKit rotates a running activity's push token occasionally -
    /// forward each new one so the server doesn't push into a dead token.
    public func updateLiveActivityToken(activityID: String, pushToken: String) async throws {
        try await postFormExpectingNoData("live-activities/update-token", form: [
            "activityId": activityID, "pushToken": pushToken,
        ])
    }

    /// Reports the on-device state machine's current leg/phase while the
    /// app is foregrounded - the server's own computation is a simplified
    /// subset (see the plan doc), so this lets the server's next push stay
    /// aligned with what the app already knows, rather than the two
    /// disagreeing right after a foreground update.
    public func reportLiveActivityLeg(activityID: String, legIndex: Int, phase: String) async throws {
        try await postFormExpectingNoData("live-activities/leg", form: [
            "activityId": activityID, "legIndex": String(legIndex), "phase": phase,
        ])
    }

    public func endLiveActivity(activityID: String) async throws {
        try await postFormExpectingNoData("live-activities/end", form: ["activityId": activityID])
    }

    // MARK: - Helpers

    private func jsonArray(_ values: [String]) -> String {
        guard !values.isEmpty, let data = try? JSONEncoder().encode(values), let string = String(data: data, encoding: .utf8) else { return "" }
        return string
    }

    private func jsonIntArray(_ values: [Int]) -> String {
        guard let data = try? JSONEncoder().encode(values), let string = String(data: data, encoding: .utf8) else { return "[]" }
        return string
    }
}
