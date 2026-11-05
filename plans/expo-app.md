# One app for iOS and Android (Expo)

Status (2026-11-04): phases 0-2 done; first pass of 3-7 written on
`feat/expo-app` (uncommitted). See "Where it stands" at the end for what's
verified, what isn't, and what's left. Replaces the SwiftUI app in `ios/`
with one React Native (Expo) app that ships to both stores. The SwiftUI app
stays live and keeps getting fixes until the Expo app reaches parity (phase 7).

## Why Expo

- The web frontend is already React + TypeScript. Types, the API client,
  regions, formatting, fares and the easy-planner steps can live in one shared
  package used by web and mobile.
- Expo has maintained modules for most of what the app needs: notifications,
  location + background tasks, secure storage, file system, deep links.
- Native pieces that no framework can avoid (Live Activities, widgets, Siri)
  stay in Swift/Kotlin inside the same repo, built by Expo config plugins.
- Over-the-air JS updates (EAS Update) for fixes that don't touch native code.

## Decisions (made 2026-11-04)

1. **Map engine: Apple Maps** (changed 2026-11-05 - originally MapLibre).
   iOS draws native MapKit via `react-native-maps` (the SwiftUI app's map).
   Android draws Apple MapKit JS in an Expo DOM component
   (`components/apple-map-web.tsx`), with tokens from the backend's
   `GET /mapkit/token` (`backend/mapkit.go`: 30-minute ES256 JWTs signed with
   the MapKit JS key in `MAPKIT_TEAM_ID` / `MAPKIT_KEY_ID` /
   `MAPKIT_PRIVATE_KEY`). Apple's unrestricted dashboard tokens last only
   7 days, and the web view (`file://`) can't use a domain-restricted one.
   Without a key on the server (503), Android uses MapLibre
   (`components/maplibre-map.tsx`). Production needs the backend deployed
   with those env vars. Screens pass lines and markers as data
   (`components/map-types.ts`); `transit-map.{ios,android}.tsx` pick the
   engine. MapKit JS has no pitch, so no 3D on Android's Apple map.
2. **Sync: none for now.** Saved stops, places and trips stay on each device
   (local storage). No backend sync API in phase 1; it can be added later.
3. **Bundle ID: replace the SwiftUI app** as `dev.suddsy.transit`. Phase 7
   adds a one-off migration of the SwiftData store into local storage.

## Repo layout

```
packages/shared/      TS: API types, client, regions, formatting, ported TransitCore logic + tests
mobile/               Expo app (Expo Router, TypeScript)
  app/                screens (file-based routes = tabs + stacks + deep links)
  components/         UI, Bush theme
  modules/            local Expo native modules (shared storage, Live Activity bridge, Android live notification)
  targets/            iOS extension targets via @bacons/apple-targets: widgets + Live Activity, Siri intents
frontend/             web, switched to import from packages/shared
backend/              Go, gains FCM + sync
ios/                  SwiftUI app, frozen to fixes, deleted after phase 7
```

`frontend` and `mobile` each depend on `packages/shared` with a `file:`
link (not root npm workspaces: those would move `frontend/`'s install and
could break its deploy). The shared package ships TypeScript source with no
build step and no runtime dependencies, so neither app gets a second copy of
anything: Next compiles it via `transpilePackages`, Metro via `watchFolders`.

## Library choices

| Need | Library |
| --- | --- |
| Navigation, deep links | Expo Router |
| Server data + polling (10 s boards, 20 s stop times) | TanStack Query |
| Styling, Bush theme tokens | `StyleSheet` + `mobile/src/theme` for now; NativeWind (or Uniwind) once its SDK 58 support is confirmed |
| Bottom drawer over the map | `@gorhom/bottom-sheet` |
| Icons (match map markers to stop list) | `lucide-react-native` (same set as web) |
| Device ID secret (was Keychain) | `expo-secure-store` |
| Push tokens + local notifications | `expo-notifications` (raw APNs / FCM tokens, not Expo's push service) |
| GPS + background tracking | `expo-location` + `expo-task-manager` (Android foreground service) |
| Offline journey pack | `expo-file-system` |
| Connectivity (was `NetworkMonitor`) | `@react-native-community/netinfo` |
| Local saved data | `expo-sqlite` (or MMKV for small key-value data) |
| Haptics, share sheet | `expo-haptics`, `expo-sharing` / RN `Share` |
| UI tests (replaces XCUITest) | Maestro |
| Unit tests | Vitest in `packages/shared`, Jest for the app |

## Phases

### Phase 0: groundwork (about 1 week)

- Create `packages/shared`, linked into both apps.
- Move from `frontend/lib/` into shared: `url-store.ts` region table (region
  data only, not the React context), `formating.ts`, `fares.ts`, `fare-type.ts`,
  `walk-speed.ts`, `easy-planner.ts`, `region-time.ts`, `alert-causes.ts`,
  `colors.ts`, `reliability.ts`. Web imports them from shared; behaviour unchanged.
- Shared API types and a typed fetch client covering
  `TransitCore/API/Endpoints.swift` and `NotificationEndpoints.swift`.
  Region config then lives in two places (Go + shared TS) instead of three.
- `npx create-expo-app mobile` with Expo Router, NativeWind, dev client builds
  on EAS. Bush palette as theme tokens.

#### Phase 0: what shipped (2026-11-04)

- `packages/shared` (`@transit/shared`, Vitest, 21 tests): `api.ts`
  (`createApiClient`: region + trace id + extra headers supplied by each
  app), `regions.ts`, `region-time.ts`, `formatting.ts` (the pure helpers),
  `walk-speed.ts`, `colors.ts`, `alerts.ts` (no icons), `fares.ts`,
  `reliability.ts` (types + change keys), `easy-planner.ts`, and
  `types/journey|geojson|stops.ts`. Functions that need the region's
  timezone take it as a parameter.
- `frontend/lib/*` and `components/journey/types.ts`,
  `components/map/geojson-types.ts` are now thin wrappers that re-export
  shared code and fill in the selected region, so no web call site changed.
  `next build`, `tsc` and lint pass.
- Stayed in the web for now: the moment-timezone countdowns in
  `formating.ts` (port them to `Intl` in phase 2), the React hooks in
  `fare-type.ts` / `fares.ts` / `reliability.ts`, and `reliabilityTone`
  (Tailwind classes).
- `mobile/`: Expo SDK 58 (RN 0.88, React 19.3), Expo Router native tabs
  (Home, Planner, Map, Updates; Updates hidden for Otago), Settings modal
  with the region picker, the Bush palette in `src/theme`, region + trace id
  in AsyncStorage, and a live stop search on Home that goes through the
  shared client. The other tabs are placeholders. `npm run lint`,
  `npm run typecheck` and `npm run bundle:check` (iOS + Android bundles) pass.
- Temporary IDs: bundle/package `dev.suddsy.transit.expo`, scheme
  `transit-expo`, so dev builds sit beside the SwiftUI app. Switch to
  `dev.suddsy.transit` / `transit` at phase 7 (decision 3).
- Not done yet: per-endpoint typed functions (they come with the model port
  in phase 2), EAS project setup (needs `eas login`), app icon, Geist font.
  Android can't be built on this Mac yet (no Java / Android SDK).

### Phase 1: backend for Android (about 1 week, deploy before any app release)

- **FCM sender** next to APNs and Web Push in
  `backend/providers/notifications/push_sender.go`, using the FCM HTTP v1 API.
  Same channel-neutral `Payload`; clean up on `UNREGISTERED`.
- `/devices/register` accepts `platform: "android"` and an FCM token. Live
  Activity endpoints stay iOS-only; Android gets "live notification" updates
  through FCM data messages that the app renders itself.
- **Sync API** (decision 2): `GET/PUT /sync/saved` for stops, places and trips,
  with per-item `updatedAt` and tombstones so merges are additive (same rule as
  the SwiftData schema: only ever add fields).
- `frontend/public/.well-known/assetlinks.json` for Android App Links, covering
  the same paths as the AASA file (`/trip`, `/journey`, `/map`, `/vehicles`).

#### Phase 1: what shipped (2026-11-04)

- `backend/providers/notifications/fcm.go`: FCM HTTP v1 sender (service
  account JWT via `golang-jwt/v5`, cached OAuth token), Android channels
  `journey` / `alerts`, token cleared on UNREGISTERED. Env:
  `FCM_SERVICE_ACCOUNT_JSON`. Android push is simply off without it.
- `notifications.fcm_token` column; `platform = 'android'` device rows
  (same id + hashed secret scheme as iOS, can't take over an iOS row or the
  reverse); `/devices/register` and `/devices/update-token` take
  `platform=android&fcmToken=`. Tests in `fcm_test.go`; `go test ./...` passes.
- No sync API (decision 2). No `assetlinks.json` yet: it needs the Android
  signing key's SHA-256 from `eas credentials`.
- **Not deployed.** Deploy before shipping an Android build.

#### Phase 2: what shipped (2026-11-04)

`packages/shared/src`: `models.ts` (wire types), `endpoints.ts` (every
endpoint incl. devices/notifications/Live Activities), and `logic/`:
`basics` (formatting, geo, board sort, alert status, plan pruning,
DepartureDetector, WalkNavigationTracker, VehicleProgressRatchet),
`deeplink`, `tracking` (JourneyProgressModel, connection risk, GPS policy),
`journey-live` (buildLiveJourney, replan choices), `motion` (RouteLine,
VehicleMotion), `live-content` (Live Activity / Android live notification
content), `reminders`, `offline` (OfflineRideEstimator, moments, pack).
86 Vitest tests, most ported 1:1 from TransitCoreTests.

Found while porting: Swift `.rounded()` is half-away-from-zero, JS
`Math.round` isn't - use `roundHalfAway`. And iOS
`OfflineJourneyMomentsTests.testSettingOffMomentsBeforeTheFirstWalk` fails
on master (stale: it ignores leaveBy's minute rounding).

### Phase 2: port TransitCore logic to TS (about 2 weeks)

`ios/Packages/TransitCore` is platform-free and well tested, so port it file
by file into `packages/shared` **with its tests** (fixtures in
`Tests/TransitCoreTests` move over too). Where web already has a TS version,
reconcile and keep one.

| Swift (`TransitCore/Sources/TransitCore/`) | Notes |
| --- | --- |
| `Models/*` | Becomes the shared API types; `GoTypes.swift` decoding rules matter (Go null slices, times) |
| `API/APIClient`, `Envelope`, `APIError`, `DeepLink`, `Region` | Client + deep-link parser |
| `Logic/DepartureBoard`, `AlertStatus`, `Formatting`, `Geo`, `WalkSpeed` | Straight ports |
| `Logic/EasyPlanner` | Merge with `frontend/lib/easy-planner.ts` |
| `Logic/JourneyProgressModel`, `JourneyTrackingSupport`, `JourneyLiveAdjuster`, `JourneyReplan`, `JourneyPlanRanking` | Leg-advance logic; web's `route-detail-sheet.tsx` has the original. Keep the Swift version (it has the 2026-09-16 fix) |
| `Logic/JourneyReminders`, `DepartureDetector` | Reminder requests, "you've left" detection |
| `Logic/JourneyGPSPolicy` | Battery tiers: resting / coarse / pedestrian / precise |
| `Logic/OfflineRideEstimator`, `OfflineJourneyMoments`, `Store/OfflineJourneyPack` | Offline tracking |
| `Logic/VehicleMotion`, `VehicleProgressRatchet` | Vehicle gliding + never-moves-backwards |
| `Logic/WalkNavigationTracker` | Walking leg progress |
| `Logic/LiveActivityContentBuilder`, `Models/LiveActivityModels` | Feeds the iOS Live Activity *and* the Android live notification |
| `Store/DeviceIdentity`, `InstallIdentity`, `SyncHygiene` | Identity on secure-store; hygiene rules reused by the new sync |

### Phase 3: core screens (about 3 weeks)

Matching the current iOS design (Bush theme, 4 tabs + Settings gear):

| iOS (`ios/Transit/`) | Expo |
| --- | --- |
| `Views/RootView`, `DesignSystem/AppShell` | `app/(tabs)/_layout.tsx` |
| `Views/Onboarding/OnboardingView` | `app/onboarding.tsx` |
| `Views/Home/*`, `Views/Places/SavedPlacesViews` | Home "Boards" tab |
| `Views/Board/StopBoardView`, `Views/Search/StopSearchField` | Stop board + search |
| `Views/Planner/*` incl. `EasyPlanner/*` | Planner "Where to?" + easy planner |
| `Views/Alerts/*`, `Views/Notifications/*` | Updates tab (For you / Service alerts), alert subscriptions |
| `Views/Settings/SettingsView` | Settings |
| `Map/*`, `Views/MapBrowse/*`, `DesignSystem/BottomDrawer`, `MapSidePanel` | Map tab: floating bar, filter menu, stops + vehicles, clusters (`supercluster` reused from web) |
| `Views/Vehicle/*` | Trip tracker (countdown + progress strip + bell per stop) |
| `Services/DeepLinkRouter`, `DeepLinkPresentationView` | Expo Router links + notification taps |
| `Services/PushRegistrationService` | Register device, send APNs (iOS) / FCM (Android) token every launch |

Tablets: use `useWindowDimensions` breakpoints for the iPad side-panel layout
(same idea as the size-class layouts).

Gotchas carried over: Otago has no realtime (hide Updates' live parts), keep
normal type sizes and respect system font scaling on "easy" screens, markers
use the same icons and colours as the stop list.

### Phase 4: journey tracking (about 2–3 weeks)

- `JourneyTrackingSession` + `JourneyAlertCenter` → a tracking store
  (Zustand or context) driving the journey tracker screen (countdown + place,
  leg strip by real times, problems-first status, End in ⋯).
- Leave reminders (`LeaveReminderSheet`, `UpcomingRemindersList`).
- Background location through `expo-task-manager`, using the ported
  `JourneyGPSPolicy`. Android runs this as a foreground service with its own
  ongoing notification. **Always read the precise coordinate for placing the
  rider** (see `ios-gps-resting`).
- `JourneyOfflineNotifications` → scheduled local notifications from
  `expo-notifications`.
- Map follow modes: follow vehicle, follow rider with heading, frame points
  inside the free area. Rebuild 3D + chase cam on the chosen map engine
  (decision 1); vehicle gliding from the ported `VehicleMotion`.

### Phase 5: native extras (about 2–3 weeks)

**iOS** (Swift, in `mobile/targets/` via `@bacons/apple-targets`):

- Move `ios/TransitWidgets/*` (`DeparturesWidget`, `JourneyLiveActivity`,
  `WidgetColor`) and `ios/Shared/*` (`JourneyActivityAttributes`,
  `SharedStore`, `RouteColors`, `SavedStopIntents`) in mostly unchanged.
  `JourneyActivityAttributes` is mirrored by the server, so don't change it.
- A small local Expo module (`modules/live-activity`) to start, update and end
  activities, return push tokens and push-to-start tokens, and adopt
  activities started by push. This replaces `LiveActivityCoordinator`.
- A local module (`modules/shared-group`) that writes region, saved stops and
  places into the app group for widgets and Siri.
- Siri App Intents (`App/SiriIntents.swift`) and quick actions
  (`App/QuickAction.swift`, or `expo-quick-actions`).

**Android** (Kotlin):

- Live journey notification: ongoing notification, using Android 16
  `ProgressStyle` "Live Updates" where available, updated by the app while
  open and by FCM data messages while not. Content comes from the ported
  `LiveActivityContentBuilder`.
- Departures widget: `react-native-android-widget` (JS-rendered), or Glance
  if it needs more.
- App shortcuts for saved stops (replaces Siri / quick actions).

### Phase 6: offline journeys (about 1–2 weeks)

- Save the `OfflineJourneyPack` JSON (plan, stops with coordinates, latest
  predictions, shapes, walking directions) on each successful poll.
- With no connection: `OfflineRideEstimator` from GPS + local notifications.
- Test with airplane mode on real devices on both platforms. Android
  background limits (Doze, OEM battery killers) are the main risk here.

### Phase 7: switch over (about 1 week)

- **Data migration** (if decision 3 keeps the bundle ID): the SwiftData store
  in the app group is SQLite. A one-off native module reads it on first launch
  and uploads saved stops, places and trips to the sync API (or the local
  store), then marks itself done.
- TestFlight + Play internal testing with real commutes, then release.
- Remove `ios/`, update `ARCHITECTURE.md` (iOS app section, push, links and
  sync) and the regions-sync note (now Go + shared TS only).

## Rough total

About 3–4 months part-time to parity, phases 2 and 4 being the biggest.
Phases 0–1 are useful even if the rewrite stops early: the shared package
tidies the web, and FCM + sync are needed for any Android app.

## Risks

- **Background GPS on Android.** Foreground-service rules and OEM battery
  savers can kill tracking. Budget real-device testing.
- **Map 3D parity.** Apple Maps' 3D buildings and look won't carry over
  exactly.
- **Live Activity bridge.** Push-to-start adoption has to work when the app
  is launched in the background, not just from a cold open.
- **Feel.** Some SwiftUI polish (glass toolbars, native sheets) will be
  approximated. `expo-router` native tabs and `@gorhom/bottom-sheet` get close.
- **Two stores, two review processes.** EAS Build + Submit handles both.

## Where it stands (2026-11-04)

Written (first pass) in `mobile/`:

- **Phase 3 screens:** Boards Home (search, round launcher, your stops,
  near you), stop board (`stop/[query]`), "Where to?" planner (auto-plans,
  chips, leave later / arrive by, easy steps), journey detail with leave-by
  reminders, Map tab (MapLibre, clustered stops, live vehicles, mode
  filter), trip tracker (countdown, stop strip, bell per stop), Updates
  (For you / Service alerts), stop / route alerts and stop subscriptions,
  Settings (region, pace, fares, map, test push), onboarding, place editor.
  Universal links / push paths via `src/app/+native-intent.tsx`.
- **Phase 4 tracking:** `src/lib/journey-session.ts` runs the shared
  progress model, DepartureDetector, live adjuster and offline estimator
  on a 5 s tick over `realtime/journey` (10 s); session persisted;
  `journey/track/[id]` with problems-first status, leg strip, in-app
  get-on/get-off banners; local notifications for moments
  (`src/lib/moments.ts`).
- **Phase 5 native:** `modules/transit-native` (Swift: Live Activities,
  push / push-to-start tokens, app group, legacy store reader; Kotlin:
  ongoing live journey notification); `targets/widgets` (the SwiftUI
  departures widget and Live Activity, moved with a small
  `WidgetSupport.swift` instead of TransitCore) via `@bacons/apple-targets`.
- **Phase 6 offline:** the offline estimator and local notifications are
  in the session; the offline *pack* (saving plan + stops + shapes to disk
  for a cold start with no data) is not wired yet.
- **Phase 7:** `src/lib/migrate.ts` reads the SwiftUI app's SwiftData
  store once and imports saved stops, places and trips.

Not done yet:

- Background tracking with the app suspended (an `expo-task-manager`
  location task using `gpsMode`); today tracking runs while the app is open,
  with server pushes / Live Activity updates and local notifications covering
  the rest.
- Offline pack persistence (above); fare estimates on plan cards; saved
  trips UI; reliability screens; Siri App Intents and quick actions; an
  Android home-screen widget; Android 16 promoted "Live Updates" style.
- assetlinks.json (needs the release key's SHA-256); EAS project + signing;
  Firebase project + `google-services.json` for Android FCM; deploying the
  backend's FCM changes.
- Switching the bundle ID / scheme from `dev.suddsy.transit.expo` /
  `transit-expo` to `dev.suddsy.transit` / `transit`, then deleting `ios/`.
- Android: builds and runs on the API 37 emulator (2026-11-04) - onboarding,
  Home boards with live data, Map (MapLibre tiles + clustered stops)
  checked by tapping through. Package is `dev.suddsy.transit.android`
  (Firebase project `transit-nz`); EAS project `@jfmow/transit` linked.
  Debug builds need Android 17's local-network permission to reach Metro.

## iOS parity pass (2026-11-04)

After "it doesn't fully look or work like the iOS app", every screen was
rebuilt against the SwiftUI views (reference screenshots captured from the
SwiftUI app in the simulator):

- **Home, stop board, Map tab** - iOS layouts (round launcher, header capsule
  with bell/star/more, platform chips, schedule-for-date, glass map toggle and
  filter menu, Find a vehicle, route filter).
- **Planner** - "Where to?" search, From…Change, Leave now / Options sheets
  (`planner-time`, `planner-options`; uses `@react-native-community/datetimepicker`,
  so a native rebuild), Your places, Saved trips + Manage, Save trip, result
  cards as `JourneyResultCard` (fare, Direct/transfers, alarm, Left, disruption
  strip), Latest you can leave, Later departures. Settings > Planner > Step by
  step makes the tab the step-by-step flow (`components/easy-planner-flow.tsx`).
- **Journey detail** - still map preview (tap for `journey-map` full screen),
  summary card with leave countdown, `JourneyLegBar`, fare detail, disruption
  banner, "Your trip" `JourneyTimeline` with live/untracked icons and change
  odds, Start / Resume + alarm pinned at the bottom, share and save.
  `leave-reminder` is a port of `LeaveReminderSheet` (when to leave / if
  something changes, repeat never / weekdays / custom, last day). Plans keep
  their search context (`planContext` in `lib/plans.ts`) so reminders and
  saves get the real start and end labels.
- **Trip tracker** - `VehicleQuickLookView`: full map, follow + more, drawer
  with countdown to your stop, progress strip, Live/off course/occupancy,
  every stop with a bell (`trip-reminder` adds Get off here).
- **Journey tracker** - iOS hero ("Walking to…", "27H leaves … at …"),
  leg bar with you-are-here, problems-first status line, Find a better route
  (`replanChoices` → planner with `departAt`), share, timeline with leg
  status, End journey confirm (End / Minimise / Keep tracking).
- **Updates** - For you / Service alerts chips + gear; inbox grouped Today /
  Earlier with long-press dismiss and an "Alerts & reminders" manage screen;
  service alerts search, Your stops / Near you summary rows ("N happening now,
  M planned", route badges, All clear), a stop's alerts with Get alerts.
- **Settings** - Reminders & alerts link, Planner style; iOS wording.

Follow-up the same day: Appearance (System/Light/Dark via
`Appearance.setColorScheme`) and Map style settings; the walking
turn-by-turn card in the journey tracker (`lib/walk-nav.ts`, shared
`WalkNavigationTracker`, `map/nav` once per walk leg); opaque stack headers
app-wide (content was hidden under the iOS glass header); Close on the
step-by-step modal; trip tracker drawer header and list no longer overlap.
Backend: `realtime/alerts/:stop` returns 404, not 500, for a stop with no
routes (the app shows "All clear") - needs a deploy for production.

Still not done: iPad layouts. The walking card hasn't been seen on a
device (needs a real walk or a simulated GPS route).

## Look and icons pass (2026-11-05)

"Clean the overall look to look more polished like the iOS app, and match the
icons": compared each screen with the SwiftUI screenshots and the SwiftUI
source's exact sizes.

- **Icons:** `components/icons.tsx` replaces Lucide. Each export (same names
  as before) draws the SF Symbol the SwiftUI view uses on iOS and the closest
  Material Symbol on Android, via `expo-symbols` (no native rebuild needed on
  Android - the font loads from JS). `fill` picks the `.fill` variant. Tab bar
  uses the SwiftUI tab symbols, filled.
- **Sizes:** inline 16-18 pt overrides removed in favour of the iOS type scale
  (`Theme.swift`): greeting 24 semibold, headings 16 (`cardTitle`), rows 15,
  meta 13, minutes 15 (Home) / 16 (board), route badges 11-12 semibold with
  4 pt corners. Launcher 56 pt circles, 12 pt labels; search fields 44 pt;
  gear 40 pt; board header 44 pt; planner chips 32 pt; buttons are 44 pt
  capsules; map pins ~28 pt.
- **`FitRow`** (`components/ui.tsx`): SwiftUI `ViewThatFits` - detail and
  status lines drop items from the end instead of wrapping or clipping
  (board rows, both trackers).
- **Map:** OpenFreeMap "liberty" by day (blue water, green parks - closest
  to Apple Maps); dark at night.
- Planner hides "Saved trips" until there is one, as iOS does.
