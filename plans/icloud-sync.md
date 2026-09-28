# iCloud sync

Status (2026-09-28): phases 0-4 built on `feat/icloud-sync` (worktree
`../gtfs-new-zealand-icloud`). Not yet done: enabling iCloud on the App ID /
creating the container, a real two-device test, CloudKit schema deploy to
production, optional synced settings.

Branch: `feat/icloud-sync` (off master, after `feat/ipad-support` lands -
iPad is where sync first matters)

## What syncs

Everything the rider deliberately *saved* is already SwiftData
(`TransitCore/Store/PersistenceModels.swift`), so this is SwiftData's
built-in CloudKit mirroring (private database), not a hand-rolled sync.

| Data | Where now | Sync? |
|---|---|---|
| `FavouriteStop` (saved stops) | SwiftData | Yes - CloudKit |
| `SavedPlace` (Home, Work...) | SwiftData | Yes - CloudKit |
| `SavedTrip` (saved journeys) | SwiftData | Yes - CloudKit |
| `ActiveJourney` | SwiftData | **No** - device-local (Live Activity id, GPS session, offline pack) |
| `RecentSearchEntry` | SwiftData, unused | Drop it from the schema (recents actually live in UserDefaults) |
| Recent searches (`LocationField`, `StopSearchField`) | UserDefaults | No |
| appearance / map style / planner style | `@AppStorage` | Optional phase 3 - `NSUbiquitousKeyValueStore` |
| Trip / leave reminders | Backend, per device push token | No - they fire on the device that set them |
| `hasOnboarded`, `dismissedResumePlanID`, notifications last-seen | UserDefaults | No |

Widgets / Siri / quick actions need nothing new: `RootView`'s
`sharedSnapshot` is built from `@Query`, which refreshes on imported remote
changes, and already rewrites the app-group copy + reloads timelines.

## Phase 0 - capability + signing

1. Developer portal: enable iCloud (CloudKit) on the `Transit` App ID,
   create container `iCloud.dev.suddsy.transit`.
2. `Transit.entitlements` (via `project.yml`):
   `com.apple.developer.icloud-container-identifiers` = [container],
   `com.apple.developer.icloud-services` = [CloudKit].
   `aps-environment` is already there (CloudKit uses silent pushes).
3. `project.yml`: `UIBackgroundModes: [location, remote-notification]` so
   changes import while the app is backgrounded.
4. Widgets target: no iCloud entitlement - it keeps reading the app group.

## Phase 1 - make the schema CloudKit-legal

CloudKit mirroring rejects the container at launch unless every attribute
is optional or has a default, and there are no `@Attribute(.unique)`s
(there aren't any today).

1. Give every stored property a default in its declaration
   (`public var stopID: String = ""`, `sortOrder: Int = 0`,
   `createdAt: Date = .now`, `startLat: Double = 0`...). Inits unchanged.
   `onlyRouteIDs` / `modes` / `onlyRouteNames` arrays are fine as-is
   (stored as transformable/binary).
2. Dedupe identity is a *computed* `dedupeKey` (no stored field to backfill
   or go stale on rename):
   - `FavouriteStop`: `stopID`
   - `SavedPlace`: `"\(regionSlug)/\(name.lowercased())"` (matches
     `SharedStore.SavedPlace.id`)
   - `SavedTrip`: name + start/end coords to 4dp
3. Delete `RecentSearchEntry` (unused - `grep` shows only the model and the
   container list).
4. Upgrade verified on a simulator: a store written by the pre-sync build
   (seeded via sqlite) opens under the new container with its data intact.

**From here on the schema is additive-only.** Once deployed to CloudKit
production, attributes can't be renamed, retyped or removed - new fields
must be optional or defaulted. Add a note to `PersistenceModels.swift`'s
header.

## Phase 2 - two stores + mirroring

`TransitApp.modelContainer` becomes two configurations:

```swift
let synced = ModelConfiguration(
    "Synced",
    schema: Schema([FavouriteStop.self, SavedPlace.self, SavedTrip.self]),
    url: <app group>/Library/Application Support/default.store, // keeps today's data
    cloudKitDatabase: .private("iCloud.dev.suddsy.transit"))
let local = ModelConfiguration(
    "Local",
    schema: Schema([ActiveJourney.self]),
    url: <Application Support/local.store>,
    cloudKitDatabase: .none)
ModelContainer(for: FavouriteStop.self, SavedPlace.self, SavedTrip.self, ActiveJourney.self,
               configurations: synced, local)
```

1. The existing store is in the **app group** container, not the app's
   own Application Support - SwiftData's default `groupContainer: .automatic`
   picks the first app group. `TransitStore.storeDirectory(appGroup:)`.
   Reusing that URL for `Synced` means current saved
   stops/places/trips are exported to iCloud on first launch, no copy step.
   The `ActiveJourney` table in that file is dropped by the migration - an
   in-flight journey at upgrade time is lost (acceptable; or copy the one
   row across before opening the new container if we care).
2. Signed-out iCloud / restricted account: mirroring just stays idle and
   everything works locally; it catches up when they sign in. No code path.
3. `#if DEBUG` launch arg (`-disableCloudSync`) → `cloudKitDatabase: .none`,
   for UI tests and the simulator's `TransitDebugUITests`.
4. Before the first TestFlight: in CloudKit Console, **Deploy Schema
   Changes** dev → production (dev builds create the schema automatically;
   release builds won't).

## Phase 3 - merge rules

CloudKit is last-writer-wins per record with no uniqueness, so two devices
that both already saved "Britomart" end up with two rows after the first
sync. Add `SyncHygiene` (TransitCore, pure logic over a `ModelContext`):

1. **Dedupe** by `syncKey`: keep the earliest `createdAt`/`savedAt`,
   delete the rest.
2. **Renumber `sortOrder`** 0..n per model (per region for places) so
   reorders from two devices don't leave ties/gaps.
3. **Caps**: saved stops max 8 (web parity) - over the cap after a merge,
   keep them all but only show the first 8, don't delete.
4. Run it on launch, on `.active`, and on
   `NSPersistentStoreRemoteChange` (debounced ~2s). Its own saves also post
   that notification - guard against re-entrancy.
5. Insert paths: stops already check `stopID`; re-saving a trip replaces
   the old copy in place (`ModelContext.replaceExistingCopy(of:)`); the
   place editor refuses a second same-named place in a region (merging would
   drop one address).
6. Onboarding on a fresh device: the "have they used the app before"
   check in `RootView.onAppear` runs before the first import lands. Wait
   briefly (import event or ~3s) before showing onboarding if iCloud is
   available, and let onboarding's place picker dedupe via `syncKey`.

Tests: `SyncHygieneTests` - duplicate stops/places/trips, tie sort orders,
cross-region places with the same name stay separate.

## Phase 4 - UI

- Settings → "iCloud" section: status from
  `CKContainer(identifier:).accountStatus()` - "Syncing saved stops, places
  and trips", "Sign in to iCloud to sync", "iCloud turned off for Transit".
  No in-app on/off toggle: the system's per-app iCloud switch is the
  control, and flipping a live container's CloudKit config is fiddly.
- Optional: last-sync time via `NSPersistentCloudKitContainer.eventChangedNotification`
  (surface errors like quota/`partialFailure` in debug builds only).
- Optional: sync appearance / map style / planner style through
  `NSUbiquitousKeyValueStore` - a small `SyncedSettings` that mirrors the
  three `@AppStorage` keys both ways. Region stays per device.

## Testing

- Two simulators (or iPhone + iPad) signed into the same sandbox Apple ID:
  add/rename/reorder/delete on each, check the other; both offline, edit,
  reconnect.
- Upgrade path: install master build, save things, install branch build -
  data intact and appears in CloudKit Console (private DB,
  `com.apple.coredata.cloudkit.zone`).
- Duplicate path: save the same stop on both devices while one is offline.
- Widget + Siri + quick actions update after a remote change with the app
  backgrounded.
- iCloud signed out / Transit's iCloud switch off: app unchanged.

## Out of scope

- Web app ↔ iOS sync (would need accounts on the backend).
- Handoff of an active journey between devices (could be `NSUserActivity`
  later, independent of this).
- Shared (family) lists via `CKShare`.
