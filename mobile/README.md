# Transit (Expo)

One React Native app for iOS and Android. It replaced the SwiftUI app that
used to live in `../ios` (removed 2026-11-11; it is in git history). The plan and its phases are in `../plans/expo-app.md`.

Shared logic (API client, regions, formatting, planner steps, types) comes
from `../packages/shared`, the same package the web app uses.

## Run

```sh
npm install --prefix packages/shared   # once, for its tests
npm install --prefix mobile
npm run run:ios --prefix mobile        # dev build in the iOS simulator
npm run run:android --prefix mobile    # needs Java + the Android SDK
npm start --prefix mobile              # Metro only, for an installed dev build
```

This app uses native modules, so it needs a dev build (`run:ios` /
`run:android`, or EAS), not Expo Go. `ios/` and `android/` are generated
by prebuild and git-ignored: change `app.json` or a config plugin instead.

Dev regions point at `http://localhost:8090`. On the Android emulator set
`EXPO_PUBLIC_DEV_API_HOST=http://10.0.2.2:8090`.

## Checks

```sh
npm run lint --prefix mobile
npm run typecheck --prefix mobile
npm run bundle:check --prefix mobile   # Metro bundles for iOS and Android
npm test --prefix packages/shared
```
