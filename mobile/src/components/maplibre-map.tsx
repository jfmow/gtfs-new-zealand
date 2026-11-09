import { Camera, GeoJSONSource, Layer, Map, Marker, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native"
import { forwardRef, useImperativeHandle, useRef } from "react"
import { Pressable, StyleSheet, useColorScheme } from "react-native"
import type { Coordinate } from "@transit/shared/models"
import { useSettings } from "@/lib/saved"
import { lngLat, type MapCamera, type TransitMapProps } from "./map-types"
import { MarkerBody } from "./marker-body"

/**
 * MapLibre with
 * OpenFreeMap tiles - Liberty by day (blue water and green parks, the
 * closest to Apple Maps), Dark at night. Android's map when there's no
 * MapKit JS token (`transit-map.android.tsx`).
 */
const MAP_STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark",
    threeD: "https://tiles.openfreemap.org/styles/liberty",
}

const line = (coords: Coordinate[]): GeoJSON.Feature<GeoJSON.LineString> => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords.map(lngLat) }, properties: {} })

export const MapLibreMap = forwardRef<MapCamera, TransitMapProps>(function MapLibreMap(
    { center, zoom = 14, pitch = 0, threeD, showUser = true, interactive = true, padding, bounds, lines = [], markers = [], onPress, onRegionDidChange, onLoaded },
    ref,
) {
    const camera = useRef<CameraRef>(null)
    const system = useColorScheme()
    const [settings] = useSettings()
    const scheme = settings.mapStyle === "auto" ? system : settings.mapStyle
    const style = threeD ? MAP_STYLES.threeD : scheme === "dark" ? MAP_STYLES.dark : MAP_STYLES.light
    const pad = { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 }

    useImperativeHandle(ref, () => ({
        easeTo: ({ heading, ...o }) => camera.current?.easeTo({ ...o, ...(heading !== undefined ? { bearing: heading } : {}) } as never),
        flyTo: ({ heading, ...o }) => camera.current?.flyTo({ ...o, ...(heading !== undefined ? { bearing: heading } : {}) } as never),
        fitBounds: (b, o) => camera.current?.fitBounds(b, { padding: o?.padding, duration: o?.duration ?? 0 }),
    }))

    return (
        <Map
            style={StyleSheet.absoluteFill}
            mapStyle={style}
            attribution
            attributionPosition={{ bottom: 8, left: 8 }}
            logo={false}
            compass
            compassHiddenFacingNorth
            dragPan={interactive}
            touchZoom={interactive}
            doubleTapZoom={interactive}
            touchRotate={interactive}
            touchPitch={interactive}
            onPress={onPress}
            onDidFinishLoadingMap={() => {
                if (bounds) camera.current?.fitBounds(bounds, { padding: { top: pad.top || 40, bottom: pad.bottom || 40, left: pad.left || 40, right: pad.right || 40 }, duration: 0 })
                onLoaded?.()
            }}
            onRegionDidChange={(e) => {
                const s = e.nativeEvent
                onRegionDidChange?.({ lat: s.center[1], lon: s.center[0] }, s.zoom, s.bounds, s.userInteraction)
            }}
        >
            <Camera
                ref={camera}
                initialViewState={bounds ? { bounds, pitch, padding: pad } : { center: lngLat(center), zoom, pitch, padding: pad }}
            />
            {showUser ? <UserLocation /> : null}
            {threeD ? (
                <Layer
                    id="3d-buildings"
                    type="fill-extrusion"
                    source="openmaptiles"
                    source-layer="building"
                    minzoom={14}
                    paint={{ "fill-extrusion-color": "#d9e3db", "fill-extrusion-height": ["get", "render_height"], "fill-extrusion-base": ["get", "render_min_height"], "fill-extrusion-opacity": 0.7 }}
                />
            ) : null}
            {lines.map((l) =>
                l.coords.length > 1 ? (
                    // Keyed per line: a source's `id` can't change once added.
                    <GeoJSONSource key={l.id} id={`line-${l.id}`} data={line(l.coords)}>
                        <Layer
                            id={`line-${l.id}-layer`}
                            type="line"
                            paint={l.dashed ? { "line-color": l.color, "line-width": l.width ?? 4, "line-dasharray": [0.1, 2] } : { "line-color": l.color, "line-width": l.width ?? 5 }}
                            layout={{ "line-cap": "round", "line-join": "round" }}
                        />
                    </GeoJSONSource>
                ) : null,
            )}
            {markers.map((m) => (
                <Marker key={m.id} id={`m-${m.id}`} lngLat={lngLat(m.coordinate)} anchor={m.anchor === "bottom" ? "bottom" : "center"}>
                    <Pressable accessibilityRole={m.onPress ? "button" : undefined} accessibilityLabel={m.accessibilityLabel} disabled={!m.onPress} onPress={m.onPress} hitSlop={8}>
                        <MarkerBody view={m.view} />
                    </Pressable>
                </Marker>
            ))}
        </Map>
    )
})
