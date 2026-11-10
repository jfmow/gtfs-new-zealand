import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { MapPin, Navigation2 } from "./icons"
import { MODE_COLORS, type MarkerView } from "./map-types"
import { ModeIcon, hexColor, textOn } from "./ui"

/**
 * A marker drawn as a native view - for Apple MapKit on iOS and MapLibre.
 * Matches the iOS app's `MapAnnotations`: dark cluster balloons, mode-icon
 * stops, route-coloured vehicle tags.
 */
export const MarkerBody = memo(function MarkerBody({ view, mapHeading = 0 }: { view: MarkerView; /** Which way the map is turned (degrees) - pointers stay true to north. */ mapHeading?: number }) {
    switch (view.type) {
        case "cluster":
            return (
                <View style={styles.pinWrap}>
                    <View style={[styles.pin, { backgroundColor: view.color }]}>
                        <Text style={[styles.count, view.count > 99 && { fontSize: 11 }]}>{view.count}</Text>
                    </View>
                    <View style={[styles.pointer, { borderTopColor: view.color }]} />
                </View>
            )
        case "stop": {
            const bg = view.mode === "train" ? MODE_COLORS.train : view.mode === "ferry" ? MODE_COLORS.ferry : MODE_COLORS.bus
            return <View style={[styles.stop, { backgroundColor: bg }]}><ModeIcon mode={view.mode} size={14} color="#fff" /></View>
        }
        case "vehicleTag": {
            const bg = hexColor(view.color, "#0D1A12")
            const fg = textOn(bg)
            return (
                <View style={[styles.tag, { backgroundColor: bg }]}>
                    {view.bearing ? <Navigation2 size={11} color={fg} style={{ transform: [{ rotate: `${view.bearing}deg` }] }} /> : <ModeIcon mode={view.mode} size={12} color={fg} />}
                    <Text style={[styles.tagLabel, { color: fg }]} numberOfLines={1}>{view.label}</Text>
                </View>
            )
        }
        case "vehicle":
            // iOS `VehicleMarkerView`: the badge stays upright; a pointer in the
            // badge's colour rides round its edge, turned to the bearing.
            return (
                <View style={styles.vehicleWrap}>
                    {view.bearing && view.bearing > 0 ? (
                        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${view.bearing - mapHeading}deg` }] }]} pointerEvents="none">
                            <Svg width={VEHICLE_WRAP} height={VEHICLE_WRAP}>
                                <Path d={`M${VEHICLE_WRAP / 2 - 6} 9 L${VEHICLE_WRAP / 2 + 6} 9 L${VEHICLE_WRAP / 2} 1 Z`} fill={view.color} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
                            </Svg>
                        </View>
                    ) : null}
                    <View style={[styles.vehicle, { backgroundColor: view.color }]}><ModeIcon mode={view.mode} size={18} color={textOn(view.color)} /></View>
                </View>
            )
        case "dot":
            return <View style={{ width: view.size, height: view.size, borderRadius: view.size / 2, backgroundColor: view.fill, borderColor: view.stroke, borderWidth: view.strokeWidth }} />
        case "pin":
            return <MapPin size={30} color="#fff" fill={view.color} />
        case "badge":
            return <View style={[styles.badge, { backgroundColor: view.color }]}><Text style={[styles.badgeText, { color: textOn(view.color) }]}>{view.text}</Text></View>
    }
})

/** The vehicle badge (40) plus room for its pointer all round. */
const VEHICLE_WRAP = 58

const shadow = { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 }

const styles = StyleSheet.create({
    pinWrap: { alignItems: "center" },
    pin: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff", ...shadow },
    pointer: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -2 },
    count: { color: "#fff", fontFamily: "Geist-SemiBold", fontSize: 13 },
    stop: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#fff", ...shadow },
    tag: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#fff", ...shadow },
    tagLabel: { fontFamily: "Geist-Bold", fontSize: 12 },
    vehicleWrap: { width: VEHICLE_WRAP, height: VEHICLE_WRAP, alignItems: "center", justifyContent: "center" },
    vehicle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#fff", ...shadow },
    badge: { minWidth: 30, height: 22, borderRadius: 6, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
    badgeText: { fontFamily: "Geist-SemiBold", fontSize: 11 },
})
