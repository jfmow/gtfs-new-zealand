import { forwardRef, useImperativeHandle, useRef } from "react"
import { Dimensions, StyleSheet, useColorScheme, View } from "react-native"
import MapView, { Marker, Polyline, type Region } from "react-native-maps"
import type { Coordinate } from "@transit/shared/models"
import { useSettings } from "@/lib/saved"
import { spanForZoom, zoomForSpan, type Bounds, type MapCamera, type TransitMapProps } from "./map-types"
import { MarkerBody } from "./marker-body"

export * from "./map-types"

/**
 * iOS: the real Apple map (MapKit, via react-native-maps) - the same map the
 * SwiftUI app shows. Lines and markers come in as data (`map-types.ts`).
 *
 * MapKit's camera speaks altitude, not zoom; zoom here is converted from the
 * visible longitude span, and zoom changes scale the current altitude.
 */
export const TransitMap = forwardRef<MapCamera, TransitMapProps>(function TransitMap(
    { center, zoom = 14, pitch = 0, threeD, showUser = true, interactive = true, padding, bounds, lines = [], markers = [], onPress, onRegionDidChange, onLoaded },
    ref,
) {
    const map = useRef<MapView>(null)
    const system = useColorScheme()
    const [settings] = useSettings()
    const scheme = settings.mapStyle === "auto" ? system ?? "light" : settings.mapStyle
    const size = useRef({ width: Dimensions.get("window").width, height: Dimensions.get("window").height })
    const lastZoom = useRef(zoom)
    // react-native-maps' Apple map never fills in `isGesture` (only Google's
    // does), so a move counts as the rider's when a finger was on the map.
    const touch = useRef({ down: false, lastUp: 0 })
    const pad = { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 }

    const regionFor = (c: Coordinate, z: number): Region => {
        const lonDelta = spanForZoom(z, size.current.width)
        const latDelta = lonDelta * (size.current.height / size.current.width) * Math.cos((c.lat * Math.PI) / 180)
        return {
            latitude: Math.max(-90, Math.min(90, c.lat)),
            longitude: Math.max(-180, Math.min(180, c.lon)),
            latitudeDelta: Math.min(179, Math.max(0.004, latDelta)),
            longitudeDelta: Math.min(179, Math.max(0.004, lonDelta)),
        }
    }
    const regionOfBounds = (b: Bounds): Region => {
        const longitudeDelta = Math.min(179, Math.max(0.004, (b[2] - b[0]) * 1.3))
        const latitudeDelta = Math.min(179, Math.max(0.004, (b[3] - b[1]) * 1.3))
        return {
            latitude: Math.max(-90, Math.min(90, (b[1] + b[3]) / 2)),
            longitude: Math.max(-180, Math.min(180, (b[0] + b[2]) / 2)),
            latitudeDelta,
            longitudeDelta,
        }
    }

    const move = async (o: { center?: [number, number]; zoom?: number; pitch?: number; duration?: number }) => {
        const m = map.current
        if (!m) return
        const cam = await m.getCamera().catch(() => null)
        const altitude = cam?.altitude && o.zoom !== undefined ? cam.altitude * 2 ** (lastZoom.current - o.zoom) : cam?.altitude
        m.animateCamera(
            {
                ...(o.center ? { center: { latitude: o.center[1], longitude: o.center[0] } } : {}),
                ...(altitude ? { altitude } : {}),
                ...(o.pitch !== undefined ? { pitch: o.pitch } : {}),
            },
            { duration: o.duration ?? 400 },
        )
        if (o.zoom !== undefined) lastZoom.current = o.zoom
    }

    useImperativeHandle(ref, () => ({
        easeTo: (o) => { void move(o) },
        flyTo: (o) => { void move(o) },
        fitBounds: (b, o) => {
            map.current?.fitToCoordinates(
                [{ latitude: b[1], longitude: b[0] }, { latitude: b[3], longitude: b[2] }],
                { edgePadding: o?.padding ?? { top: 40, bottom: 40, left: 40, right: 40 }, animated: (o?.duration ?? 0) > 0 },
            )
        },
    }))

    return (
        <View
            style={StyleSheet.absoluteFill}
            onTouchStart={() => { touch.current.down = true }}
            onTouchEnd={() => { touch.current = { down: false, lastUp: Date.now() } }}
            onTouchCancel={() => { touch.current = { down: false, lastUp: Date.now() } }}
        >
        <MapView
            ref={map}
            style={StyleSheet.absoluteFill}
            initialRegion={bounds ? regionOfBounds(bounds) : regionFor(center, zoom)}
            mapPadding={pad}
            userInterfaceStyle={scheme === "dark" ? "dark" : "light"}
            showsUserLocation={showUser}
            showsBuildings
            showsCompass={interactive}
            showsScale={false}
            pitchEnabled={interactive}
            rotateEnabled={interactive}
            scrollEnabled={interactive}
            zoomEnabled={interactive}
            onLayout={(e) => { size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height } }}
            onMapReady={() => {
                if (pitch || threeD) void move({ pitch: pitch || 60, duration: 0 })
                if (bounds) map.current?.fitToCoordinates([{ latitude: bounds[1], longitude: bounds[0] }, { latitude: bounds[3], longitude: bounds[2] }], { edgePadding: { top: pad.top || 40, bottom: pad.bottom || 40, left: pad.left || 40, right: pad.right || 40 }, animated: false })
                onLoaded?.()
            }}
            onPress={onPress ? () => onPress() : undefined}
            onRegionChangeComplete={(r, details) => {
                const z = zoomForSpan(r.longitudeDelta, size.current.width)
                lastZoom.current = z
                onRegionDidChange?.(
                    { lat: r.latitude, lon: r.longitude },
                    z,
                    [r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2],
                    // Momentum after a flick ends shortly after the finger lifts.
                    !!details?.isGesture || touch.current.down || Date.now() - touch.current.lastUp < 1500,
                )
            }}
        >
            {lines.map((l) =>
                l.coords.length > 1 ? (
                    <Polyline
                        key={l.id}
                        coordinates={l.coords.map((c) => ({ latitude: c.lat, longitude: c.lon }))}
                        strokeColor={l.color}
                        strokeWidth={l.width ?? (l.dashed ? 4 : 5)}
                        lineCap="round"
                        lineJoin="round"
                        lineDashPattern={l.dashed ? [1, 8] : undefined}
                    />
                ) : null,
            )}
            {markers.map((m) => (
                <Marker
                    key={m.id}
                    identifier={m.id}
                    coordinate={{ latitude: m.coordinate.lat, longitude: m.coordinate.lon }}
                    anchor={{ x: 0.5, y: m.anchor === "bottom" ? 1 : 0.5 }}
                    onPress={m.onPress ? (e) => { e.stopPropagation?.(); m.onPress!() } : undefined}
                    accessibilityLabel={m.accessibilityLabel}
                    zIndex={m.zIndex}
                    tracksViewChanges={false}
                >
                    <MarkerBody view={m.view} />
                </Marker>
            ))}
        </MapView>
        </View>
    )
})
