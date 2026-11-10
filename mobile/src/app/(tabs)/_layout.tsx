import { NativeTabs } from "expo-router/native-tabs"
import { hasRealtime } from "@transit/shared/regions"
import { useRegion } from "@/lib/region"
import { useColors } from "@/theme"

/** The four tabs, as on iOS: Home, Planner, Map, Updates - filled symbols, as the SwiftUI tab bar draws them. Settings opens from the gear on each tab. */
export default function TabLayout() {
    const colors = useColors()
    const { region } = useRegion()

    return (
        <NativeTabs backgroundColor={colors.card} tintColor={colors.primary} indicatorColor={colors.muted} labelStyle={{ selected: { color: colors.foreground } }}>
            <NativeTabs.Trigger name="index">
                <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="planner">
                <NativeTabs.Trigger.Label>Planner</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="point.topleft.down.to.point.bottomright.curvepath" md="route" />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="map">
                <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="map.fill" md="map" />
            </NativeTabs.Trigger>
            {/* Otago publishes no realtime, so there are no service alerts to show. */}
            <NativeTabs.Trigger name="updates" hidden={!hasRealtime(region)}>
                <NativeTabs.Trigger.Label>Updates</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon sf="bell.fill" md="notifications" />
            </NativeTabs.Trigger>
        </NativeTabs>
    )
}
