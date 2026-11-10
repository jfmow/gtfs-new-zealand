import type { ConfigContext, ExpoConfig } from "expo/config"

/**
 * Build variants on top of app.json.
 *
 * - production (EAS `production` / `preview` profiles): ships as the existing
 *   App Store app - bundle id dev.suddsy.transit, widget
 *   dev.suddsy.transit.TransitWidgets (the SwiftUI app's ids, so it installs
 *   as an update), scheme `transit`.
 * - development (default for local `expo run` and the EAS `development`
 *   profile): dev.suddsy.transit.expo and scheme `transit-expo`, so a dev
 *   build sits beside the store app on the same phone.
 *
 * Android the same way: production is dev.suddsy.transit (the Play Store
 * listing - Play fixes a package name for good), development
 * dev.suddsy.transit.android. google-services.json needs a client for each.
 */
const VARIANT = process.env.APP_VARIANT === "production" ? "production" : "development"
const IOS_ID = VARIANT === "production" ? "dev.suddsy.transit" : "dev.suddsy.transit.expo"
const ANDROID_ID = VARIANT === "production" ? "dev.suddsy.transit" : "dev.suddsy.transit.android"
const WIDGET_ID = VARIANT === "production" ? "dev.suddsy.transit.TransitWidgets" : "dev.suddsy.transit.expo.widget"
const uniq = <T,>(xs: T[] | undefined) => (xs ? [...new Set(xs)] : xs)

export default ({ config }: ConfigContext): ExpoConfig => {
    const ios = config.ios ?? {}
    const extensions = [{ bundleIdentifier: WIDGET_ID, targetName: "TransitWidgets", entitlements: { "com.apple.security.application-groups": ["group.dev.suddsy.transit"] } }]
    return {
        ...config,
        name: VARIANT === "production" ? "Transit" : "Transit Dev",
        slug: config.slug ?? "transit",
        scheme: VARIANT === "production" ? "transit" : "transit-expo",
        ios: {
            ...ios,
            bundleIdentifier: IOS_ID,
            associatedDomains: uniq(ios.associatedDomains),
            infoPlist: { ...ios.infoPlist, UIBackgroundModes: uniq(ios.infoPlist?.UIBackgroundModes as string[] | undefined) },
            entitlements: {
                ...ios.entitlements,
                "com.apple.security.application-groups": ["group.dev.suddsy.transit"],
                // iCloud key-value store: saved stops, places and trips sync (src/lib/cloud-sync.ts).
                // The container isn't used, but EAS only turns on the App ID's iCloud
                // capability (and puts it in the provisioning profile) when one is
                // listed - same three entitlements as the SwiftUI app had.
                "com.apple.developer.ubiquity-kvstore-identifier": "$(TeamIdentifierPrefix)$(CFBundleIdentifier)",
                "com.apple.developer.icloud-container-identifiers": ["iCloud.dev.suddsy.transit"],
                "com.apple.developer.icloud-services": ["CloudKit"],
            },
        },
        android: {
            ...config.android,
            package: ANDROID_ID,
            permissions: uniq(config.android?.permissions),
            // Not committed: EAS builds get it from the GOOGLE_SERVICES_JSON file env var,
            // local builds read mobile/google-services.json.
            googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
        },
        extra: {
            ...config.extra,
            appVariant: VARIANT,
            eas: { ...config.extra?.eas, build: { experimental: { ios: { appExtensions: extensions } } } },
        },
    }
}
