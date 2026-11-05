import * as Location from "expo-location"
import { router } from "expo-router"
import { Bell, Check, MapPin } from "@/components/icons"
import { useEffect, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { groupByCountry } from "@transit/shared/regions"
import { Button, Card, Muted, SectionLabel } from "@/components/ui"
import { notificationsAllowed, requestNotifications } from "@/lib/push"
import { regions, useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import { spacing, type, useColors } from "@/theme"

/** First launch - iOS `OnboardingView`: pick a region, then location and notifications (both optional). */
export default function Onboarding() {
    const colors = useColors()
    const { region, setRegion } = useRegion()
    const [, update] = useSettings()
    const [step, setStep] = useState<"region" | "permissions">("region")
    const [locationOn, setLocationOn] = useState(false)
    const [notificationsOn, setNotificationsOn] = useState(false)

    // Already allowed (a reinstall, or granted from system settings): say so.
    useEffect(() => {
        Location.getForegroundPermissionsAsync().then((p) => p.granted && setLocationOn(true)).catch(() => {})
        notificationsAllowed().then((on) => on && setNotificationsOn(true)).catch(() => {})
    }, [])

    const finish = () => {
        update({ onboarded: true })
        router.replace("/(tabs)")
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={[type.pageTitle, { color: colors.foreground, fontSize: 24 }]}>Welcome to Transit</Text>
                <Muted style={{ marginTop: spacing.xs }}>Live departures, journey planning and alerts for your trips.</Muted>

                {step === "region" ? (
                    <>
                        <SectionLabel>Where do you travel?</SectionLabel>
                        {groupByCountry(regions).map((g) => (
                            <View key={g.country} style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                                <Muted>{g.name}</Muted>
                                {g.options.map((o) => (
                                    <Card key={o.url} onPress={() => setRegion(o)} accessibilityLabel={o.displayName} style={o.url === region.url ? { borderColor: colors.primary, borderWidth: 1.5 } : undefined}>
                                        <View style={styles.row}>
                                            <Text style={[type.bodyMedium, { color: colors.foreground, flex: 1 }]}>{o.displayName}</Text>
                                            {o.url === region.url ? <Check size={18} color={colors.primary} /> : null}
                                        </View>
                                    </Card>
                                ))}
                            </View>
                        ))}
                        <Button title="Next" onPress={() => setStep("permissions")} />
                    </>
                ) : (
                    <>
                        <SectionLabel>Optional</SectionLabel>
                        <Card style={{ gap: spacing.sm }}>
                            <View style={styles.row}><MapPin size={20} color={colors.foreground} /><Text style={[type.bodyMedium, { color: colors.foreground, flex: 1 }]}>Stops near you</Text></View>
                            <Muted>See departures from the stops around you, and track journeys as you go.</Muted>
                            <Button title={locationOn ? "Location on" : "Allow location"} variant={locationOn ? "secondary" : "primary"} disabled={locationOn} onPress={async () => setLocationOn((await Location.requestForegroundPermissionsAsync()).granted)} />
                        </Card>
                        <Card style={{ gap: spacing.sm, marginTop: spacing.md }}>
                            <View style={styles.row}><Bell size={20} color={colors.foreground} /><Text style={[type.bodyMedium, { color: colors.foreground, flex: 1 }]}>Reminders and alerts</Text></View>
                            <Muted>When to leave, when to get off, and disruptions at your stops.</Muted>
                            <Button title={notificationsOn ? "Notifications on" : "Allow notifications"} variant={notificationsOn ? "secondary" : "primary"} disabled={notificationsOn} onPress={async () => setNotificationsOn(await requestNotifications())} />
                        </Card>
                        <Button title="Done" onPress={finish} style={{ marginTop: spacing.xl }} />
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
})
