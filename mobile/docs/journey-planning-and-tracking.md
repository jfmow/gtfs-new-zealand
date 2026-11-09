# Journey planning and tracking (Expo app)

How the Expo app plans a journey, previews it and tracks it live: every option, every state, how the
map moves and what each button does. The behaviour copies the SwiftUI app (`ios/Transit`); the
iOS name for each piece is given where it helps to compare the two.

Most of the rules (phases, moments, GPS policy, re-plan choices, ranking) live in
`packages/shared`, so the Expo app, the web app and the iOS port agree. This file names them
and their numbers; the code is the source of truth if the two ever differ.

## Contents

1. [Files](#files)
2. [Searching (the Planner)](#searching-the-planner)
3. [Planner options](#planner-options)
4. [The step-by-step planner](#the-step-by-step-planner)
5. [Results](#results)
6. [The journey preview](#the-journey-preview)
7. [Tracking: lifecycle](#tracking-lifecycle)
8. [Tracking: the session tick](#tracking-the-session-tick)
9. [Journey phases](#journey-phases)
10. [The tracker screen](#the-tracker-screen)
11. [Map movement (camera)](#map-movement-camera)
12. [Map lines and markers](#map-lines-and-markers)
13. [Alerts and the Lock Screen](#alerts-and-the-lock-screen)
14. [GPS](#gps)
15. [Offline](#offline)
16. [Constants](#constants)

---

## Files

| File | What it does |
| --- | --- |
| `src/app/(tabs)/planner.tsx` | The Planner tab: "Where to?" search, start, when, options, results. |
| `src/app/planner-time.tsx` | The "Leave now ▾" sheet (when). |
| `src/app/planner-options.tsx` | The Options sheet. |
| `src/components/easy-planner-flow.tsx` | The step-by-step planner (tab or `/easy-planner` modal). |
| `src/components/location-search.tsx` | Place search results. |
| `src/lib/planner-store.ts` | When + options state, `whenLabel`, `optionsChanged`. |
| `src/lib/plans.ts` | Plan cache (`rememberPlans`, `usePlan`), plan context (`contextFor`), fares, connection odds, live trip ids. |
| `src/app/journey/[id].tsx` | The journey preview. |
| `src/app/journey-map.tsx` | The preview's full-screen map. |
| `src/app/journey/track/[id].tsx` | The tracker screen. |
| `src/lib/journey-runner.tsx` | The app-wide runner: start/stop, the latest tick, reminders, Lock Screen. |
| `src/lib/journey-session.ts` | One tracked journey: polling, GPS, the progress model, the tick. |
| `src/lib/journey-status.ts` | What the tracker's drawer says (headline, countdown, status row). |
| `src/lib/tracker-camera.ts` | Map camera modes and the hook that moves the map. |
| `src/lib/walk-nav.ts` | Turn-by-turn for walk legs. |
| `src/lib/moments.ts` | Get-on / get-off reminders as local notifications. |
| `src/lib/live-surface.ts` | Live Activity (iOS) / live notification (Android). |
| `src/lib/journey-location.ts` | Journey GPS, including in the background. |
| `src/lib/journey-pack.ts` | The journey saved on the phone for offline use. |
| `src/components/journey.tsx` | Shared journey UI: plan card, leg bar, timeline, map lines. |
| `src/components/resume-journey.tsx` | The "Tap to resume" bar shown while a journey is tracked. |

---

## Searching (the Planner)

The Planner tab is search-first (iOS "Where to?", 2026-11-03). If **Settings > Planner > Step by
step** is on, the tab shows the step-by-step planner instead, unless a link, saved trip or re-plan
opened it with a start or destination (`standard`, `toLat`, `fromLat` or `arriveBy` param).

### Fields

| Field | Default | How it changes |
| --- | --- | --- |
| Destination ("Where to?") | empty | Type 2+ characters for place results (`api.searchLocations`, 8 results); pick Home, Work, a saved place or a saved trip; or from a link. Clearing the text clears the destination. |
| Start ("From …") | Current location | "Change" switches the search field to "Where from?" and offers Current location as well. Without a location fix and no start chosen, results say "Waiting for your location, or choose a start." |
| Swap (⇅) | - | Shown once both ends are set. The start becomes the destination; if the start was your location, it's named by reverse geocoding (`placeName`). |
| When ("Leave now ▾") | Leave now | See below. Resets to Leave now each launch. |
| Options | defaults | See [Planner options](#planner-options). The pill is filled when anything differs from the defaults. |

### When

`plannerWhenStore` (`planner-store.ts`), set from the "When" sheet:

| Mode | Label | Request |
| --- | --- | --- |
| `now` | Leave now | `timeType: "now"`, no date |
| `departat` | Leave 6:45pm | `timeType: "departat"`, the date |
| `arriveat` | Arrive by 9:00am | `timeType: "arriveat"`, the date |

The picker opens 15 min ahead for "Leave at" and 1 h ahead for "Arrive by", and won't go more than
1 h into the past. iOS uses an inline date-and-time picker; Android uses separate Date and Time
fields.

Links can set it too:

- `arriveBy=1` (a recurring reminder): switches to Arrive by, an hour from now, if it was Leave now.
- `departAt=<ms>` (the tracker's "Find a better route"): Leave at that time, or Leave now if it's
  less than a minute away.

### When a search runs

A search runs once both ends are set, and not while you're choosing the start. The query key is
the whole request, so changing any field, option or the walking speed searches again. Results stay
fresh for 60 s; pull to refresh searches again and clears "Later departures".

Each search saves its **plan context** (`contextFor` in `plans.ts`) with every plan it returns:
the start and end labels and the options used. The preview, saved trips, leave-by reminders and the
tracker's destination name ("Journey to …") read it. Plans opened from a link have no context.

---

## Planner options

`plannerOptionsStore` (`planner-store.ts`). Saved between launches, like iOS. "Reset" puts back the
defaults.

| Option | Default | Values | Request field |
| --- | --- | --- | --- |
| Max walk | 1 km | 300 m, 500 m, 800 m, 1 km, 1.5 km, 2 km, 3 km | `maxWalkKm` |
| Speed | Normal | Slow 2.5, Normal 3.6, Brisk 4.5 km/h | `walkSpeed` (stored in **Settings**, `settings.walkSpeed`, so the step-by-step planner uses it too) |
| Transfers | Up to 5 | Direct only (0) … Up to 5 | `maxTransfers` |
| Transport | any | Bus, Train, Ferry (any combination; none = any) | `modes` |
| Routes | any | Route numbers, searched by short name (8 matches) | `onlyRoutes` (route ids) |

Older saved walking speeds (3 / 4.8 / 5.5 and 2.8 / 4 / 5) are mapped onto the current three
(`normalizeWalkSpeed`).

---

## The step-by-step planner

`easy-planner-flow.tsx` (iOS `EasyPlannerFlow`). Four questions, then one recommended journey:

1. **Where to?** A place search.
2. **Where from?** "Where I am now" (disabled without a location) or a place.
3. **How?** "Any way is fine", or any of Bus / Train / Ferry; plus "Walk less, fewer changes".
4. **When?** "As soon as I can" (leave now) or "By a certain time" (arrive by).

"Find the easiest way" tries these searches in order (`easyAttempts`) and stops at the first that
finds anything:

| Attempt | When | Transport | Options |
| --- | --- | --- | --- |
| 1 | always | your choice | Walk less: `GENTLE`; otherwise `STANDARD` |
| 2 | Walk less | your choice | `RELAXED`, with the note "To find a way, this one has a bit more walking or an extra change." |
| 3 | transport was limited | any | `RELAXED` (walk less) or `STANDARD`, with "There's no way by …, so this uses any transport." |

| Preset | Max walk | Speed | Transfers | Min change time |
| --- | --- | --- | --- | --- |
| `STANDARD` | 1 km | your walking speed | 5 | none |
| `GENTLE` | 600 m | 3.2 km/h | 1 | 2 min |
| `RELAXED` | 1 km | 3.2 km/h | 3 | 1 min |

The result is `recommendedPlan` (see [Results](#results)).

---

## Results

Each search's plans go through:

1. `pruneDominatedPlans`: drops a plan when another one departs no earlier, arrives no later, and
   has no more changes or walking, and is better on at least one of those.
2. `rankedPlans`: the recommendation first, then the rest by departure time.

**The recommendation** (`recommendedPlan`) has the lowest "bother" score in minutes: time spent
(from now; for arrive-by, from leaving) + 10 per change + 15 per km walked. For arrive-by it only
considers plans that arrive on time, and prefers ones that arrive at least 5 min early.

The list shows:

- "N routes found · planned 6:42pm"
- **Latest you can leave: …** (arrive-by only)
- Plan cards, with a fare when Settings > Show fares is on
- A bell on each card for a leave-by reminder (only for plans with a ride that hasn't left yet)
- A plan whose first ride has already left is shown as missed
- **Later departures** (not for arrive-by): searches again, leaving 1 min after the last plan's
  first ride, and adds new plans to the end.
- **Save trip** / **Saved**: saves the start and destination (Planner > Saved trips).
- Errors show **Try again**. No plans: "No way found - Try leaving at a different time, or change
  the options."

---

## The journey preview

`journey/[id].tsx` (iOS `JourneyDetailView`). Opens a plan by id, from this session's results or
from the server (`services/plan/:id`, for shared links and reminders). If the server no longer has
it: "This journey has expired - plan it again."

| Part | Notes |
| --- | --- |
| Map | Still preview of the whole route. Tap for the full-screen **Journey map** (pannable, shows you). |
| Summary | Depart → arrive, the summary line (with fare), and "Leave in N min" when it leaves within 3 h (warning colour at 2 min or less). The leg bar; fare detail. |
| Disruption | "Service disruption on this route…" when a ride is affected. |
| Your trip | The timeline. Live badges for rides with a vehicle reporting now (polled every 30 s; rides more than 3 h off keep the plan's answer). Connection odds for each change. |
| Header | **Save trip** (only with a plan context) and **Share** (`journeyWebLink`, without `track=1`). |
| Bottom | **Start this journey** / **Resume tracking** (when it's the tracked one) opens the tracker. **Remind me** (alarm clock) when there's a ride and it leaves more than a minute from now. |

Opening the preview with `remind=1` (from the step-by-step planner) goes straight to the reminder
sheet.

---

## Tracking: lifecycle

Tracking runs **app-wide**, not in the tracker screen (iOS `JourneyTrackingSession` lives on the app
environment). `JourneyRunner` is mounted once in the root layout and runs the session for the
saved active journey. The tracker screen and the resume bar only read the latest tick.

```
open tracker ──► startJourney(planId)        saves ActiveJourney (replaces any other)
                     │
JourneyRunner ──► Session(plan) ──► useJourneySession: every tick ──► journeyTickStore
                     │                                                    │
                     ├─ saveJourneyPack (offline copy)                    ├─ tracker screen
                     ├─ scheduleMoments (get-on / get-off reminders)      └─ resume bar
                     └─ updateLiveSurface (Live Activity / notification)

End journey ──► stopJourney: clears the journey, the pack, GPS, reminders, the Lock Screen
```

| Event | What happens |
| --- | --- |
| Open the tracker | `startJourney`. Same journey: nothing. Another journey: that one is stopped first. Only one journey is tracked at a time. |
| Minimise (‹) | Leaves the screen; tracking, reminders and the Lock Screen carry on. The resume bar on the tabs ("Journey to …, Arrives 8:10am · Tap to resume") brings you back; dismissing the bar hides it for that journey without ending it. After arrival, Minimise ends the journey (nothing left to resume). |
| End journey | ⋯ > End journey, then the confirmation: **End journey**, **Minimise instead**, **Keep tracking**. |
| Arrived | Reminders are cancelled. The Lock Screen shows "arrived" for 90 s, then goes. |
| Nobody ended it | The journey stops itself 45 min after its arrival time. |
| App relaunched | `ActiveJourney` is saved, so the runner resumes it: the "got off" ratchet, each ride's GPS progress and when you set off are restored. With no signal, the offline pack stands in for the server's plan. |

**`ActiveJourney`** (saved, `journey-session.ts`): `planId`, `region`, `startedAt`, `setOffAt`
(when GPS saw you leave the start), `alightedThroughLeg` (the last leg you've got off),
`rides` (`OfflineRideEstimator` progress per trip).

---

## Tracking: the session tick

`useJourneySession` recomputes every **5 s**, on each GPS fix, and when live data or a ride's stop
list arrives.

1. **Live data**: polls `realtime/journey` every **10 s** for the plan's trips (vehicles + stop time
   predictions for each ride's board and alight stops). It's skipped in regions without realtime.
   GPS fixes also trigger a poll when the last one is more than 10 s old, because timers don't run
   in the background but fixes do.
2. **Stops**: each ride's stop list (`trip-stops`, cached for good).
3. **Set off**: on a first walk leg, `DepartureDetector` notices you leaving the start (150 m from
   it after being within 100 m, ignoring fixes less accurate than 100 m). `setOffAt` is saved.
4. **GPS stands in for missing vehicles**: `OfflineRideEstimator` places a ride from your GPS when
   it has no live vehicle (offline, or a quiet feed). It also re-times the ride's stops. Such rides
   are "estimated". A live vehicle that lags behind you is moved forward, including off your stop
   when the feed still has it there but GPS has it on its way.

   GPS counts you as on a ride after two fixes in a row on the route (within 150 m) and 150 m past
   your stop at 4.5 m/s or more, from 3 min before it leaves. While the vehicle is at your stop
   (last tick's phase was `boarding`), it's sooner: 50 m past, within 50 m of the route, at
   2.5 m/s. City buses are often slower than 4.5 m/s for their first 150 m, which kept "Get on
   now" showing after you'd got on.
5. **Re-timed plan**: `buildLiveJourney` applies live predictions and `setOffAt` to the plan. This
   is the `displayPlan` everything shows.
6. **Progress**: `JourneyProgressModel.update` works out the current leg, phase, tracked trip, stops
   away, tracking level and arrival (see [Journey phases](#journey-phases)). "Hold at start": while
   you're within 100 m of the start and haven't set off, the first walk isn't started.
7. **Content**: `buildLiveActivityContent`, the same text the Lock Screen shows.
8. **GPS mode**: picked for the next fixes (see [GPS](#gps)).

The **tick** (`JourneyTick`) holds: `displayPlan`, `snapshot` (the progress), `content`,
`vehicles` (live + estimated, by trip id), `user` (your position), `online`, `lastLiveAt`.

---

## Journey phases

From `JourneyProgressModel` (`packages/shared/src/logic/tracking.ts`).

| Phase | When |
| --- | --- |
| *(none)* | Not started, or there's no current leg. |
| `walking` | On a walk leg, and not at the next ride's stop. |
| `waiting` | At the stop for your next ride (within 40 m; you stay "at" it until 120 m away) on a walk leg; or on a ride leg before the vehicle is near. |
| `boarding` | On a ride leg and the vehicle is at your stop, or its next stop is yours and it's within 350 m (bus) / the closer limit for other modes, or it's already past. Without a live vehicle: within 90 s of the departure. |
| `onboard` | The vehicle has left your stop (`hasDepartedStop`). |
| arrived | `journeyArrived`: on the last leg, every ride done, and the arrival time has passed. |

Other snapshot fields the screen uses:

| Field | Meaning |
| --- | --- |
| `progressLegIndex` | The leg you're on (-1 before starting, `legs.length` once arrived). |
| `trackedTripId` | The ride being watched: the one you're on, or the next one. |
| `trackedStopsAway` | Before boarding: stops until the vehicle reaches you. On board: stops before yours. |
| `trackedStopsToGo` | 0 when the vehicle is at the target stop. |
| `trackingLevel` | `live` (a vehicle in the feed), `estimated` (from your GPS), `predicted` (stop predictions, no vehicle), `scheduled` (timetable only). |
| `alightedThroughLeg` | Ratchet: once you've got off a ride (the vehicle passed your stop, or you're 10 m+ from it after it reached your stop), it never goes back. |

A ride with no live vehicle that's more than 5 min overdue is skipped for a later ride that is live.

---

## The tracker screen

`journey/track/[id].tsx` (iOS `JourneyTrackingView`). A full-screen map, a top bar, an optional
banner, and a drawer.

### Top bar

| Button | Label | Action |
| --- | --- | --- |
| ‹ | Minimise | Back to where the tracker was opened from (Home if from a link or notification). After arrival it ends the journey. |
| Location | Follow my journey / Following your journey | Recentres the map (see [Map movement](#map-movement-camera)). Filled while the map is following. |
| ⋯ | More | **3D map** / **Flat map**, and **End journey** (behind a confirmation). |

Share isn't in ⋯: it's in the drawer (as on iOS, where a share sheet can't open from behind the
drawer).

**3D map** is the same setting as the Map tab's 3D (`mapFilterStore.threeD`). Toggling it hands the
camera back to the journey, so the map tilts or flattens on the spot.

### Banners (over the map, under the top bar)

| Banner | When | Notes |
| --- | --- | --- |
| Walking step | `walking` and directions are loaded | Turn icon, instruction ("Turn right onto Queen Street") and distance to the turn; "You've arrived" at the end. From `useWalkNavigation`: walking directions for the leg (from the leg's start), advanced by `WalkNavigationTracker` from GPS. |
| Moment | Once per ride, for 8 s, with a haptic | "Get on the 75 now" (`boarding`) and "Get off at the next stop" (on board, 0 stops away). Takes the walk card's place while it shows. |

While a banner shows, the map's clear area shrinks by 76 pt and the camera refits.

### Drawer

A bottom sheet with three stops, like iOS's detents:

| Stop | Height | Shows | Map clear area ends |
| --- | --- | --- | --- |
| Peek | handle + hero row + 16 pt (measured, so it fits a one- or two-line hero) | What you're doing now and the countdown | at the peek |
| Compact (opens here) | 40% | Down to the actions | 380 pt up |
| Full | 90% | Everything, including Your trip | half the screen |

Moving between stops changes the map's clear area, so the camera refits to keep things centred in
what's visible.

**Hero.** An icon (✓ arrived, 🚶 walking or no ride left, else the route badge), the headline, the
subline and a countdown.

| State | Headline | Countdown | Subline extra |
| --- | --- | --- | --- |
| No tick yet | Your journey | - | - |
| No current leg | Tracking | Leave from *first stop* | - |
| walking | Walking to *stop* / Almost there / Walking | *Route* leaves *stop* | Platform N |
| waiting | Waiting for the *route* | *Route* leaves *stop* | Platform N |
| boarding | Boarding the *route* | *Route* leaves *stop* | Platform N |
| onboard | On the *route* → *stop* | Get off at *stop* | Next stop: … |
| Between rides with no ride next | (phase) | Arrive at *destination* | - |
| arrived | You've arrived | - | "at *destination*" |

The subline reads "*caption* *place* at *time*, *extra*". The countdown reads "N min", "1h 5m" or
"Now", and turns the warning colour under 2 min to a departure. The destination is the search's
label, or else the last stop's name (`destinationLabel`).

**Leg bar.** Each leg, the current one outlined, with progress through the whole trip by time.
Under it: "Arrive 10:18pm" and "26 min trip".

**Status row.** Built by `trackerSummary` (`journey-status.ts`), problems first. Items that don't
fit drop off the end instead of wrapping (iOS `ViewThatFits`). Only while tracking and not arrived:

| Item | When |
| --- | --- |
| ⚠ Not running | The next ride is cancelled (danger). |
| ⚠ Connection missed / Tight connection | A later change is at risk (`connectionRisk`). |
| Offline | The last live poll failed (warning). |
| N min late / N min early | The next ride is 1 min+ off schedule. |
| ● Live / Updating | Live vehicle; "Updating" with a spinner when the data is more than 45 s old. |
| From GPS | The ride is placed from your GPS. |
| Predicted | Stop predictions without a vehicle. |
| Timetable only | No live data. |
| *Route* is N stops away / *route* arriving / *route* at your stop | Before boarding. |
| N stops to go / Get off at the next stop / At your stop - get off | On board. |
| Seats free / … | Occupancy, when reported. |
| N cars | Train length, when known. |
| Saved offline | Online, the offline pack is complete, and you're not yet on the first ride. |

**Actions.**

- **Find a better route**: only when there are re-plan choices; red when a change is at risk or the
  ride isn't running. It offers a list of places to plan from (`replanChoices`), and picking one
  opens the Planner from there, to the destination, leaving then:

  | Phase | Choices |
  | --- | --- |
  | onboard | Get off at *next stop*; Stay on to *your stop* |
  | walking | From where I am now; From *the stop you're walking to* (when you get there) |
  | waiting / boarding | Leave from *this stop* now; Take the *route* anyway (re-route from where it drops you) |

  Nothing on the last leg or once arrived.
- **Share**: "Follow my journey" + the link with `track=1`, which opens the tracker. It's a full
  "Share journey" button when there's no Find a better route.

**Your trip.** The timeline, with legs marked done / current / upcoming and a live badge on rides
with a vehicle (live or estimated).

---

## Map movement (camera)

`tracker-camera.ts`: `journeyCamera` picks a **mode** from the journey state, and `useTrackerCamera`
moves the map. It's a port of the SwiftUI `MapCamera` enum. The trip tracker uses the same hook.

### Modes by stage

| Stage | Mode | Fallback |
| --- | --- | --- |
| Not started / arrived / no tick | `fitAll`: the whole route, start and end | - |
| walking | `followUser`: you, 350 m across | No location: `frame` the walk's start and end, at least 300 m |
| waiting / boarding | `frame` you (or the stop) and the vehicle coming, at least 400 m | Not live yet: you and the stop |
| onboard | `follow` the vehicle, 700 m across | No live position: `frame` the ride's two ends and you, at least 800 m |

Trip tracker: `follow` the vehicle at 700 m; with no live position, `frame` all the trip's stops,
at least 800 m.

### Rules

- **Following** is on to start. Any pan, pinch or rotate by you turns it off (a move counts as
  yours when a finger was on the map, or lifted under 1.5 s ago). The app's own moves are ignored
  for 1.2 s so they don't read as gestures. The location button shows filled while following.
- **Recentre** (the location button) turns following back on and re-applies the mode. If you'd
  moved the map, a follow keeps your zoom; a second tap with no gesture between goes back to the
  mode's own zoom.
- The camera only moves for real changes:
  - **follow**: when the target moves more than 3 m. Only the centre moves (your pinch zoom
    stays), except when following starts.
  - **frame**: when a point goes outside the clear area, or the points bunch up to under 55% of
    the last frame (e.g. the bus has nearly reached you). Not while an earlier move is still
    settling.
  - **fitAll**: once per route.
  - Any mode starts over when the mode changes (e.g. walking → waiting), 3D is toggled, or the
    clear area changes size (a banner came or went).
- **Clear area**: the map is padded so things centre between the top bar (safe area + 70 pt, plus
  76 pt for a banner) and the drawer (peek height, 380 pt, or half the screen, by drawer stop). Frames add 40 pt more on each side, fitAll 30 pt.
- **3D**: a follow is a chase cam: pitch 62°, facing the vehicle's bearing, zoom 16.5 when it
  starts. A frame tilts to 45° after fitting. Going back to 2D flattens (pitch 0, north up) before
  fitting.

All map engines take padding from the screen edge. iOS (react-native-maps) adds its own `mapPadding`
inside `fitToCoordinates`, so `transit-map.ios.tsx` subtracts it.

---

## Map lines and markers

`journeyLines` (`components/journey.tsx`):

| Line | Style |
| --- | --- |
| Walk | Grey (`#9CA3AF`) dots |
| Ride | Route colour, solid |
| Active ride (tracker) | The vehicle's **whole route** (`map/geojson/shapes?tripId=`): route colour between your stops, grey at 60% and 1 pt thinner before you board and after you get off (iOS `splitRide`). Grey parts are drawn under the coloured ones. |

The **active ride** is the ride you're on, or the next one from the leg you're on (`activeRide`).
Without its shape (still loading, or offline with an older pack), the plan's own line is drawn.

Markers: only the vehicle for the active ride (iOS `activeRideVehicle`), in its route colour. Your
own position is the map's user dot.

---

## Alerts and the Lock Screen

### Local reminders

`moments.ts` schedules these as local notifications from the latest times on every tick, so they
fire in the background and offline. Times are rounded to the minute so feed wobble doesn't
reschedule them. They're cancelled on arrival or End. Tapping one opens the tracker.

| Key | When | Title |
| --- | --- | --- |
| `leave:ready` | 5 min before you need to leave (first leg is a walk to a ride, not set off yet) | Get ready to leave |
| `leave:now` | 30 s before you need to leave | Time to leave |
| `<trip>:board-soon` | 3 min before each ride leaves (not the one you're on) | The 75 is due in 3 min |
| `<trip>:alight-soon` | 2 min before each ride reaches your stop | Your stop is coming up |

The in-app moment banners are separate (see [Banners](#banners-over-the-map-under-the-top-bar)).

### Live Activity / live notification

`live-surface.ts` (iOS `LiveActivityCoordinator`). iOS: one Live Activity per journey. Its push
token is registered with the server, so the server keeps it current while the app is suspended.
Android: an ongoing notification. Both show the tick's `content` and the destination label. They
end 90 s after arrival, or on End.

**Two writers, one at a time.** The app and the server (a cron every 20 s) can both update the Live
Activity. The server leaves the content alone while the app has reported in within the last 100 s
(`clientActiveWindow`), and only sends its alerts ("Get on the 75 now", "Time to leave"). So the app
reports (`live-activities/leg`: leg, phase and `leftAt`) on every change and at least every 25 s
while online. If the app stops (killed, or no GPS fixes in the background), the server takes over.

**Steady countdown.** The countdown is a seconds timer, so every change shows:

| Rule | Value |
| --- | --- |
| A countdown that moves less than this, same leg and stage, keeps its time | 30 s |
| Phase, leg, stops away, offline or status changed | sent at once |
| Anything else changed (a countdown drifting) | at most every 15 s |
| Nothing changed | re-sent every 3 min, so it never goes stale |
| Alerts | always sent |

`leftAt` is when you set off (unix s), 0 while GPS still has you at the start (first leg a walk and a
fix from the last 2 min), or missing when the app can't tell. The server uses it to stop talking
about leaving once you've gone.

---

## GPS

`journey-location.ts` runs journey GPS with the screen off ("While Using" permission; iOS shows the
blue pill, Android a foreground-service notification "Following your journey"). Each tick picks a
mode with `gpsMode` (iOS `JourneyGPSPolicy`):

| Mode | When | Accuracy / distance filter |
| --- | --- | --- |
| `precise` | The app is open; or boarding / on board when nothing cheaper applies | Best for navigation / every fix, every 2 s |
| `resting` | In the background, on a live-tracked ride with fresh data, more than 3 stops and 5 min from getting off | Lowest / 500 m |
| `coarse` | In the background, not set off yet, more than 10 min before you need to leave | Balanced / 50 m |
| `pedestrian` | In the background, walking or waiting | High / 10 m, fitness activity |

GPS never pauses itself, because once paused in the background iOS only resumes it when the app is
opened. The mode table is what saves battery.

---

## Offline

When tracking starts, `saveJourneyPack` saves the plan, each ride's stops and each ride's route
shape. It saves again if any stops are missing. After a relaunch with no signal, the pack is put
back into the query cache, so the tracker opens and keeps going:

- rides are placed from GPS (`From GPS`) with their stop times re-estimated
- reminders keep firing (they're local)
- the status row shows **Offline**; before the first ride, **Saved offline** tells you it's ready
- the greyed route still draws from the saved shapes (packs from before shapes were added draw the
  plan's line)

---

## Constants

| Value | Where |
| --- | --- |
| Live poll 10 s; tick 5 s; "Updating" after 45 s | `journey-session.ts`, `journey-status.ts` |
| Resume grace 45 min after arrival; Lock Screen grace 90 s | `journey-runner.tsx` |
| At stop 40 m in / 120 m out; boarding window 90 s; bus near-stop 350 m; overdue skip 5 min; alight grace 3 min; left vehicle 10 m | `JourneyProgressModel` |
| Set off: within 100 m of the start, then 150 m away; ignore fixes worse than 100 m | `DepartureDetector` |
| GPS boarding: 150 m past at 4.5 m/s; with the vehicle at your stop 50 m past at 2.5 m/s, within 50 m of the route; two fixes | `OfflineRideEstimator` |
| Live Activity: countdown held under 30 s; minor updates every 15 s; resend 3 min; report every 25 s (server stands back for 100 s) | `live-surface.ts`, backend `clientActiveWindow` |
| Camera: follow 700 m (vehicle) / 350 m (you); frame min 400 / 300 / 800 m; hold 1.2 s; follow moves at 3 m; bunching 55%; 3D pitch 62° follow / 45° frame | `tracker-camera.ts` |
| Map clear area: top safe area + 70 (+76 banner); bottom by drawer stop; frame +40; fitAll +30 | tracker screen, `tracker-camera.ts` |
| Drawer stops: peek (handle 24 + 8 + hero + 16), 40%, 90%; map cover peek / 380 / half screen | tracker screen |
| Moment banner 8 s | tracker screen |
| Reminders: get ready 5 min; leave 30 s; board 3 min; alight 2 min | `upcomingMoments` |
| Ranking: +10 min per change, +15 min per km walked; arrive-by prefers 5 min spare | `easy-planner.ts` |
| Results stay fresh 60 s; live trip badges every 30 s | `planner.tsx`, `plans.ts` |
