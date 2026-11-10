import { useQuery } from "@tanstack/react-query"
import Constants from "expo-constants"
import { router } from "expo-router"
import { BellRing, Check, ChevronRight } from "@/components/icons"
import { TransitNative } from "../../modules/transit-native/src"
import { useEffect, useState } from "react"
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ADULT_ONLY, type FareType } from "@transit/shared/fares"
import { getRegionSlug, groupByCountry } from "@transit/shared/regions"
import { WALK_SPEED_OPTIONS, normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { Toggle } from "@/components/alerts"
import { Button, Card, Divider, Muted, SectionLabel, Segmented } from "@/components/ui"
import { api } from "@/lib/api"
import { useCloudSyncStatus, type CloudSyncStatus } from "@/lib/cloud-sync"
import { notificationsAllowed, requestNotifications } from "@/lib/push"
import { unwrap } from "@/lib/queries"
import { regions, useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

export default function SettingsScreen() {
    const colors = useColors()
    const { region, setRegion, ready } = useRegion()
    const slug = getRegionSlug(region)
    const [settings, update] = useSettings()
    const fareTypes = useQuery({ queryKey: ["fare-types", region.url], queryFn: async () => (await unwrap(api.fareTypes())).types ?? ADULT_ONLY, enabled: ready, staleTime: Infinity })
    const allowed = useQuery({ queryKey: ["notif-allowed"], queryFn: notificationsAllowed })
    const [testing, setTesting] = useState(false)
    const fareType = settings.fareType[slug] ?? "adult"
    const cloud = useCloudSyncStatus()

    // Back from the phone's Settings: show the switch as it is now.
    const refetchAllowed = allowed.refetch
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") refetchAllowed()
        })
        return () => subscription.remove()
    }, [refetchAllowed])

    const testPush = async () => {
        if (!(await requestNotifications())) {
            Alert.alert("Notifications are off", "Turn them on for Transit in your phone's Settings.", [{ text: "Open Settings", onPress: () => Linking.openSettings() }, { text: "OK" }])
            return
        }
        setTesting(true)
        const res = await api.sendTestNotification()
        setTesting(false)
        allowed.refetch()
        if (!res.ok) Alert.alert("Test failed", res.error)
        else if (!res.data.sent) Alert.alert("Not delivered", res.data.hasToken ? "The server couldn't reach this device." : "This device hasn't sent a push token yet - try again in a moment.")
    }

    return (
        <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content}>
            <SectionLabel>Region</SectionLabel>
            {groupByCountry(regions).map((group) => (
                <View key={group.country} style={{ marginBottom: spacing.md }}>
                    <Muted style={{ marginBottom: spacing.xs, marginLeft: spacing.xs }}>{group.name}</Muted>
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {group.options.map((option, i) => {
                            const selected = option.url === region.url
                            return (
                                <Pressable key={option.url} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setRegion(option)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                                    <Text style={[type.body, { color: colors.foreground, flex: 1 }]}>{option.displayName}</Text>
                                    {selected ? <Check size={18} color={colors.primary} /> : null}
                                </Pressable>
                            )
                        })}
                    </View>
                </View>
            ))}

            <SectionLabel>Appearance</SectionLabel>
            <Segmented<"system" | "light" | "dark"> options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={settings.appearance} onChange={(v) => update({ appearance: v })} />
            <Muted style={{ marginTop: spacing.xs, marginLeft: spacing.xs }}>Light, dark, or match your phone.</Muted>

            <SectionLabel>Map style</SectionLabel>
            <Segmented<"auto" | "light" | "dark"> options={[{ value: "auto", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={settings.mapStyle} onChange={(v) => update({ mapStyle: v })} />
            <Muted style={{ marginTop: spacing.xs, marginLeft: spacing.xs }}>Basemap colours, independent of the app theme.</Muted>

            <SectionLabel>Walking pace</SectionLabel>
            <Segmented options={WALK_SPEED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={normalizeWalkSpeed(settings.walkSpeed)} onChange={(v) => update({ walkSpeed: v })} />

            <SectionLabel>Fares</SectionLabel>
            <Card style={{ paddingVertical: 0 }}>
                <Toggle label="Show fares" value={settings.showFares} onChange={(v) => update({ showFares: v })} />
                {settings.showFares ? (
                    <>
                        <Divider />
                        {(fareTypes.data ?? ADULT_ONLY).map((o, i) => (
                            <View key={o.value}>
                                {i > 0 ? <Divider /> : null}
                                <Pressable accessibilityRole="button" accessibilityState={{ selected: fareType === o.value }} onPress={() => update({ fareType: { ...settings.fareType, [slug]: o.value as FareType } })} style={styles.row}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[type.body, { color: colors.foreground }]}>{o.label}</Text>
                                        {o.detail ? <Muted>{o.detail}</Muted> : null}
                                    </View>
                                    {fareType === o.value ? <Check size={18} color={colors.primary} /> : null}
                                </Pressable>
                            </View>
                        ))}
                    </>
                ) : null}
            </Card>

            <SectionLabel>Map</SectionLabel>
            <Card style={{ paddingVertical: 0 }}>
                <Toggle label="Smooth vehicle movement" value={settings.smoothVehicles} onChange={(v) => update({ smoothVehicles: v })} />
                <Divider />
                <Toggle label="3D buildings when tracking" value={settings.map3D} onChange={(v) => update({ map3D: v })} />
            </Card>

            <SectionLabel>Planner</SectionLabel>
            <Segmented<"standard" | "easy"> options={[{ value: "standard", label: "Standard" }, { value: "easy", label: "Step by step" }]} value={settings.easyPlanner ? "easy" : "standard"} onChange={(v) => update({ easyPlanner: v === "easy" })} />
            <Muted style={{ marginTop: spacing.xs, marginLeft: spacing.xs }}>Step by step asks 4 simple questions, with large buttons.</Muted>

            {TransitNative.cloudAvailable ? (
                <>
                    <SectionLabel>iCloud</SectionLabel>
                    <Card style={{ paddingVertical: 0 }}>
                        <Toggle label="iCloud sync" detail={cloudSyncDetail(settings.iCloudSync, cloud)} value={settings.iCloudSync} onChange={(v) => update({ iCloudSync: v })} />
                    </Card>
                </>
            ) : null}

            <SectionLabel>Notifications</SectionLabel>
            <Pressable accessibilityRole="button" onPress={() => router.push("/manage-notifications")} style={[styles.card, styles.row, { gap: spacing.md, backgroundColor: colors.card, borderColor: colors.border, marginBottom: spacing.md }]}>
                <BellRing size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: colors.foreground }]}>Reminders & alerts</Text>
                    <Muted>Repeating leave-by reminders, and stop & route alerts</Muted>
                </View>
                <ChevronRight size={16} color={colors.mutedForeground} />
            </Pressable>
            <Card style={{ gap: spacing.sm }}>
                <Muted>{allowed.data ? "On for this device." : "Off. You'll be asked when you set a reminder or follow a stop."}</Muted>
                <Toggle
                    label="Notifications"
                    value={!!allowed.data}
                    onChange={async (on) => {
                        if (on) {
                            const granted = await requestNotifications()
                            allowed.refetch()
                            if (!granted) Linking.openSettings()
                        } else {
                            await Linking.openSettings()
                        }
                    }}
                />
                <Button title="Send a test notification" variant="secondary" onPress={testPush} loading={testing} />
            </Card>

            <SectionLabel>About</SectionLabel>
            <Card style={{ gap: spacing.sm }}>
                <Muted>Version {Constants.expoConfig?.version ?? "?"}</Muted>
                <Button title="Show the welcome again" variant="ghost" onPress={() => { update({ onboarded: false }); router.replace("/onboarding") }} />
            </Card>
        </ScrollView>
    )
}

/** iOS `SettingsView.iCloudRow`'s wording. */
function cloudSyncDetail(enabled: boolean, status: CloudSyncStatus): string {
    if (!enabled) return "Off - saved stops, places and trips stay on this device"
    switch (status.state) {
        case "signedOut":
            return "Sign in to iCloud to sync saved stops, places and trips across your devices"
        case "quota":
            return "iCloud storage for Transit is full - remove some saved trips"
        default:
            return status.lastSynced ? `Saved stops, places and trips - synced ${ago(status.lastSynced)}` : "Syncing saved stops, places and trips"
    }
}

function ago(ms: number): string {
    const minutes = Math.round((Date.now() - ms) / 60000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    const days = Math.round(hours / 24)
    return days === 1 ? "yesterday" : `${days} days ago`
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 48 },
})
