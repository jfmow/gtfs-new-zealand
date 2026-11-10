import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { ListFilter, LocateFixed, Settings as Gear } from "@/components/icons"
import { useEffect, useMemo, useRef, useState } from "react"
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { boardQuery } from "@transit/shared/models"
import { hasRealtime } from "@transit/shared/regions"
import { PANEL_TOP, panelInset } from "@/components/map-drawer"
import { StopBoardView } from "@/components/stop-board"
import { buildIndex, clusterMarker, clustersIn, stopMarker, vehicleMarker, type Bounds, type StopPoint, type VehiclePoint } from "@/components/map-markers"
import { TransitMap, lngLat, type MapCamera } from "@/components/transit-map"
import { GlassButton } from "@/components/ui"
import { api } from "@/lib/api"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { useLayout } from "@/lib/layout"
import { useMapFilter } from "@/lib/map-filter"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { radius, spacing, type, useColors } from "@/theme"

type Mode = "stops" | "vehicles"

/** Stops and vehicles on one full-height map (iOS 2026-11-03): glass toggle, filter + settings, 3D + locate. */
export default function MapTab() {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { region, ready } = useRegion()
    const realtime = hasRealtime(region)
    const [mode, setMode] = useState<Mode>("stops")
    const [filter, setFilter] = useMapFilter()
    const camera = useRef<MapCamera>(null)
    const here = coordinateOf(useUserLocation())
    const start = here ?? { lat: region.defaultMapCenter[0], lon: region.defaultMapCenter[1] }
    const [view, setView] = useState<{ bounds: Bounds; zoom: number } | null>(null)
    // Wide windows: a stop's board opens in a side panel over the map (iOS
    // `MapSidePanel`) instead of covering it. Phones push the board screen.
    const layout = useLayout()
    const [board, setBoard] = useState<string | null>(null)
    const panelOpen = layout.wide && !!board
    const openStop = (query: string) => (layout.wide ? setBoard(query) : router.push({ pathname: "/stop/[query]", params: { query } }))

    const showStops = mode === "stops" || filter.showStops
    const stops = useQuery({
        queryKey: ["map-stops", region.url, filter.kind],
        queryFn: async () => (await unwrap(api.stops({ children: false, type: filter.kind }))) ?? [],
        enabled: ready && showStops,
        staleTime: 10 * 60_000,
    })
    const vehicles = useQuery({
        queryKey: ["map-vehicles", region.url, filter.kind],
        queryFn: async () => (await unwrap(api.liveVehicles({ type: filter.kind === "all" ? "all" : ((filter.kind[0].toUpperCase() + filter.kind.slice(1)) as "Bus" | "Train" | "Ferry") }))) ?? [],
        enabled: ready && mode === "vehicles" && realtime,
        refetchInterval: 15_000,
    })

    const stopIndex = useMemo(
        () => buildIndex<StopPoint>((stops.data ?? []).map((s) => ({ kind: "stop", id: s.stop_id, query: boardQuery(s), name: s.stop_name, type: s.stop_type, lat: s.stop_lat, lon: s.stop_lon }))),
        [stops.data],
    )
    const routeKey = filter.routes.map((r) => r.id).join(",")
    const vehicleIndex = useMemo(() => {
        const only = new Set(routeKey ? routeKey.split(",") : [])
        return buildIndex<VehiclePoint>(
            (vehicles.data ?? [])
                .filter((v) => only.size === 0 || only.has(v.route.id))
                .map((v) => ({ kind: "vehicle", id: v.trip_id, label: v.route.name, color: v.route.color, type: v.type, bearing: v.position.bearing, lat: v.position.lat, lon: v.position.lon })),
            50,
        )
    }, [vehicles.data, routeKey])

    const bounds: Bounds = view?.bounds ?? [start.lon - 0.03, start.lat - 0.03, start.lon + 0.03, start.lat + 0.03]
    const zoom = view?.zoom ?? 14
    // A cluster tap zooms in - via state, so the markers (built during render) never touch the camera ref.
    const [zoomTarget, setZoomTarget] = useState<{ lat: number; lon: number; zoom: number } | null>(null)
    useEffect(() => {
        if (zoomTarget) camera.current?.easeTo({ center: [zoomTarget.lon, zoomTarget.lat], zoom: zoomTarget.zoom, duration: 350 })
    }, [zoomTarget])
    const zoomInto = (lat: number, lon: number) => setZoomTarget({ lat, lon, zoom: Math.min(17, zoom + 2) })
    const stopItems = showStops ? clustersIn(stopIndex, bounds, zoom) : []
    const vehicleItems = mode === "vehicles" ? clustersIn(vehicleIndex, bounds, zoom) : []

    const openFilter = () => {
        const kinds: { label: string; kind: typeof filter.kind }[] = [
            { label: "All transport", kind: "all" }, { label: "Bus", kind: "bus" }, { label: "Train", kind: "train" }, { label: "Ferry", kind: "ferry" },
        ]
        const options: { label: string; run: () => void }[] = kinds.map((k) => ({ label: `${filter.kind === k.kind ? "✓ " : ""}${k.label}`, run: () => setFilter({ kind: k.kind }) }))
        if (mode === "vehicles") {
            options.push({ label: "Find a route…", run: () => router.push("/route-filter") })
            if (filter.routes.length) options.push({ label: "Show all routes", run: () => setFilter({ routes: [] }) })
            options.push({ label: filter.showStops ? "Hide stops" : "Show stops", run: () => setFilter({ showStops: !filter.showStops }) })
        }
        if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length }, (i) => options[i]?.run())
        else Alert.alert("Filter", undefined, [...options.map((o) => ({ text: o.label, onPress: o.run })), { text: "Cancel", style: "cancel" as const }])
    }

    const toggle3D = () => {
        const next = !filter.threeD
        setFilter({ threeD: next })
        const center = view ? { lat: (bounds[1] + bounds[3]) / 2, lon: (bounds[0] + bounds[2]) / 2 } : start
        camera.current?.easeTo({ center: lngLat(center), zoom: next ? Math.max(zoom, 16) : zoom, pitch: next ? 60 : 0, duration: 500 })
    }

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <TransitMap
                ref={camera}
                center={start}
                zoom={here ? 15 : 13}
                threeD={filter.threeD}
                padding={panelOpen ? { top: 0, bottom: 0, left: panelInset(layout.panelWidth, insets.left), right: 0 } : undefined}
                onRegionDidChange={(_c, z, b) => setView({ bounds: b, zoom: z })}
                markers={[
                    ...stopItems.map((item) =>
                        item.kind === "cluster"
                            ? clusterMarker(item, "sc", colors.primary, () => zoomInto(item.lat, item.lon))
                            : stopMarker(item, () => openStop(item.query))),
                    ...vehicleItems.map((item) =>
                        item.kind === "cluster"
                            ? clusterMarker(item, "vc", colors.primary, () => zoomInto(item.lat, item.lon))
                            : vehicleMarker(item, () => router.push({ pathname: "/trip/[tripId]", params: { tripId: item.id } }))),
                ]}
            />

            <View style={[styles.top, { top: insets.top + spacing.sm }]}>
                <View style={[styles.toggle, { backgroundColor: colors.card + "EE", borderColor: colors.border }]} accessibilityRole="tablist">
                    {(realtime ? (["stops", "vehicles"] as Mode[]) : (["stops"] as Mode[])).map((m) => (
                        <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)} style={[styles.toggleItem, mode === m && { backgroundColor: colors.primary }]}>
                            <Text style={[type.bodyMedium, { fontSize: 14, color: mode === m ? colors.primaryForeground : colors.foreground }]}>{m === "stops" ? "Stops" : "Vehicles"}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                    <GlassButton icon={ListFilter} label={mode === "vehicles" ? "Filter vehicles" : "Filter stops"} onPress={openFilter} active={filter.kind !== "all" || filter.routes.length > 0} size={40} />
                    <GlassButton icon={Gear} label="Settings" onPress={() => router.push("/settings")} size={40} />
                </View>
            </View>

            {mode === "vehicles" && (vehicles.error || filter.routes.length > 0 || (vehicles.data && vehicleItems.length === 0)) ? (
                <View style={[styles.notice, { top: insets.top + 70, backgroundColor: colors.card + "F2", borderColor: colors.border }, panelOpen && { left: panelInset(layout.panelWidth, insets.left) + spacing.lg }]}>
                    <Text style={[type.meta, { color: colors.foreground }]}>
                        {vehicles.error
                            ? `Live vehicles unavailable: ${(vehicles.error as Error).message}`
                            : filter.routes.length > 0 && vehicleItems.length === 0
                                ? "None of these routes are running right now"
                                : filter.routes.length > 0 ? `Showing ${filter.routes.map((r) => r.name).join(", ")}` : "No vehicles here right now"}
                    </Text>
                </View>
            ) : null}

            {panelOpen ? (
                <View style={[styles.panel, { top: insets.top + PANEL_TOP, bottom: insets.bottom + spacing.lg, left: insets.left + spacing.lg, width: layout.panelWidth, backgroundColor: colors.background, borderColor: colors.border }]}>
                    <StopBoardView key={board} query={board!} embedded onClose={() => setBoard(null)} />
                </View>
            ) : null}

            <View style={[styles.bottomRight, { bottom: 110 }]}>
                <GlassButton label={filter.threeD ? "Flat map" : "3D map"} onPress={toggle3D} size={44} active={filter.threeD}>
                    <Text style={[type.cardTitle, { color: filter.threeD ? colors.primaryForeground : colors.foreground }]}>3D</Text>
                </GlassButton>
                <GlassButton icon={LocateFixed} label="Go to my location" onPress={() => here && camera.current?.flyTo({ center: lngLat(here), zoom: 15, duration: 600 })} size={44} />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    top: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    toggle: { flexDirection: "row", borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 3 },
    toggleItem: { paddingHorizontal: 14, minHeight: 32, justifyContent: "center", borderRadius: 16 },
    notice: { position: "absolute", left: spacing.lg, right: spacing.lg, padding: spacing.sm + 2, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
    panel: { position: "absolute", borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", paddingTop: spacing.sm },
    bottomRight: { position: "absolute", right: spacing.lg, gap: spacing.md },
})
