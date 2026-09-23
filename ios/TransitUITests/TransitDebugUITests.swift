import XCTest

/// Not a real test suite - a debugging harness. `simctl` has no touch/tap
/// subcommand at all, so this is the only way to actually drive the app
/// (dismiss system alerts, switch tabs, open screens) on the simulator from
/// the command line. Each "test" walks a slice of the app and attaches
/// screenshots + a liveness assertion; read them back from the .xcresult
/// bundle. Not part of any release process - delete before shipping if it
/// gets in the way.
final class TransitDebugUITests: XCTestCase {
    let app = XCUIApplication()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    /// Taps through the system permission/"Open in" alerts that block
    /// automation - these live in SpringBoard, not our app, so XCUITest's
    /// normal element queries against `app` never see them.
    private func dismissSystemAlertIfPresent(timeout: TimeInterval = 4) {
        for label in ["Allow While Using App", "Allow Once", "Open", "OK"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: timeout) {
                button.tap()
                return
            }
        }
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Walks: Home -> Map tab (Stops, exercises the "stop"/"cluster"
    /// annotation identifiers that previously crashed) -> Vehicles segment
    /// (exercises the "vehicle" identifier) -> a stop board -> Planner
    /// search -> Alerts -> Settings. Fails loudly (via the liveness
    /// assertions) if the app terminates underneath us at any point.
    func testWalkthrough() throws {
        app.launch()
        dismissSystemAlertIfPresent()
        _ = app.wait(for: .runningForeground, timeout: 5)
        attach("01-home")

        // Home: "Near you" list content, in case it loaded before location
        // was granted.
        XCTAssertEqual(app.state, .runningForeground, "app died on launch/home")

        // Map tab - Stops (default) - the crash's exact code path.
        let mapTab = app.tabBars.buttons["Map"]
        if mapTab.waitForExistence(timeout: 5) {
            mapTab.tap()
            dismissSystemAlertIfPresent(timeout: 2)
            sleep(3) // let stops load + annotations render
            attach("02-map-stops")
            XCTAssertEqual(app.state, .runningForeground, "app died rendering stop annotations")

            let vehiclesSegment = app.buttons["Vehicles"]
            if vehiclesSegment.waitForExistence(timeout: 3) {
                vehiclesSegment.tap()
                sleep(3) // let a poll tick land so vehicle annotations render
                attach("03-map-vehicles")
                XCTAssertEqual(app.state, .runningForeground, "app died rendering vehicle annotations")

                // Pan/zoom to force clustering + repeated dequeues.
                // `app.maps` throws outright (not just a failed existence
                // check) against a `UIViewRepresentable`-wrapped MKMapView -
                // it isn't exposed as XCUIElementTypeMap the way a native
                // SwiftUI `Map` is. `otherElements` is the working fallback
                // used everywhere else in this file.
                let map = app.otherElements.firstMatch
                map.pinch(withScale: 0.5, velocity: -1)
                sleep(1)
                map.pinch(withScale: 2, velocity: 1)
                sleep(2)
                attach("04-map-vehicles-after-pinch")
                XCTAssertEqual(app.state, .runningForeground, "app died after pinch-zoom re-dequeue")
            }
        }

        // Back to Home, open the first list row if any exist.
        let scheduleTab = app.tabBars.buttons["Schedule"]
        if scheduleTab.waitForExistence(timeout: 3) {
            scheduleTab.tap()
            sleep(1)
            attach("05-home-again")
            // `app.cells.firstMatch` matches something inert in a plain-style
            // List over TransitCard content - it "exists" but tapping it is
            // a no-op. A Button whose label contains a digit (every stop row
            // shows its stop code) is a reliable way to hit an actual
            // NavigationLink row instead.
            let firstRow = app.buttons.matching(NSPredicate(format: "label MATCHES %@", ".*[0-9]{3,}.*")).firstMatch
            if firstRow.exists {
                firstRow.tap()
                sleep(2)
                attach("06-stop-board")
                XCTAssertEqual(app.state, .runningForeground, "app died opening a stop board")
                if app.navigationBars.buttons.firstMatch.exists {
                    app.navigationBars.buttons.firstMatch.tap()
                }
            }
        }

        // Planner tab - search field + autocomplete list design.
        let plannerTab = app.tabBars.buttons["Planner"]
        if plannerTab.waitForExistence(timeout: 3) {
            plannerTab.tap()
            sleep(1)
            attach("07-planner")
            let searchFields = app.textFields.allElementsBoundByIndex + app.searchFields.allElementsBoundByIndex
            if let firstField = searchFields.first {
                firstField.tap()
                firstField.typeText("Britomart")
                sleep(2)
                attach("08-planner-autocomplete")
            }
        }

        // Alerts tab.
        let alertsTab = app.tabBars.buttons["Alerts"]
        if alertsTab.waitForExistence(timeout: 3) {
            alertsTab.tap()
            sleep(1)
            attach("09-alerts")
        }

        // Settings tab - region rows with provider logos.
        let settingsTab = app.tabBars.buttons["Settings"]
        if settingsTab.waitForExistence(timeout: 3) {
            settingsTab.tap()
            sleep(1)
            attach("10-settings")
        }

        XCTAssertEqual(app.state, .runningForeground, "app died by end of walkthrough")
    }

    /// Focused re-run of just the Map tab (Stops + Vehicles), on a clean
    /// install, since `testWalkthrough`'s first pass got stuck behind a
    /// leftover deep-link fullScreenCover from manual `simctl openurl`
    /// testing and never actually reached MapTabView.
    func testMapTabOnly() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2) // in case two stack (location + something else)
        _ = app.wait(for: .runningForeground, timeout: 5)
        attach("m1-home")
        XCTAssertEqual(app.state, .runningForeground)

        let mapTab = app.tabBars.buttons["Map"]
        XCTAssertTrue(mapTab.waitForExistence(timeout: 5), "Map tab not found")
        mapTab.tap()
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(3)
        attach("m2-stops")
        XCTAssertEqual(app.state, .runningForeground, "app died rendering StopsMapView")

        // Force pan/zoom to churn cluster annotations (repeated dequeues).
        // Pinch only (no swipeUp - `app.otherElements.firstMatch` isn't a
        // reliable handle on the map specifically, and a swipe through it
        // previously landed on the tab bar instead).
        let stopsMap = app.otherElements.firstMatch
        if stopsMap.exists {
            stopsMap.pinch(withScale: 0.4, velocity: -1)
            sleep(1)
        }
        attach("m3-stops-after-pan")
        XCTAssertEqual(app.state, .runningForeground, "app died panning StopsMapView")

        let vehiclesSegment = app.buttons["Vehicles"]
        if vehiclesSegment.waitForExistence(timeout: 8) {
            vehiclesSegment.tap()
            sleep(4) // let a poll tick land
            attach("m4-vehicles")
            XCTAssertEqual(app.state, .runningForeground, "app died rendering VehiclesMapView")

            let vehiclesMap = app.otherElements.firstMatch
            if vehiclesMap.exists {
                vehiclesMap.pinch(withScale: 0.4, velocity: -1)
                sleep(1)
                vehiclesMap.pinch(withScale: 3, velocity: 1)
                sleep(2)
            }
            attach("m5-vehicles-after-pinch")
        } else {
            XCTFail("Vehicles segment control not found")
        }
        XCTAssertEqual(app.state, .runningForeground, "app died after pinch-zoom on VehiclesMapView")
    }

    /// Tapping a cluster zooms in one layer: the group splits into smaller
    /// groups / single stops rather than jumping to street level.
    func testClusterTapExpands() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        app.tabBars.buttons["Stops"].tap()
        sleep(4)
        attach("cl-01-before")
        let groups = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Group of "))
        let before = groups.count
        let group = groups.element(boundBy: min(2, max(0, before - 1)))
        guard group.waitForExistence(timeout: 5) else { return XCTFail("no clusters on the map") }
        let label = group.label
        group.tap()
        sleep(3)
        attach("cl-02-after")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch.exists && groups.count == before,
                       "cluster didn't expand")
    }

    /// Coming back from the background mustn't drop live tracking while
    /// the first poll after resuming loads.
    func testTrackerSurvivesBackground() throws {
        guard planAndStartJourney() else { return }
        let live = app.staticTexts["Live"]
        guard live.waitForExistence(timeout: 25) else { throw XCTSkip("the planned trip has no live vehicle right now") }
        attach("bg-01-before")
        XCUIDevice.shared.press(.home)
        sleep(20)
        app.activate()
        let stillTracking = app.staticTexts["Live"].waitForExistence(timeout: 2) || app.staticTexts["Updating"].exists
        attach("bg-02-after")
        XCTAssertTrue(stillTracking, "tracking dropped after returning from the background")
        XCTAssertFalse(app.staticTexts["Timetable only"].exists)
    }

    /// Stop on the map -> its board -> a service: the tracker must be on
    /// top (it used to render behind the board), and after going back the
    /// same stop must open again on the first tap.
    func testMapStopToServiceStack() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        app.tabBars.buttons["Stops"].tap()
        sleep(4)
        let stopMarkers = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "stop-"))
        let groups = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Group of "))
        // Zoom right in so stops stand alone - a stop folded into a group
        // keeps its accessibility element (under the group's marker), so
        // tapping it would hit the group instead.
        // (Home's embedded map is in the tree too - use the one on screen.)
        let maps = app.maps.allElementsBoundByIndex.filter { $0.isHittable && $0.frame.height > 300 }
        guard let map = maps.last else { return XCTFail("no map on screen") }
        for _ in 0..<2 {
            map.pinch(withScale: 3, velocity: 3)
            sleep(2)
        }
        let groupFrames = groups.allElementsBoundByIndex.map(\.frame)
        // The map's accessibility tree includes markers just off screen -
        // pick one that's actually visible (and clear of the chips/pill).
        let window = app.windows.firstMatch.frame
        let visible = (0..<min(stopMarkers.count, 60)).lazy.map { stopMarkers.element(boundBy: $0) }.first { marker in
            let f = marker.frame
            return marker.isHittable && !groupFrames.contains(where: { $0.insetBy(dx: -6, dy: -6).intersects(f) })
                && f.minY > window.height * 0.2 && f.maxY < window.height * 0.75 && f.minX > 20 && f.maxX < window.width - 20
        }
        guard let marker = visible else { attach("st-00-no-marker"); return XCTFail("no single stop marker on screen") }
        let stopID = marker.identifier
        // A real touch at the marker - an element tap on a map annotation's
        // accessibility element doesn't reliably select it.
        marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let row = app.buttons.matching(identifier: "departure-row").firstMatch
        guard row.waitForExistence(timeout: 10) else { attach("st-00-no-board"); return XCTFail("board didn't open") }
        attach("st-01-board")
        row.tap()
        sleep(3)
        attach("st-02-tracker")
        XCTAssertTrue(app.navigationBars["Live tracking"].waitForExistence(timeout: 5), "tracker not shown")
        XCTAssertFalse(row.isHittable, "board is still on top of the tracker")

        app.navigationBars["Live tracking"].buttons.element(boundBy: 0).tap()
        sleep(1)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(2)
        let sameStop = app.descendants(matching: .any).matching(identifier: stopID).firstMatch
        guard sameStop.waitForExistence(timeout: 3) else { return XCTFail("stop marker gone after going back") }
        sameStop.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10), "re-tapping the same stop didn't open it")
        attach("st-03-reopened")
    }

    /// Regression check for the address-search decode bug (boundingBox
    /// `[Double]?` vs the wire's `[String]?`, fixed 2026-09-22): types a
    /// real street address into the Planner's From field and confirms at
    /// least one result row appears, not just the static "Use current
    /// location" row.
    /// End-to-end: plan a real journey, start it, and confirm the app is
    /// still alive afterwards - exercises `LiveActivityCoordinator.start`'s
    /// `Activity.request` call (this is the only practical way to verify it
    /// doesn't crash/throw uncaught; ActivityKit's Dynamic Island/Lock
    /// Screen rendering itself isn't inspectable via XCUITest).
    func testStartJourneyExercisesLiveActivity() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(1)

        let plannerTab = app.tabBars.buttons["Planner"]
        XCTAssertTrue(plannerTab.waitForExistence(timeout: 5))
        plannerTab.tap()
        sleep(1)

        // From: current location (already set via simctl location).
        let useCurrentLocationButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "My location"))
        XCTAssertTrue(useCurrentLocationButtons.firstMatch.waitForExistence(timeout: 5))
        useCurrentLocationButtons.firstMatch.tap()
        sleep(2)
        attach("journey-01-from-set")

        // To: type a real, genuinely-far destination (far enough from
        // "current location" - Auckland CBD - that a real transit leg
        // comes back, not a walk-only plan) and pick the first result.
        let toField = app.textFields.element(boundBy: 1)
        if toField.waitForExistence(timeout: 3) {
            toField.tap()
            toField.typeText("Newmarket")
            sleep(2)
            let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
            if result.waitForExistence(timeout: 5) { result.tap() }
        }
        sleep(1)
        attach("journey-02-to-set")

        // Selecting the result above should now resign the field's focus
        // itself (LocationField gained a real @FocusState binding - fixed
        // 2026-09-23, it previously never dismissed the keyboard at all).
        // Belt-and-braces: still tap Return if the keyboard is somehow
        // still up.
        let returnKey = app.keyboards.buttons["Return"]
        if returnKey.waitForExistence(timeout: 2) { returnKey.tap() }
        sleep(1)

        let planButton = app.buttons["Plan journey"]
        XCTAssertTrue(planButton.waitForExistence(timeout: 5))
        planButton.tap()
        sleep(4) // real planner round trip
        attach("journey-03-results")
        XCTAssertEqual(app.state, .runningForeground, "app died planning a journey")

        // NOT CONTAINS "Max" excludes the "Max transfers: N" stepper row,
        // whose label also matches "transfer" - found the hard way when an
        // earlier, looser predicate tapped that stepper's "-" button
        // instead of a results row and the test silently never reached the
        // results/detail screens at all.
        let firstResult = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Direct")).firstMatch
            .exists ? app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Direct")).firstMatch
            : app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label CONTAINS[c] %@", "transfer", "Max")).firstMatch
        if firstResult.waitForExistence(timeout: 3) {
            firstResult.tap()
            sleep(2)
            attach("journey-04-detail")

            let startButton = app.buttons["Start this journey"]
            if startButton.waitForExistence(timeout: 3) {
                startButton.tap()
                sleep(3) // Activity.request + first tick
                attach("journey-05-tracking")
                XCTAssertEqual(app.state, .runningForeground, "app died starting a journey / requesting a Live Activity")

                // Regression check (found 2026-09-23, reported as "the
                // journey tracker UI is broken"): ending the journey used
                // to leave the itinerary sheet's last frame ghosted over
                // whatever screen came back into view underneath it. Tap
                // End and confirm the Planner beneath is drawn cleanly, not
                // still showing tracker content composited over it.
                let endButton = app.buttons["End"]
                if endButton.waitForExistence(timeout: 3) {
                    endButton.tap()
                    sleep(2)
                    attach("journey-06-after-end")
                    XCTAssertEqual(app.state, .runningForeground, "app died ending the journey")
                    XCTAssertFalse(app.staticTexts["Your journey"].exists, "tracker sheet content still on screen after End")
                }
            }
        }
    }

    /// Verifies the redesigned saved-trip card (colour accent bar, icon,
    /// name/route subtitle, "..." menu with Rename/Colour/Delete) actually
    /// renders - replaces the old horizontal chip rail 2026-09-23.
    func testSaveTripShowsRedesignedCard() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(1)

        let plannerTab = app.tabBars.buttons["Planner"]
        XCTAssertTrue(plannerTab.waitForExistence(timeout: 5))
        plannerTab.tap()
        sleep(1)

        let useCurrentLocationButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "My location"))
        XCTAssertTrue(useCurrentLocationButtons.firstMatch.waitForExistence(timeout: 5))
        useCurrentLocationButtons.firstMatch.tap()
        sleep(2)

        let toField = app.textFields.element(boundBy: 1)
        if toField.waitForExistence(timeout: 3) {
            toField.tap()
            toField.typeText("Newmarket")
            sleep(2)
            let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
            if result.waitForExistence(timeout: 5) { result.tap() }
        }
        sleep(1)

        let saveButton = app.buttons["Save this trip"]
        if saveButton.waitForExistence(timeout: 3) {
            saveButton.tap()
            sleep(1)
            attach("saved-trip-01-card")
            XCTAssertEqual(app.state, .runningForeground, "app died saving a trip")

            // Open the "..." menu on the new card to confirm Rename/Colour/
            // Delete are all there.
            let menuButton = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "More options")).firstMatch
            if menuButton.waitForExistence(timeout: 3) {
                menuButton.tap()
                sleep(1)
                attach("saved-trip-02-menu")
            }
        }
    }

    /// Regression check (found 2026-09-23, reported as "when you click a
    /// saved journey it doesn't auto fill the addr into the text fields")
    /// and a check that "My location"/"Pick on map" are now a
    /// dropdown (only visible once a field is focused), not permanently
    /// shown under it.
    func testSavedTripAutofillsFieldsAndQuickActionsAreHiddenByDefault() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(1)

        let plannerTab = app.tabBars.buttons["Planner"]
        XCTAssertTrue(plannerTab.waitForExistence(timeout: 5))
        plannerTab.tap()
        sleep(1)
        attach("autofill-01-planner-fresh")
        // Neither quick action should be visible before any field is
        // focused - previously they were always shown under an empty
        // field, permanently, rather than only as part of its dropdown.
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Pick on map")).firstMatch.exists, "Pick on map shown without a field being focused")

        // Focus the From field (still empty) - the dropdown (quick actions)
        // should now appear.
        let fromField = app.textFields.firstMatch
        XCTAssertTrue(fromField.waitForExistence(timeout: 5))
        fromField.tap()
        sleep(1)
        attach("autofill-02-from-focused")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Pick on map")).firstMatch.waitForExistence(timeout: 3), "Pick on map not shown once the field is focused")

        // Use current location, then save this as a trip so there's a
        // saved-trip card to tap.
        let useCurrentLocationButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "My location"))
        useCurrentLocationButtons.firstMatch.tap()
        sleep(2)

        let toField = app.textFields.element(boundBy: 1)
        if toField.waitForExistence(timeout: 3) {
            toField.tap()
            toField.typeText("Newmarket")
            sleep(2)
            let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
            if result.waitForExistence(timeout: 5) { result.tap() }
        }
        sleep(1)

        let saveButton = app.buttons["Save this trip"]
        if saveButton.waitForExistence(timeout: 3) {
            saveButton.tap()
            sleep(1)
        }

        // Change the To field to something else, so its displayed text no
        // longer matches the saved trip - otherwise tapping the saved trip
        // right after saving it wouldn't prove anything, since the field
        // would already happen to show the same text.
        if toField.waitForExistence(timeout: 3) {
            toField.tap()
            sleep(1)
            // No clear button on this field - repeated deletes is the
            // standard reliable way to empty a UITextField in XCUITest.
            if let current = toField.value as? String, !current.isEmpty {
                toField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
            }
            toField.typeText("Britomart")
            sleep(2)
            let otherResult = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Britomart")).firstMatch
            if otherResult.waitForExistence(timeout: 5) { otherResult.tap() }
        }
        sleep(1)
        attach("autofill-03-to-field-changed")

        let savedTripCard = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "→")).firstMatch
        XCTAssertTrue(savedTripCard.waitForExistence(timeout: 5), "no saved-trip card to tap")
        savedTripCard.tap()
        sleep(1)
        attach("autofill-04-after-tapping-saved-trip")

        // The To field should be back to the saved trip's own value
        // (Newmarket), not still showing what was typed in just above
        // (Britomart) - this is the actual regression check.
        let toValue = app.textFields.element(boundBy: 1).value as? String ?? ""
        XCTAssertTrue(toValue.localizedCaseInsensitiveContains("Newmarket"), "To field did not autofill from the saved trip (value: \(toValue))")
    }

    func testPlannerAddressSearch() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        _ = app.wait(for: .runningForeground, timeout: 5)

        let plannerTab = app.tabBars.buttons["Planner"]
        XCTAssertTrue(plannerTab.waitForExistence(timeout: 5))
        plannerTab.tap()
        sleep(1)

        let fromField = app.textFields.firstMatch
        XCTAssertTrue(fromField.waitForExistence(timeout: 5))
        fromField.tap()
        fromField.typeText("Westfield Newmarket")
        sleep(2) // debounce (300ms) + network round trip
        attach("address-search-results")

        // Each result renders as a Button, not a bare static text - confirmed
        // visually via screenshot the first time this test was written
        // (the buttons.matching(label:) query below wasn't right either
        // first try; `.buttons` whose label *contains* the address is the
        // reliable match for a Button wrapping a Text).
        let resultRow = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Westfield Newmarket 277 Broadway")).firstMatch
        XCTAssertTrue(resultRow.waitForExistence(timeout: 3), "No address search results appeared - the decode bug may have regressed")
    }

    /// Visual-parity survey: walks the main screens and screenshots each,
    /// for side-by-side comparison against the web app's own screenshots.
    /// Not an assertion-heavy test - the screenshots themselves are the
    /// point.
    func testVisualParitySurvey() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(2)
        attach("vp-01-home")
        app.swipeUp()
        sleep(1)
        attach("vp-01b-home-scrolled")
        app.swipeDown()
        let bell = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Notifications")).firstMatch
        if bell.waitForExistence(timeout: 2) {
            bell.tap()
            sleep(2)
            attach("vp-01c-bell")
            app.swipeDown(velocity: .fast)
            sleep(1)
        }

        let scheduleTab = app.tabBars.buttons["Schedule"]
        let searchField = app.textFields["Search for stop..."]
        if searchField.waitForExistence(timeout: 3) {
            searchField.tap()
            searchField.typeText("Britomart")
            sleep(2)
            attach("vp-03-stop-search")
            let firstResult = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Britomart")).firstMatch
            if firstResult.waitForExistence(timeout: 3) {
                firstResult.tap()
                sleep(3)
                attach("vp-04-departures-board")
            }
        }
        if app.navigationBars.buttons.firstMatch.exists {
            app.navigationBars.buttons.firstMatch.tap()
            sleep(1)
        }
        _ = scheduleTab

        for (tab, name) in [("Planner", "vp-05-planner"), ("Stops", "vp-02-stops-map"), ("Vehicles", "vp-06-vehicles"), ("Alerts", "vp-07-alerts")] {
            let button = app.tabBars.buttons[tab]
            if button.waitForExistence(timeout: 3) {
                button.tap()
                sleep(3)
                attach(name)
            }
            if tab == "Planner", app.buttons["Options"].waitForExistence(timeout: 2) {
                app.buttons["Options"].tap()
                sleep(1)
                attach("vp-05b-planner-options")
                app.buttons["Options"].tap()
            }
        }

        let menu = app.navigationBars.buttons["Menu"]
        if menu.waitForExistence(timeout: 3) {
            menu.tap()
            let settings = app.buttons["Settings"]
            if settings.waitForExistence(timeout: 3) {
                settings.tap()
                sleep(2)
                attach("vp-08-settings")
            }
        }
    }

    /// Just dismisses whatever alert is pending (an "Open in Transit?" from
    /// a `simctl openurl` run just before this, in practice) and takes one
    /// screenshot - deliberately does NOT query `app.otherElements` or
    /// anything else that walks the full accessibility tree, since on a
    /// screen with a large `MKMapView` annotation set that walk is what
    /// hung the main thread for 60s+ (see `testMapTabOnly`'s finding). The
    /// trip deep link's screen (`VehicleQuickLookView`) has very few
    /// annotations, so this is safe there.
    /// Direct check of the redesigned `DepartureRow` on a stop that's
    /// actually likely to have services right now (Britomart, a major
    /// interchange), since the nearest-stop pick in `testWalkthrough` can
    /// land on a quiet stop with nothing scheduled.
    func testDepartureRowOnBusyStop() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(1)

        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Britomart")
        sleep(2)

        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Britomart")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        sleep(2)
        attach("busy-stop-departures")
    }

    func testDismissPendingAlertAndScreenshot() throws {
        _ = app.wait(for: .runningForeground, timeout: 5)
        dismissSystemAlertIfPresent(timeout: 6)
        dismissSystemAlertIfPresent(timeout: 2)
        sleep(3)
        attach("deeplink-result")
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// End-to-end push check against a local backend (`go run .` on :8090
    /// with APNs env vars set): grant permission, relaunch (the step that
    /// used to wipe the token), then tap "Send test notification" in
    /// Settings and capture both the in-app result and the banner.
    func testPushDeliveryAgainstLocalBackend() throws {
        app.launchEnvironment["TRANSIT_API_BASE"] = "http://localhost:8090"
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)

        app.tabBars.buttons["Settings"].tap()
        let turnOn = app.buttons["Turn on notifications"]
        if turnOn.waitForExistence(timeout: 4) {
            turnOn.tap()
            for label in ["Allow", "Allow Notifications"] {
                let allow = springboard.buttons[label]
                if allow.waitForExistence(timeout: 4) { allow.tap(); break }
            }
        }
        sleep(4)

        // Relaunch - before the fix this re-registered with an empty token
        // and the server forgot the device's token.
        app.terminate()
        app.launch()
        sleep(4)
        app.tabBars.buttons["Settings"].tap()
        sleep(1)
        attach("push-status-after-relaunch")

        let send = app.buttons["Send test notification"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()

        // Banners only stay up ~5s, so tap as soon as it appears; that
        // should route its `/settings` url to the inbox.
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "Test notification")).firstMatch
        guard banner.waitForExistence(timeout: 10) else {
            attach("push-test-result")
            return XCTFail("test notification banner never appeared")
        }
        attach("push-test-result")
        banner.tap()
        let inboxTitle = app.navigationBars["Reminders & alerts"]
        XCTAssertTrue(inboxTitle.waitForExistence(timeout: 5), "tapping the notification didn't open the inbox")
        attach("push-tap-opened-inbox")
    }

    /// Starts tracking a real journey against the local backend, then
    /// leaves the app so the Live Activity shows on the Dynamic Island and
    /// Lock Screen - and waits long enough for the server's background
    /// cron (every 20s) to push at least one update.
    func testLiveActivityOnLockScreen() throws {
        app.launchEnvironment["TRANSIT_API_BASE"] = "http://localhost:8090"
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        dismissSystemAlertIfPresent(timeout: 2)

        app.tabBars.buttons["Planner"].tap()
        let fromField = app.textFields.element(boundBy: 0)
        XCTAssertTrue(fromField.waitForExistence(timeout: 5))
        fromField.tap()
        let current = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "My location")).firstMatch
        XCTAssertTrue(current.waitForExistence(timeout: 5))
        current.tap()
        sleep(3)

        let toField = app.textFields.element(boundBy: 1)
        toField.tap()
        toField.typeText("Newmarket")
        sleep(3)
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
        if result.waitForExistence(timeout: 5) { result.tap() }
        sleep(1)

        app.buttons["Plan journey"].tap()
        sleep(8)
        let firstResult = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Direct", "transfer")).firstMatch
        XCTAssertTrue(firstResult.waitForExistence(timeout: 10), "no journey results")
        firstResult.tap()

        let startButton = app.buttons["Start this journey"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        startButton.tap()
        for label in ["Allow", "Always Allow"] {
            let allow = springboard.buttons[label]
            if allow.waitForExistence(timeout: 3) { allow.tap(); break }
        }
        sleep(6)
        attach("la-01-tracking-in-app")

        XCUIDevice.shared.press(.home)
        sleep(3)
        let island = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        island.name = "la-02-dynamic-island"
        island.lifetime = .keepAlways
        add(island)

        // Lock the device to see the Lock Screen presentation.
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        XCUIDevice.shared.press(.home) // wake to the Lock Screen
        sleep(3)
        let lock = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        lock.name = "la-03-lock-screen"
        lock.lifetime = .keepAlways
        add(lock)

        // Give the server cron (20s) time to push a background update.
        sleep(45)
        let later = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        later.name = "la-04-lock-screen-after-server-push"
        later.lifetime = .keepAlways
        add(later)
    }

    /// The rebuilt planner end to end: form, options, results, detail,
    /// and the leave-by reminder sheet.
    func testPlannerFlow() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        dismissSystemAlertIfPresent(timeout: 2)

        app.tabBars.buttons["Planner"].tap()
        let fromField = app.textFields["From"]
        XCTAssertTrue(fromField.waitForExistence(timeout: 5))
        fromField.tap()
        sleep(1)
        attach("pl-01-from-dropdown")
        let myLocation = app.buttons["My location"]
        if myLocation.waitForExistence(timeout: 3) { myLocation.tap() }
        sleep(3)

        let toField = app.textFields["To"]
        toField.tap()
        toField.typeText("Newmarket")
        sleep(3)
        attach("pl-02-to-results")
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
        if result.waitForExistence(timeout: 5) { result.tap() }
        sleep(1)

        app.buttons["Options"].tap()
        sleep(1)
        attach("pl-03-options")

        app.buttons["Plan journey"].tap()
        sleep(8)
        attach("pl-04-results")

        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers")).firstMatch
        guard card.waitForExistence(timeout: 5) else { return XCTFail("no results") }
        card.tap()
        sleep(3)
        attach("pl-06-detail")

        let remind = app.buttons["Remind me when to leave"]
        if remind.waitForExistence(timeout: 3) {
            remind.tap()
            sleep(2)
            attach("pl-07-reminder-sheet")
            let custom = app.buttons["Custom…"]
            if custom.exists { custom.tap(); sleep(1); attach("pl-08-reminder-custom") }
        }
    }

    /// Start a journey, minimise the tracker, and resume it from the pill.
    func testResumeJourneyPill() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        app.tabBars.buttons["Planner"].tap()
        let from = app.textFields["From"]
        XCTAssertTrue(from.waitForExistence(timeout: 5))
        from.tap()
        if app.buttons["My location"].waitForExistence(timeout: 3) { app.buttons["My location"].tap() }
        sleep(3)
        let to = app.textFields["To"]
        to.tap()
        to.typeText("Newmarket")
        sleep(3)
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
        if result.waitForExistence(timeout: 5) { result.tap() }
        app.buttons["Plan journey"].tap()
        sleep(8)
        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers")).firstMatch
        guard card.waitForExistence(timeout: 5) else { return XCTFail("no results") }
        card.tap()
        let start = app.buttons["Start this journey"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        dismissSystemAlertIfPresent(timeout: 3)
        sleep(4)
        attach("rs-01-tracking")

        let minimise = app.buttons["Minimise"]
        XCTAssertTrue(minimise.waitForExistence(timeout: 5))
        minimise.tap()
        sleep(2)
        attach("rs-02-pill")
        let pill = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Resume journey to")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 5), "resume pill not shown")
        pill.tap()
        sleep(4)
        attach("rs-03-resumed")
        XCTAssertTrue(app.buttons["Minimise"].waitForExistence(timeout: 8), "tracking didn't reopen")
    }

    /// Start a journey, re-plan from the tracker, then keep the original.
    /// Plans from the current location to Newmarket and starts tracking
    /// the first result. False if planning found nothing.
    private func planAndStartJourney() -> Bool {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        app.tabBars.buttons["Planner"].tap()
        let from = app.textFields["From"]
        XCTAssertTrue(from.waitForExistence(timeout: 5))
        from.tap()
        if app.buttons["My location"].waitForExistence(timeout: 3) { app.buttons["My location"].tap() }
        sleep(3)
        let to = app.textFields["To"]
        to.tap()
        to.typeText("Newmarket")
        sleep(3)
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Newmarket", "Resume")).firstMatch
        if result.waitForExistence(timeout: 5) { result.tap() }
        app.buttons["Plan journey"].tap()
        sleep(8)
        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers")).firstMatch
        guard card.waitForExistence(timeout: 5) else { XCTFail("no results"); return false }
        card.tap()
        let start = app.buttons["Start this journey"].exists ? app.buttons["Start this journey"] : app.buttons["Resume tracking"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        dismissSystemAlertIfPresent(timeout: 3)
        sleep(5)

        return true
    }

    func testReplanFromTracker() throws {
        guard planAndStartJourney() else { return }
        let better = app.buttons["Find a better route"]
        guard better.waitForExistence(timeout: 8) else {
            attach("rp-00-no-button")
            return XCTFail("no re-plan button")
        }
        sleep(3)
        attach("rp-00-drawer-compact")
        // Drag the drawer up to show the timeline, then back down.
        let top = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.643))
        top.press(forDuration: 0.1, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)))
        sleep(2)
        attach("rp-00-drawer-large")
        app.windows.firstMatch.swipeDown()
        sleep(2)
        better.tap()
        sleep(1)
        attach("rp-01-choices")
        let choice = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label CONTAINS[c] %@", "From ", "Leave from", "Stay on")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 3), "no re-plan choices")
        choice.tap()
        sleep(8)
        attach("rp-02-replanned")
        let keep = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Keep the route I was on")).firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 5), "no keep-route banner")
        keep.tap()
        sleep(4)
        attach("rp-03-kept")
        XCTAssertTrue(app.buttons["Minimise"].waitForExistence(timeout: 8), "tracking didn't reopen")
    }

}
