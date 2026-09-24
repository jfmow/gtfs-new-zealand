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
        for label in ["Allow While Using App", "Allow Once", "Allow", "Open", "OK"] {
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

    /// Screens touched by the UI cleanup, for review: Home with a
    /// favourite, a bus stop's route filter, the planner (options sheet,
    /// results, journey detail).
    func testCleanupSurvey() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        let search = app.textFields["Search for stop..."]
        XCTAssertTrue(search.waitForExistence(timeout: 5))

        // Favourite Britomart (if it isn't already), then back to Home.
        search.tap()
        search.typeText("Britomart")
        sleep(2)
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Britomart")).firstMatch.tap()
        sleep(3)
        if app.buttons["Add to favourites"].waitForExistence(timeout: 3) { app.buttons["Add to favourites"].tap() }
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(3)
        attach("cs-01-home")

        // A bus stop with no platforms - route filter chips, its alerts
        // sheet and a service's tracker.
        search.tap()
        search.typeText("Ponsonby Road 8100")
        sleep(2)
        let bus = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "8100")).firstMatch
        if bus.waitForExistence(timeout: 3) {
            bus.tap()
            sleep(4)
            attach("cs-02-bus-board")
            XCTAssertTrue(app.buttons["All routes"].exists, "no route filter at a stop without platforms")
            let bell = app.navigationBars.buttons["Get alerts for this stop"]
            if bell.exists {
                bell.tap()
                sleep(3)
                attach("cs-02b-stop-alerts")
                app.buttons["Done"].firstMatch.tap()
                sleep(1)
            }
            // Prefer a live service ("N stops away") so the tracker has a vehicle.
            let live = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS[c] %@", "departure-row", "away")).firstMatch
            let row = live.exists ? live : app.buttons.matching(identifier: "departure-row").firstMatch
            if row.waitForExistence(timeout: 3) {
                row.tap()
                sleep(6)
                attach("cs-02c-service-tracker")
                // Drawer: tap the header to cycle medium -> full -> collapsed.
                let header = app.staticTexts["Live"].firstMatch
                if header.exists {
                    header.tap()
                    sleep(2)
                    attach("cs-02c2-tracker-expanded")
                    header.tap()
                    sleep(2)
                    attach("cs-02c3-tracker-collapsed")
                    header.tap()
                    sleep(2)
                }
                let upcoming = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "min")).element(boundBy: 1)
                if upcoming.exists {
                    upcoming.tap()
                    sleep(2)
                    attach("cs-02c4-stop-reminder")
                    if app.buttons["Cancel"].exists { app.buttons["Cancel"].tap() }
                    sleep(1)
                }
                app.buttons["Back"].tap()
                sleep(1)
            }
            app.navigationBars.buttons.element(boundBy: 0).tap()
            sleep(1)
        }

        // Bell -> Alerts & reminders, and Settings.
        let bellButton = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Notifications")).firstMatch
        if bellButton.waitForExistence(timeout: 2) {
            bellButton.tap()
            sleep(2)
            attach("cs-02d-bell")
            if app.buttons["Alerts & reminders"].waitForExistence(timeout: 2) {
                app.buttons["Alerts & reminders"].tap()
                sleep(3)
                attach("cs-02e-manage")
                app.navigationBars.buttons.element(boundBy: 0).tap()
                sleep(1)
            }
            app.buttons["Done"].firstMatch.tap()
            sleep(1)
        }
        let menu = app.navigationBars.buttons["Menu"]
        if menu.waitForExistence(timeout: 2) {
            menu.tap()
            if app.buttons["Settings"].waitForExistence(timeout: 2) {
                app.buttons["Settings"].tap()
                sleep(2)
                attach("cs-02f-settings")
                app.buttons["Done"].firstMatch.tap()
                sleep(1)
            }
        }

        // Planner.
        app.tabBars.buttons["Planner"].tap()
        sleep(2)
        attach("cs-03-planner")
        let options = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Options")).firstMatch
        if options.waitForExistence(timeout: 3) {
            options.tap()
            sleep(2)
            attach("cs-04-options")
            app.buttons["Done"].tap()
            sleep(1)
        }
        let from = app.textFields["From"]
        from.tap()
        if app.buttons["My location"].waitForExistence(timeout: 3) { app.buttons["My location"].tap() }
        sleep(3)
        let to = app.textFields["To"]
        to.tap()
        to.typeText("Onehunga")
        sleep(3)
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND NOT label BEGINSWITH[c] %@", "Onehunga", "Resume")).firstMatch
        if result.waitForExistence(timeout: 5) { result.tap() }
        app.buttons["Plan journey"].tap()
        sleep(8)
        attach("cs-05-results")
        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@ AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers", "Options")).firstMatch
        let alarm = app.buttons["Remind me when to leave for this journey"].firstMatch
        if alarm.waitForExistence(timeout: 3) {
            alarm.tap()
            sleep(2)
            attach("cs-05b-reminder")
            app.buttons["Cancel"].firstMatch.tap()
            sleep(1)
        }
        if card.waitForExistence(timeout: 5) {
            card.tap()
            sleep(3)
            attach("cs-06-detail")
            app.swipeUp()
            sleep(1)
            attach("cs-07-detail-timeline")
        }
    }

    /// The service tracker's drawer, once expanded, closes again by pulling
    /// down on its stop list (not only by the header).
    func testTrackerDrawerCollapsesFromList() throws {
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        let search = app.textFields["Search for stop..."]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Ponsonby Road 8100")
        sleep(2)
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "8100")).firstMatch.tap()
        let row = app.buttons.matching(identifier: "departure-row").firstMatch
        guard row.waitForExistence(timeout: 10) else { throw XCTSkip("no services at this stop right now") }
        row.tap()
        let nextTag = app.staticTexts["Next stop"]
        guard nextTag.waitForExistence(timeout: 10) else { attach("dc-00-no-list"); throw XCTSkip("no live vehicle on this service") }

        // Expand: tap the drawer's header (half -> full).
        let live = app.staticTexts["Live"].firstMatch
        live.tap()
        sleep(2)
        attach("dc-01-expanded")

        // Pull down on the list itself (below the header): full -> half,
        // then half -> collapsed.
        let window = app.windows.firstMatch
        for step in 1...2 where nextTag.exists && nextTag.isHittable {
            nextTag.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)))
            sleep(2)
            attach("dc-02-after-pull-\(step)")
        }
        XCTAssertFalse(nextTag.exists && nextTag.isHittable, "drawer didn't close when pulled down from its list")

        // Drag the header back up to the top: the list must come back.
        live.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)))
        sleep(2)
        attach("dc-03-dragged-up")
        XCTAssertTrue(nextTag.exists && nextTag.isHittable, "drawer didn't open when its header was dragged up")
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
        // Position check first (cheap), then hittability, over every marker.
        let candidates = stopMarkers.allElementsBoundByIndex.filter { marker in
            let f = marker.frame
            return f.minY > window.height * 0.2 && f.maxY < window.height * 0.7 && f.minX > 20 && f.maxX < window.width - 20
                && !groupFrames.contains(where: { $0.insetBy(dx: -6, dy: -6).intersects(f) }) && marker.isHittable
        }
        guard !candidates.isEmpty else { attach("st-00-no-marker"); return XCTFail("no single stop marker on screen") }
        // The tap previews the stop; use the first one with services right
        // now (late at night some stops have none).
        let preview = app.buttons.matching(identifier: "stop-preview").firstMatch
        var stopID: String?
        for marker in candidates.prefix(6) {
            if preview.exists { app.buttons["Close"].firstMatch.tap(); sleep(1) }
            // A real touch at the marker - an element tap on a map
            // annotation's accessibility element doesn't reliably select it.
            marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            guard preview.waitForExistence(timeout: 5) else { continue }
            sleep(3)
            if !preview.label.localizedCaseInsensitiveContains("No upcoming") { stopID = marker.identifier; break }
        }
        guard let stopID else { attach("st-00-no-preview"); throw XCTSkip("no nearby stop has services right now") }
        attach("st-00-preview")
        preview.tap()

        let row = app.buttons.matching(identifier: "departure-row").firstMatch
        guard row.waitForExistence(timeout: 10) else { attach("st-00-no-board"); return XCTFail("board didn't open") }
        attach("st-01-board")
        row.tap()
        sleep(3)
        attach("st-02-tracker")
        XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5), "tracker not shown")
        XCTAssertFalse(row.isHittable, "board is still on top of the tracker")

        app.buttons["Back"].tap()
        sleep(1)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(2)
        let sameStop = app.descendants(matching: .any).matching(identifier: stopID).firstMatch
        guard sameStop.waitForExistence(timeout: 3) else { return XCTFail("stop marker gone after going back") }
        // The preview is still up from before - close it, then re-tap.
        if preview.exists { app.buttons["Close"].firstMatch.tap(); sleep(1) }
        sameStop.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5), "re-tapping the same stop didn't preview it")
        preview.tap()
        // The board screen itself (its departures can take a while to load).
        XCTAssertTrue(app.navigationBars.buttons["Get alerts for this stop"].waitForExistence(timeout: 10), "re-tapping the stop didn't open its board")
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
            let options = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Options")).firstMatch
            if tab == "Planner", options.waitForExistence(timeout: 2) {
                options.tap()
                sleep(1)
                attach("vp-05b-planner-options")
                app.buttons["Done"].tap()
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

    /// Every Live Activity layout from fixture states (`LA_DEMO_JSON`, a
    /// Debug-only hook in LiveActivityCoordinator): compact + expanded
    /// Dynamic Island and the Lock Screen for walking, waiting, on board
    /// (with a tight connection), and arrived.
    func testLiveActivityLayouts() throws {
        let now = Date().timeIntervalSince1970
        let chain = #"[{"mode":"walk","shortName":"","colorHex":""},{"mode":"transit","shortName":"S-C","colorHex":"EE3524"},{"mode":"walk","shortName":"","colorHex":""},{"mode":"transit","shortName":"70","colorHex":"0073BD"}]"#
        let fixtures: [(String, String)] = [
            ("walking", #"{"version":3,"legIndex":0,"phase":"walking","routeShortName":"S-C","routeColorHex":"EE3524","headsign":"Te Waihorotiu","primaryText":"Leave by 7:52am","secondaryText":"Walk to Te Waihorotiu for the S-C","countdownLabel":"Leave in","targetUnix":\#(now + 400),"delayMinutes":0,"status":"onTime","arrivalUnix":\#(now + 2400),"progressFraction":0,"totalLegs":4,"platform":"2","legChain":\#(chain),"updatedUnix":\#(now),"isRealtime":true,"boardStopName":"Te Waihorotiu","alightStopName":"Newmarket","walkMinutes":4,"walkMeters":320,"hasVehicle":false}"#),
            ("waiting", #"{"version":3,"legIndex":1,"phase":"waiting","routeShortName":"S-C","routeColorHex":"EE3524","headsign":"Newmarket","primaryText":"Board the S-C","secondaryText":"at Te Waihorotiu · Platform 2 · 3 stops away","countdownLabel":"Departs in","targetUnix":\#(now + 250),"delayMinutes":3,"status":"delayed","stopsAway":3,"arrivalUnix":\#(now + 2400),"progressFraction":0.2,"totalLegs":4,"platform":"2","legChain":\#(chain),"updatedUnix":\#(now),"isRealtime":true,"boardStopName":"Te Waihorotiu","alightStopName":"Newmarket","hasVehicle":true,"occupancy":1}"#),
            ("onboard", #"{"version":3,"legIndex":1,"phase":"onboard","routeShortName":"S-C","routeColorHex":"EE3524","headsign":"Newmarket","primaryText":"Get off at Newmarket","secondaryText":"Then 70 at 8:14am · 2 min to change","countdownLabel":"Arrives in","targetUnix":\#(now + 420),"delayMinutes":0,"status":"tightConnection","stopsAway":2,"arrivalUnix":\#(now + 2400),"progressFraction":0.5,"totalLegs":4,"legChain":\#(chain),"nextLeg":{"routeShortName":"70","routeColorHex":"0073BD","departureUnix":\#(now + 660),"connectMinutes":2},"updatedUnix":\#(now),"isRealtime":true,"boardStopName":"Te Waihorotiu","alightStopName":"Newmarket","nextStopName":"Grafton","rideStops":7,"hasVehicle":true,"occupancy":2}"#),
            ("arrived", #"{"version":3,"legIndex":3,"phase":"arrived","primaryText":"You've arrived","secondaryText":"","countdownLabel":"","targetUnix":\#(now),"delayMinutes":0,"status":"arrived","arrivalUnix":\#(now),"progressFraction":1,"totalLegs":4,"legChain":\#(chain),"updatedUnix":\#(now),"isRealtime":true,"hasVehicle":false}"#),
        ]
        for (name, json) in fixtures {
            app.launchEnvironment["LA_DEMO_JSON"] = json
            app.launch()
            dismissSystemAlertIfPresent(timeout: 3)
            for label in ["Allow", "Always Allow"] {
                let allow = springboard.buttons[label]
                if allow.waitForExistence(timeout: 2) { allow.tap(); break }
            }
            sleep(3)
            XCUIDevice.shared.press(.home)
            sleep(2)
            let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            compact.name = "la-\(name)-1-compact"
            compact.lifetime = .keepAlways
            add(compact)

            // Long-press the island to expand it.
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.03)).press(forDuration: 1.2)
            sleep(2)
            let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            expanded.name = "la-\(name)-2-expanded"
            expanded.lifetime = .keepAlways
            add(expanded)
            XCUIDevice.shared.press(.home)
            sleep(1)

            XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
            sleep(2)
            XCUIDevice.shared.press(.home)
            sleep(3)
            let lock = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            lock.name = "la-\(name)-3-lock"
            lock.lifetime = .keepAlways
            add(lock)
            // Unlock (no passcode on the simulator) for the next round.
            XCUIDevice.shared.press(.home)
            sleep(2)
            app.terminate()
        }
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

        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@ AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers", "Options")).firstMatch
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
        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@ AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers", "Options")).firstMatch
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
        attach("rs-02-detail")
        // The detail screen has its own "Resume tracking" button - no bar there.
        let resumeBar = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Resume journey to")).firstMatch
        XCTAssertFalse(resumeBar.exists, "resume bar shown over the journey's own detail screen")
        app.navigationBars.buttons.firstMatch.tap()
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
        let card = app.buttons.matching(NSPredicate(format: "(label CONTAINS[c] %@ OR label CONTAINS[c] %@) AND NOT label BEGINSWITH[c] %@ AND NOT label BEGINSWITH[c] %@", "Direct", "transfer", "Transfers", "Options")).firstMatch
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


    /// Offline journey walkthrough, driven from outside: the shell opens a
    /// journey (`OFFLINE_JOURNEY_ID`), then cuts the API off and moves the
    /// simulated location along the ride while this takes screenshots -
    /// foreground first, then with the app in the background (for the
    /// notifications) and back.
    func testOfflineJourneyWalkthrough() throws {
        let id = ProcessInfo.processInfo.environment["OFFLINE_JOURNEY_ID"] ?? ""
        guard !id.isEmpty, let url = URL(string: "transit://journey?id=\(id)&region=at&track=1") else { throw XCTSkip("no OFFLINE_JOURNEY_ID") }
        app.launch()
        dismissSystemAlertIfPresent(timeout: 4)
        app.open(url)
        for _ in 0..<3 { dismissSystemAlertIfPresent(timeout: 3) }
        XCTAssertTrue(app.buttons["Minimise"].waitForExistence(timeout: 15), "tracker didn't open")
        let env = ProcessInfo.processInfo.environment
        let foregroundShots = Int(env["OFFLINE_FG_SHOTS"] ?? "") ?? 12
        let backgroundShots = Int(env["OFFLINE_BG_SHOTS"] ?? "") ?? 12
        for n in 0..<foregroundShots {
            sleep(20)
            attach(String(format: "off-fg-%02d", n))
        }
        XCUIDevice.shared.press(.home)
        for n in 0..<backgroundShots {
            sleep(20)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = String(format: "off-bg-%02d", n)
            shot.lifetime = .keepAlways
            add(shot)
        }
        app.activate()
        sleep(3)
        attach("off-back")
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// End on the tracker takes the Live Activity off straight away.
    func testEndDismissesLiveActivity() throws {
        let id = ProcessInfo.processInfo.environment["OFFLINE_JOURNEY_ID"] ?? ""
        guard !id.isEmpty, let url = URL(string: "transit://journey?id=\(id)&region=at&track=1") else { throw XCTSkip("no OFFLINE_JOURNEY_ID") }
        app.launch()
        app.open(url)
        dismissSystemAlertIfPresent(timeout: 3)
        XCTAssertTrue(app.buttons["End"].waitForExistence(timeout: 15), "tracker didn't open")
        sleep(3)
        XCUIDevice.shared.press(.home)
        sleep(2)
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); before.name = "end-01-before"; before.lifetime = .keepAlways; add(before)
        app.activate()
        sleep(2)
        attach("end-01b-tracker")
        app.buttons["End"].tap()
        sleep(1)
        attach("end-01c-after-tap")
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(2)
        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); after.name = "end-02-after"; after.lifetime = .keepAlways; add(after)
    }

    /// Walks the step-by-step planner (Settings' Planner = Step by step): a
    /// destination, train only, as soon as possible, from where I am now -
    /// with a screenshot of each question and the answer.
    func testEasyPlannerFlow() throws {
        app.launchArguments += ["-plannerStyle", "stepByStep"]
        app.launch()
        dismissSystemAlertIfPresent(timeout: 3)
        app.tabBars.buttons["Planner"].tap()

        // 1. Where
        let field = app.textFields["Type a place or address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        attach("easy-01-where")
        field.tap()
        field.typeText("Newmarket Train Station")
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Newmarket")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        attach("easy-02-where-chosen")
        app.buttons["Next"].tap()

        // 2. How - clear the remembered answer first, then train only.
        let anyWay = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Any way is fine")).firstMatch
        XCTAssertTrue(anyWay.waitForExistence(timeout: 5))
        anyWay.tap()
        let train = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Train")).firstMatch
        train.tap()
        attach("easy-03-how")
        app.buttons["Next"].tap()

        // 3. When
        let soon = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "By a certain time")).firstMatch
        XCTAssertTrue(soon.waitForExistence(timeout: 5))
        soon.tap()
        attach("easy-04-when")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "As soon as I can")).firstMatch.tap()
        app.buttons["Next"].tap()

        // 4. From
        let here = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Where I am now")).firstMatch
        XCTAssertTrue(here.waitForExistence(timeout: 5))
        here.tap()
        attach("easy-05-from")
        app.buttons["Find my journey"].tap()
        dismissSystemAlertIfPresent(timeout: 2)

        let start = app.buttons["Start this journey"]
        let failed = app.staticTexts["Sorry"]
        _ = start.waitForExistence(timeout: 40) || failed.exists
        attach("easy-06-result")
        app.swipeUp()
        attach("easy-07-result-scrolled")
        XCTAssertTrue(start.exists, "no journey was found")
    }
}
