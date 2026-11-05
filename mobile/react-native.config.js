/**
 * Autolinking overrides. react-native-maps is iOS-only here: iOS draws Apple
 * MapKit with it, Android has its own map (src/components/transit-map.tsx),
 * so Android doesn't need Google Maps compiled in.
 */
module.exports = {
    dependencies: {
        "react-native-maps": { platforms: { android: null } },
    },
}
