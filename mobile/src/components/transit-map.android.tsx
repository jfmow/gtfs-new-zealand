import { useQuery } from "@tanstack/react-query"
import { forwardRef, useImperativeHandle, useRef } from "react"
import { StyleSheet, useColorScheme, View } from "react-native"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import AppleMapWeb, { type AppleMapWebCamera, type CameraCommand, type WebMarker } from "./apple-map-web"
import { MapLibreMap } from "./maplibre-map"
import type { MapCamera, MapMarker, TransitMapProps } from "./map-types"

export * from "./map-types"

/**
 * Android: Apple Maps through MapKit JS (`apple-map-web.tsx`), to match the
 * iOS app's MapKit map. Tokens come from the backend (`GET /mapkit/token`,
 * signed with the MapKit key - Apple's unrestricted dashboard tokens last only
 * 7 days, and the web view has no origin for a domain-restricted one). When
 * the server has no MapKit key, MapLibre.
 */
async function fetchToken(regionUrl: string): Promise<string> {
    // The token endpoint sits at the server root, beside the region paths (/at, /wel...).
    const root = regionUrl.replace(/\/+$/, "").replace(/\/[^/]+$/, "")
    const res = await fetch(`${root}/mapkit/token`)
    if (!res.ok) throw new Error(`MapKit token: ${res.status}`)
    const body = (await res.json()) as { token?: string }
    if (!body.token) throw new Error("MapKit token: empty")
    return body.token
}

function useMapKitAvailable() {
    const { region, ready } = useRegion()
    const q = useQuery({ queryKey: ["mapkit-token", region.url], queryFn: () => fetchToken(region.url), enabled: ready, staleTime: 20 * 60_000, retry: 1 })
    return { available: q.isSuccess, deciding: q.isLoading, regionUrl: region.url }
}

export const TransitMap = forwardRef<MapCamera, TransitMapProps>(function TransitMap(props, ref) {
    const { available, deciding, regionUrl } = useMapKitAvailable()
    if (deciding) return <View style={StyleSheet.absoluteFill} />
    if (!available) return <MapLibreMap ref={ref} {...props} />
    return <AppleMapAndroid ref={ref} regionUrl={regionUrl} {...props} />
})

const AppleMapAndroid = forwardRef<MapCamera, TransitMapProps & { regionUrl: string }>(function AppleMapAndroid(
    { regionUrl, center, zoom = 14, showUser = true, interactive = true, padding, bounds, lines = [], markers = [], onPress, onRegionDidChange, onLoaded },
    ref,
) {
    const web = useRef<AppleMapWebCamera>(null)
    const system = useColorScheme()
    const [settings] = useSettings()
    const dark = (settings.mapStyle === "auto" ? system : settings.mapStyle) === "dark"
    // The web view has no location permission - the rider's position comes from the app, drawn as a dot.
    const here = coordinateOf(useUserLocation(false))
    const pad = { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0, right: padding?.right ?? 0 }
    const byId = new Map<string, MapMarker>(markers.map((m) => [m.id, m]))

    const send = (cmd: CameraCommand) => web.current?.run(cmd as never)
    useImperativeHandle(ref, () => ({
        easeTo: (o) => send({ op: "easeTo", lon: o.center?.[0] ?? null, lat: o.center?.[1] ?? null, zoom: o.zoom ?? null, animated: (o.duration ?? 400) > 0 }),
        flyTo: (o) => send({ op: "easeTo", lon: o.center?.[0] ?? null, lat: o.center?.[1] ?? null, zoom: o.zoom ?? null, animated: (o.duration ?? 400) > 0 }),
        fitBounds: (b, o) => {
            const p = o?.padding ?? { top: 40, bottom: 40, left: 40, right: 40 }
            send({ op: "fitBounds", bounds: b, ...p })
        },
    }))

    const webMarkers: WebMarker[] = markers.map((m) => ({
        id: m.id, lat: m.coordinate.lat, lon: m.coordinate.lon, view: m.view, anchor: m.anchor, label: m.accessibilityLabel, tappable: !!m.onPress, zIndex: m.zIndex,
    }))
    if (showUser && here) webMarkers.push({ id: "__user", lat: here.lat, lon: here.lon, view: { type: "dot", size: 18, fill: "#0A84FF", stroke: "#fff", strokeWidth: 3 }, zIndex: 10 })

    return (
        <View style={StyleSheet.absoluteFill}>
            <AppleMapWeb
                ref={web}
                getToken={() => fetchToken(regionUrl)}
                center={center}
                zoom={zoom}
                bounds={bounds ?? null}
                padding={pad}
                interactive={interactive}
                dark={dark}
                lines={lines}
                markers={webMarkers}
                onRegion={async (c, z, b, byUser) => onRegionDidChange?.(c, z, b, byUser)}
                onMapPress={async () => onPress?.()}
                onMarkerPress={async (id) => byId.get(id)?.onPress?.()}
                onReady={async () => onLoaded?.()}
                dom={{ style: { flex: 1 }, scrollEnabled: false, bounces: false }}
            />
        </View>
    )
})
