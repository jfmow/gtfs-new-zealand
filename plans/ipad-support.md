# iPad support

Branch: `feat/ipad-support`

## Principle

Branch layouts on `horizontalSizeClass == .regular`, never on device idiom.
Split View ⅓, Slide Over and small Stage Manager windows report `.compact`
and get the existing iPhone layout for free; the iPhone app is untouched.

## Phase 0 - turn it on, fix breakage (done)

1. `project.yml`: `TARGETED_DEVICE_FAMILY: "1,2"` on Transit, TransitWidgets,
   TransitUITests. iPhone stays portrait; `UISupportedInterfaceOrientations~ipad`
   gets all four (required for Split View / Stage Manager - no
   `UIRequiresFullScreen`). Keep multiple scenes off (`DeepLinkRouter` /
   `JourneyTrackingSession` are app-wide).
2. `.readableContentWidth()` (max ~700pt, centred) on Home, Board, Alerts,
   Settings content, toasts.
3. `JourneyTrackingView`: on regular width, swap the system detent sheet (a
   centred form sheet on iPad) for the in-view `BottomDrawer`.
4. Test: iPad Pro 13", iPad mini, both orientations, Split View ⅓ / ½ / ⅔;
   map camera insets on rotation; `shadSheet` detents (ignored on iPad);
   onboarding + deep-link covers.

## Phase 1 - shell (done)

- Sidebar: skipped. iPadOS 26 already shows the TabView as a top tab bar,
  and with 4 tabs a sidebar adds little; `.sidebarAdaptable` wants the iOS 18
  `Tab` API, i.e. a second copy of the tab shell while we support 17.2.
- Resume journey: `ResumeJourneyCard` at regular width (the tab bar
  accessory is for the iPhone's bottom bar); accessory unchanged on iPhone.
- Go menu (`.commands`): ⌘1-4 tabs, ⌘F stop search (Home pops to root and
  focuses it). ⌘R dropped - boards poll and have pull-to-refresh.
- `.hoverEffect()` on `RecenterButton` / `FloatingBarButton`.

## Phase 2 - map screens get a side panel (done)

`MapSidePanel` (DesignSystem): 400pt floating panel on the map's leading
edge at regular width; `MapSidePanelMetrics.occupiedWidth` for controls and
camera insets beside it.

1. `VehicleQuickLookView` - summary + stop list in the panel instead of
   `BottomDrawer`; top bar and camera to the right of it.
2. `JourneyTrackingView` - Phase 0's one-off panel now uses `MapSidePanel`.
3. Map tab (stops) - a tapped stop opens straight into a panel board
   (`StopBoardView(embedding:)`: inline header with bell/star/more/close, no
   nav bar of its own). A departure hands its trip back to `StopsTabView`,
   which pushes it as `PanelTripDestination` (a pushed board already
   registers `TripDestination` on the same stack). Vehicles mode unchanged:
   a vehicle pushes the tracker, which has its own panel.

## Phase 3 - wide list pages (done)

- Planner: form + results in a 440pt left column, the selected result's
  `JourneyDetailView(isEmbedded: true)` beside it (first result selected
  automatically; a re-plan reselects). Starting a journey from the detail
  column pushes the tracker as before. Step-by-step planner: width cap only.
- Home: two columns at 1100pt - places / saved stops / saved trips left,
  nearby right.
- Alerts: search + your stops in a 400pt left column, the chosen stop's
  alerts on the right.
- Stop board side column: skipped. The board is already a readable 720pt
  column, and on iPad the Map tab now shows a board beside the map, so a
  stop map next to a pushed board would duplicate that.

## Phase 4 - polish (done)

- `DeparturesWidget`: `.systemLarge` and `.systemExtraLarge` (all 8 fetched
  departures, with headsigns). Builds; not yet eyeballed on a Home Screen.
- Context menus: saved stops and saved trips already had them (right-click
  on iPad for free); added one to Home's nearby rows (Save stop / Plan a
  journey here).
- Wi-Fi iPads have no GPS: no change needed. Offline with no fixes,
  `OfflineRideEstimator` places nothing and tracking falls back to the
  timetable; the "On board · from GPS" chip only shows when fixes exist.
  Live Activities are off on iPad (`areActivitiesEnabled`), banners instead.
  Checked by reading the code, not on a device.
- App Store: `testAppStoreScreenshotsIPad` captures 2064x2752 portrait shots
  (13" size). Set the status bar with `simctl status_bar ... override` first
  and make sure the simulator has a location. Content depends on live data -
  the stop it taps may have nothing running, so re-run or mix runs.

## Risks

- `JourneyTrackingView`'s sheet has a history of state bugs - moving to the
  in-view panel is safer than patching the sheet for iPad.
- TabView builds every tab eagerly (sidebar too) - keep the stop annotation cap.
- No backend change: iPad registers its own APNs token; no Live Activities
  (`areActivitiesEnabled` false), so banners are the fallback.
- iPhone landscape stays off; size-class layouts make it cheap later.
