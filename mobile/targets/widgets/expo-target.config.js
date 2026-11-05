/**
 * The iOS widget extension: the departures widget and the journey Live
 * Activity (Lock Screen + Dynamic Island), in SwiftUI - moved from
 * ios/TransitWidgets. Built by @bacons/apple-targets during prebuild.
 * The app group is shared with the app (SharedStore / modules/transit-native).
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
    type: "widget",
    name: "TransitWidgets",
    // The app's id + this: dev.suddsy.transit.TransitWidgets in store builds,
    // the SwiftUI app's widget id, so it carries over as an update.
    bundleIdentifier: process.env.APP_VARIANT === "production" ? ".TransitWidgets" : ".widget",
    deploymentTarget: "17.2",
    frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
    entitlements: {
        "com.apple.security.application-groups": ["group.dev.suddsy.transit"],
    },
})
