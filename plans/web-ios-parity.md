# Web ← iOS UI parity

Branch: `feat/web-ios-parity`

## Status (2026-09-29)

All phases (1-8, including 6b) are built on `feat/web-ios-parity`, not yet
committed. Where the build differs from the plan below:

- The Map tab mounts only the current mode's map, so switching Stops and
  Vehicles rebuilds it. This wasn't measured.
- The desktop board's departure opens the tracker in the side panel, over
  the service's own map (`ServiceTrackerView variant="panel"` with
  `hasOwnMap`).
- The tracker's "pick a type, then tap a stop" reminders became
  tap-a-stop (`StopReminderDialog`). The web-only "before it leaves here"
  reminder is kept as a fourth option.
- On phones the app header also hides under a full-screen tracker (iOS
  hides its nav bar), and the phone Map tab's vehicle tracker uses its own
  map.
- The step-by-step planner doesn't send `minTransferSec` to leave-by
  reminders: the reminder form has no field for it on the web.
- The first-visit card is skipped for anyone who already has saved stops,
  places or trips.

## Why

The iOS app started as a port of the web UI, then moved ahead: the UX pass
(PR #22), the UI cleanup, the tracker drawer, and the iPad layouts (PR #23).
The web is now the older design. This plan brings the web's pages, layout
and map features in line with iOS, so a rider moving between the two finds
the same screens in the same places.

## Ground rules

- **The look stays the same.** Keep the neutral shadcn tokens in
  `globals.css` and Geist (see the `theme-change-reverted` memory). The
  change is structure and behaviour, not a new theme.
- **Old URLs keep working.** Push payloads, shared links and the iOS
  `DeepLink` parser all use `/?s=`, `/vehicles?tripId=`, `/journey?id=`,
  `/plan?...`, `/alerts?s=` and `/trip`. New routes redirect from the old
  ones and nothing gets removed. The backend push URLs don't change.
- **Screen size decides the layout.** Mobile widths get the iPhone layout.
  `lg` and up get the iPad "regular width" layout (side panels, two
  columns). This mirrors the `horizontalSizeClass` rule in
  `plans/ipad-support.md`.
- **Screenshot one screen first.** After Phase 1 (the shell), and again
  after the first redone page, stop and show before/after screenshots
  before going on.

## Where they differ today

| Area | iOS (target) | Web (now) |
|---|---|---|
| Navigation | 4 tabs: Home · Planner · Map · Alerts. Bell and ☰ menu (My reminders, Find my vehicle, Settings) on every tab | 6 top links (Schedule, Planner, Stops, Vehicles, Alerts, Settings). Mobile has no tab bar, only a hamburger drawer holding nav, favourites and Find vehicle |
| Resume journey | Docked above the tab bar ("Journey to X · Arrives 8:10am", ✕) | Primary-coloured pill at the bottom on mobile, top on desktop |
| Home | Region title; sections Places / Saved stops / Saved trips / Nearby with counts and Edit/Manage actions; saved stops as rows with next departures; context menus; nearest 3 stops plus "Show more"; no map; two columns when wide | Search, places row, favourites as a horizontal card strip, "Near you" (1 stop on mobile, 6 on desktop), a stops map underneath. Saved trips only on /plan |
| Map | One full-bleed Map tab with a Stops / Vehicles switch; filter pills float on the map; tapping a stop opens a preview card with live next departures; recenter button at the bottom right | Two separate pages. The map sits in a rounded box with chips above it. Tapping a stop opens a MapLibre popup with a link |
| Vehicles | Pills plus a "Route" chip (pick routes: "Where's my 70?") and a "Stops" chip | Pills plus a "Show stops" switch; a vehicle list sidebar at `lg` |
| Stop board | Pushed screen titled with the stop. Toolbar: bell (stop alert subscription), star, ⋯ (Timetable for a date, Directions, Service alerts). Long-press a departure to be reminded before it arrives. "Back to live" after picking a date. Stale-data banner | Board under a search bar, with date picker / navigate / alerts link / star buttons in a row. No stop-subscription bell on the board. No per-departure reminder |
| Map + board on wide screens | Stop board in a 400pt side panel over the map; a departure opens the tracker | Popup link goes to `/?s=`, which leaves the map |
| Service tracker | Map-first drawer. Tap any upcoming stop for a per-stop reminder sheet. Floating back / alerts / follow buttons. Timeline stop list | Map-first drawer (already close). Reminders are "choose a type, then tap a stop". Inline header |
| Planner | Options summary row ("Leave now · 1 km walk · Normal · up to 5 transfers") that opens an options sheet; Transport (bus/train/ferry) toggles; "N routes found · planned 8:02am" plus a refresh once stale; "Later departures"; leg-chain icons; wide screens show list and detail side by side | Inline selects; no mode filter; no later page; detail always opens in a sheet |
| Alerts | Landing lists saved and nearby stops with a one-line alert summary. Stop view has "Get alerts" and clear. Two columns when wide | Stop search, then route tabs |
| Settings | Opened from the menu. Adds a notification permission row and a Planner style row | A top-level nav page |
| First run | Onboarding: region → location → notifications → planner style | None. Location and notification prompts arrive cold |

**Web-only, keep:** the satellite toggle, `/history`, `IosAppBanner`, the
PWA/service worker, and the tracker `dialog` variant on the desktop board.

**Web-only, remove:** the vehicle list sidebar on `/vehicles`
(`components/vehicles/vehicle-list.tsx`), which iOS doesn't have.

**iOS-only, don't port:** Live Activities, widgets, Siri and quick actions,
iCloud sync, offline journey packs and the GPS ride estimator.

## Phase 1: shell and navigation

Files: `components/nav.tsx`, `pages/_app.tsx`,
`components/journey/resume-journey-prompt.tsx`, new `components/tab-bar.tsx`.

1. Change `NAV_ROUTES` to 4 tabs in the iOS order: **Schedule** (`/`,
   the label stays; don't rename it to Home), **Planner** (`/plan`),
   **Map** (`/map`), **Alerts** (`/alerts`). A tab
   is active on its sub-routes too (`/map` covers `/stops` and `/vehicles`
   while those redirects exist).
2. **Mobile:** add a fixed bottom tab bar (icon + label, safe-area padding,
   `bg-background/90 backdrop-blur`). The header keeps only the logo/page
   title, the bell and ☰.
3. **☰ menu** on both sizes: a dropdown on desktop, the existing drawer on
   mobile. It holds **My reminders** (`ManageNotificationsSheet`), **Find my
   vehicle** (`FindCurrentVehicle` as a sheet) and **Settings**. Remove
   favourites from the drawer, since Home shows them.
4. **Desktop:** the top bar shows the 4 tabs, then bell and ☰. Settings
   leaves the tab list.
5. **Resume journey:** restyle the prompt as the iOS card (card background,
   border, live icon, "Journey to X", "Arrives 8:10am · Tap to resume", ✕).
   On mobile, dock it just above the tab bar. Hide it while the planner
   detail or the tracker is open (matching iOS
   `ResumeJourneyVisibility`), and keep the 45-minute grace period and the
   per-plan dismiss.
6. Pages reserve space for the tab bar at the bottom (a CSS var such as
   `--tabbar-h`), so the map heights in `stops`/`vehicles`/`index` stop
   hard-coding `100svh - 4rem`.

Stop here: screenshot the mobile and desktop shell and check the direction.

## Phase 2: the Map page (stops and vehicles in one)

Files: new `pages/map.tsx`; `pages/stops.tsx` and `pages/vehicles.tsx`
become redirects; `components/map/map.tsx`; new
`components/map/floating-controls.tsx`.

1. **`/map?mode=stops|vehicles`**, with a Stops/Vehicles segmented switch
   in the header (mobile) or above the map (desktop). `/stops` →
   `/map?mode=stops`. `/vehicles?tripId=X` → `/map?mode=vehicles&tripId=X`,
   done with `next.config.ts` redirects so the query survives. Check the
   iOS `DeepLink` parser: it needs a `map` case added, although the backend
   never emits `/map`.
2. **Full-bleed map:** no max-width box or rounded frame. The map fills the
   page between the header and the tab bar.
3. **Floating controls**, shared by both modes like the iOS
   `MapModeFilterBar`: All/Bus/Train/Ferry pills in a horizontal scroll row
   floating at the top, each with a light shadow. On the right, a
   recenter-on-me button with the iOS styling (44px, blurred, bordered).
   `MapComp` takes an option to hide its own locate control. The zoom +/−
   buttons stay on desktop only, and the satellite toggle stays.
4. **Stops mode, tap a stop:**
   - mobile: a bottom preview card built on the existing
     `StopPreviewCard`, showing name, code and the next 2 departures, with a
     close button. Tapping the card opens the board.
   - `lg`: open the board straight away in a 400px side panel floating on
     the map's left edge (the iOS `MapSidePanel`). The map's padding and
     controls shift beside it. A departure in the panel opens the tracker
     (`ServiceTrackerView variant="panel"`, replacing the board in the
     panel, with a back arrow).
   - `MapItem` gains an `onClick` to use in place of the popup. Popups stay
     as a fallback for `/history`.
5. **Vehicles mode:** pills, then a **Route** chip that opens a route picker
   (reuse `components/routes/search.tsx`; the chip shows "70, NX1" or "3
   routes", with a Clear chip). The picker filters the markers client-side
   by route id or name. Show "None of these routes are running right now"
   when the filter is empty. Replace the "Show stops" switch with a
   **Stops** chip, and like iOS, show only the nearest 300 stops.
   Selection and the tracker sheet/panel work as they do now. **Remove the
   `lg` vehicle list sidebar** and delete `components/vehicles/vehicle-list.tsx`
   if nothing else uses it. On desktop, the tracker panel docks as a
   `MapSidePanel` over the map instead of beside it.
6. Keep one `map_id` per mode, so switching modes doesn't rebuild a WebGL
   context each time. Mount both modes and hide the inactive one, or
   accept a rebuild. Measure it first.

## Phase 3: Home

Files: `pages/index.tsx`, `components/home/*`, `components/stops/favourites.tsx`,
`components/places/places.tsx`, a new `components/home/section.tsx`.

1. **`HomeSection`**: a small-caps label, an optional count badge, and
   trailing text actions (Edit / Manage / Map). **`HomeHint`**: a dashed
   empty-state card with an icon, a line of text and an optional button.
   Both are straight ports of `HomeCards.swift`.
2. The order is: search → **Places** → **Saved stops** → **Saved trips** →
   **Nearby**. Remove the embedded stops map. Nearby's header gets a "Map"
   action that goes to `/map`.
3. **Saved stops** become vertical rows (`HomeStopRow`: colour tile, name,
   next departures), not the horizontal card strip. Rename, colour, reorder
   and remove move into a row `⋯`/right-click menu. "Edit" opens a manage
   sheet with drag-to-reorder (reuse the current `Reorder.Group` logic).
4. **Saved trips:** add a carousel of cards from the `/plan` saved trips.
   `use-saved-trips.ts` already holds them. Tapping a card goes to
   `/plan?trip=<id>` and plans the trip immediately. "Manage" opens
   `ManageTripsSheet`. When there are none, show a hint with a "Plan a
   journey" button.
5. **Nearby:** 3 distinct-name stops with distance, "Show more nearby stops"
   up to 6, and the same layout on mobile and desktop. If location is off,
   show a hint with an "Enable location" button (don't prompt on page load).
   Row menu: Save stop, Plan a journey here.
6. **`lg`:** two columns, with Places / Saved stops / Saved trips on the
   left and Nearby on the right (1100px max).
7. When a stop is selected (`/?s=`), the board takes over the page (Phase 4).
   The Home sections don't show above it.

## Phase 4: stop board

Files: `pages/index.tsx` (the `?s=` branch), `components/services/index.tsx`,
`components/stops/*`, `components/notifications/index.tsx`.

1. **Header like a pushed iOS screen:** back arrow (to Home or to where the
   rider came from), the stop name as the title, then **bell** (opens
   `StopNotifications` for this stop, which today only appears on
   `/alerts`), **star**, and **⋯**. The ⋯ menu holds Timetable for a date
   (the current `DatePicker`), Directions to stop (`NavigateToStop`) and
   Service alerts (a sheet showing the stop's alerts, not a jump to
   `/alerts`). The search bar leaves the board.
2. A **"Viewing <date> · Back to live"** bar while a date is picked.
3. **Remind me before it arrives** on each departure row, from a ⋯ button
   or right-click/long-press. It reuses the one-shot `addJourneyReminder`
   that the tracker stop list uses.
4. A **stale-data banner** when polling fails ("Last updated 8:02am"), like
   the iOS `StaleDataBanner`.
5. Check platform chips against iOS: "Show more" after the first few.

## Phase 5: service tracker

Files: `components/services/tracker/*`.

1. **Per-stop reminders:** tap an upcoming stop to open a small sheet
   ("Remind me when it's N stops away / arriving / get off here"). This
   replaces the "pick a reminder type, then tap a stop" mode in
   `stops-list.tsx`. Port `StopReminderSheet` from
   `VehicleQuickLookView.swift`. When the tracker was opened from a board,
   "get off" is off, because the rider boards there.
2. **Timeline list:** arrival time, a route-coloured rail that dims once
   passed, markers matching the map's, "in N min" for upcoming stops, and
   the next stop highlighted edge to edge. Keep the collapse behaviour
   (`KEEP_BEHIND`/`KEEP_AHEAD`).
3. **Sheet variant:** float back / route alerts / follow buttons on the map
   (iOS `FloatingBarButton`) in place of an inline header. The follow
   button returns camera control after the rider pans.
4. The header uses the same hero as the journey tracker: route tile,
   heading to, next stop, countdown, then live chips.

## Phase 6: planner

Files: `pages/plan.tsx`, `components/journey/search-form.tsx`,
`results-list.tsx`, `route-detail-sheet.tsx`.

1. **Options row and sheet:** show From/To and swap, then one muted row
   with the options summary that opens a sheet (a `Drawer` on mobile, a
   `Dialog` on desktop). The sheet has When (+ date/time), Walking (max,
   speed), Results (transfers, show N), **Transport** (bus/train/ferry
   toggles → the backend's `modes=` param, which is already live), and Only
   these routes.
2. **Result list header:** "3 routes found · planned 8:02am". Show a
   Refresh action once a "Leave now" search is more than about 2 minutes
   old, and re-run the search when the tab regains focus.
3. **Later departures:** a button under the results that plans again from
   just after the latest departure (or, for arrive-by, just before the
   earliest arrival) and appends the results, de-duplicated by
   legs/times rather than by id.
4. **Leg chain** in each result: start → walk → mode icon + route badge →
   transfer marker with the wait → … → end. Grey out results whose first
   ride has already left.
5. **`lg`:** results in a 440px left column, and the selected journey's
   detail beside it (the first result is auto-selected, and a re-plan
   selects again). On mobile, the detail stays a sheet. "Start" opens live
   tracking as it does now.
6. The step-by-step planner is Phase 6b.

## Phase 6b: step-by-step planner

A port of `ios/Transit/Views/Planner/EasyPlanner/` and the TransitCore
`EasyPlanner.swift` logic. It's a planner **mode**, not a button: when
Settings → Planner is "Step by step" (`localStorage["plannerStyle"]`),
the whole `/plan` page is the flow. Re-plan links and `/plan?…` reminder
links still open the standard planner, with a Close button that goes back.
Keep the type sizes normal (see the `accessibility-text-size` memory): the
flow is easier because it asks fewer questions per screen, not because the
text is bigger.

Files: new `components/journey/easy/` (`flow.tsx`, `question.tsx`,
`choice-card.tsx`, `results.tsx`), `lib/easy-planner.ts`, and
`pages/plan.tsx` (the mode switch).

1. **Four questions, one per screen,** each showing "Question N of 4", a
   full-width button pinned to the bottom, and Back:
   1. *Where do you want to go?* Search, with saved places and saved-trip
      ends offered first. A saved place tapped on Home answers this one.
   2. *How do you want to get there?* "Any way is fine" or one or more of
      Bus / Train / Ferry, offering only the modes the region runs. The
      answer is remembered.
   3. *What time do you want to get there?* "As soon as I can", or "By a
      certain time" with day chips and a time. The default is an hour from
      now, on the next quarter hour.
   4. *Where are you starting from?* "Where I am now" (wait up to 10 s for
      a fix; the answer is remembered) or "Somewhere else". The button
      says "Find my journey".
2. **`lib/easy-planner.ts`,** ported with its tests' cases:
   - Options: `gentle` (0.6 km, 3.6 km/h, 1 change, 120 s) →
     `relaxed` (1 km, 3.6 km/h, 3 changes, 60 s) → `standard`, then any
     transport. If a search finds nothing, try the next one and say what
     changed ("There's no way by train only, so this uses any transport").
   - The "bother" ranking: minutes spent + 10 per change + 15 per km
     walked, and for arrive-by, prefer plans with spare time.
   - Plain-English steps ("Catch the 70 bus at 10:01 am", "From Queen
     Street, stop 7021. Get off at …"). Say "the train" plus the platform,
     not AT's line codes.
   - Send the backend `modes=` and `minTransferSec=` params (both live).
3. **Results:** one recommended journey as numbered steps, with large Start,
   Remind me and Save buttons. "Other options" is one tap away. Show "See
   full details" (the standard detail sheet), "Change the time" (back to
   question 3) and "Plan another journey". When nothing is found, offer a
   way back to the question to change.
4. **Reminders and saved trips** reuse the options the results were planned
   with. The leave-reminder form sends `route_types` and
   `min_transfer_sec`, which the backend already stores.

## Phase 7: Alerts, Settings, first run

1. **Alerts landing** (`pages/alerts.tsx`): before a search, list saved
   stops, then the nearest few, each with "N active, M upcoming" and the
   affected routes. Tapping one opens its alerts. The stop view has the
   stop name, "Get alerts" (the subscription sheet) and clear. At `lg`,
   show the stop list and alerts in two columns. Show route ids without
   the feed-version suffix (`INN-202` → `INN`), as iOS does.
2. **Settings** (`pages/settings.tsx`): reached from ☰. Add a
   **Notifications** row showing web push permission and subscription
   state, with an Enable button (the iOS `PushStatusCard`). Add a
   **Planner** row (Standard / Step by step, which Phase 6b reads). Keep
   Region, Appearance, Map style and Reminders & alerts. Add the app
   version.
3. **First visit** (optional, small): a one-time card on Home, not a
   blocking modal. It asks for the region if location can't choose one,
   then explains location and notifications with buttons, then asks
   which planner to use. It replaces
   today's cold prompts and is gated by `localStorage["hasOnboarded"]`.

## Phase 8: QA

- Widths 375 / 768 / 1024 / 1440, light and dark, keyboard, and screen
  reader labels on icon-only buttons.
- Test every old URL: `/?s=`, `/stops`, `/vehicles`,
  `/vehicles?tripId=`, `/journey?id=`, `/plan?…` (reminder link),
  `/alerts?s=`, `/trip?…`. Click a real web push notification.
- Performance on the map page: marker counts in stops mode with
  clustering, and the WebGL context when switching modes.
- `npm run lint` and `npm run build`.

## Suggested PR split

1. The shell (Phase 1): small, and it sets the direction.
2. The Map page (Phase 2), which is the biggest.
3. Home and the board (Phases 3–4).
4. Tracker and planner (Phases 5–6).
5. Step-by-step planner (Phase 6b).
6. Alerts, Settings, first run and QA (Phases 7–8).

## Decisions (2026-09-29)

- **Mobile bottom tab bar:** yes.
- **Tab label:** keep "Schedule"; don't rename it to Home. Only the page
  sections follow iOS.
- **Step-by-step planner:** yes, port it (Phase 6b).
- **Vehicle list sidebar:** no, remove it.
