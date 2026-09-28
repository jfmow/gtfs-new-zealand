# iPad support

Branch: `feat/ipad-support`

## Principle

Branch layouts on `horizontalSizeClass == .regular`, never on device idiom.
Split View ⅓, Slide Over and small Stage Manager windows report `.compact`
and get the existing iPhone layout for free; the iPhone app is untouched.

## Phase 0 - turn it on, fix breakage (shippable alone)

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

## Phase 1 - shell

- `TabView` `.tabViewStyle(.sidebarAdaptable)` behind `#available(iOS 18)`.
- Resume journey: keep `ResumeJourneyCard` fallback on regular width
  (`tabViewBottomAccessory` is an iPhone tab-bar thing).
- Keyboard: ⌘1-4 tabs, ⌘F stop search, ⌘R refresh. `.hoverEffect()` on map
  buttons/cards.

## Phase 2 - map screens get a side panel

`MapDetailLayout` (DesignSystem): compact = map + `BottomDrawer`; regular =
full map + floating leading panel (~380-420pt, full height, scrolls), camera
insets on the leading edge instead of the bottom. Like Apple Maps on iPad /
the web's desktop split tracker.

1. `VehicleQuickLookView` - drawer header+content into the panel.
2. `JourneyTrackingView` - itinerary in the panel, current-step card over the
   map. Replaces the Phase 0 stopgap.
3. Map tab - tapping a stop opens `StopBoardView` in the panel (map stays);
   vehicles mode opens the vehicle tracker there.

## Phase 3 - wide list pages

- Planner: form + results left, selected `JourneyDetailView` right (with a
  route map preview) instead of a push. Step-by-step planner: width cap only.
- Home: two-column section grid (places + saved stops | trips + nearby).
- Stop board: departures + side column (stop map, alerts).
- Alerts: list + detail.

## Phase 4 - polish

- `DeparturesWidget`: `.systemLarge` (maybe `.systemExtraLarge`).
- Context menus on stop/trip rows (right-click for free).
- Wi-Fi iPads have no GPS: check `OfflineRideEstimator` / background
  location tracking degrade cleanly.
- App Store: 13" iPad screenshots (TransitUITests can capture).

## Risks

- `JourneyTrackingView`'s sheet has a history of state bugs - moving to the
  in-view panel is safer than patching the sheet for iPad.
- TabView builds every tab eagerly (sidebar too) - keep the stop annotation cap.
- No backend change: iPad registers its own APNs token; no Live Activities
  (`areActivitiesEnabled` false), so banners are the fallback.
- iPhone landscape stays off; size-class layouts make it cheap later.
