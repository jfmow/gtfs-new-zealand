import { useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Alert, ScrollView, Text, View } from "react-native"
import { ALERT_CAUSE_GROUP_INFO, ALERT_SEVERITIES, severityLabels, type AlertCauseGroupKey } from "@transit/shared/alerts"
import { cleanStopName } from "@transit/shared/formatting"
import { causeGroupsFor, causesForGroups } from "@transit/shared/logic/reminders"
import { Toggle } from "@/components/alerts"
import { Button, Card, Chip, Loading, Muted, SectionLabel } from "@/components/ui"
import type { StopSubscriptionState } from "@transit/shared/models"
import { api } from "@/lib/api"
import { requestNotifications } from "@/lib/push"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** Follow a stop's alerts, with cause groups and a severity floor - iOS `AlertSubscriptionSheet`. */
export default function SubscribeToStop() {
    const { stop } = useLocalSearchParams<{ stop: string }>()
    const { region, ready } = useRegion()
    const current = useQuery({ queryKey: ["stop-sub", region.url, stop], queryFn: async () => { const r = await api.stopSubscription(stop!); return r.ok ? r.data : null }, enabled: ready && !!stop })
    if (current.isLoading) return <Loading />
    // The form starts from what's saved (if anything).
    return <SubscriptionForm stop={stop!} current={current.data ?? null} />
}

function SubscriptionForm({ stop, current }: { stop: string; current: StopSubscriptionState | null }) {
    const colors = useColors()
    const [groups, setGroups] = useState<AlertCauseGroupKey[]>(causeGroupsFor(current?.Causes ?? []))
    const [severity, setSeverity] = useState(current?.MinSeverity ?? "")
    const [cancellations, setCancellations] = useState(current?.NotifyCancellations ?? true)
    const [saving, setSaving] = useState(false)
    const subscribed = !!current

    const save = async () => {
        if (!(await requestNotifications())) return Alert.alert("Notifications are off", "Turn them on in Settings first.")
        setSaving(true)
        const filters = { routes: current?.Routes ?? [], causes: causesForGroups(groups), minSeverity: severity, notifyCancellations: cancellations }
        const res = subscribed ? await api.updateStopSubscription(stop, filters) : await api.subscribeToStop(stop, filters)
        setSaving(false)
        if (!res.ok) return Alert.alert("Couldn't save", res.error)
        router.back()
    }
    const remove = async () => {
        await api.unsubscribeFromStop(stop)
        router.back()
    }

    return (
        <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
            <Text style={[type.cardTitle, { color: colors.foreground }]}>{cleanStopName(stop ?? "")}</Text>
            <Muted>Get a notification when something changes here.</Muted>
            <SectionLabel>What about</SectionLabel>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <Chip label="Everything" selected={groups.length === 0} onPress={() => setGroups([])} />
                {ALERT_CAUSE_GROUP_INFO.map((g) => <Chip key={g.key} label={g.label} selected={groups.includes(g.key)} onPress={() => setGroups((s) => (s.includes(g.key) ? s.filter((x) => x !== g.key) : [...s, g.key]))} />)}
            </View>
            <SectionLabel>How serious</SectionLabel>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <Chip label="Any" selected={severity === ""} onPress={() => setSeverity("")} />
                {ALERT_SEVERITIES.map((s) => <Chip key={s} label={`${severityLabels[s]}+`} selected={severity === s} onPress={() => setSeverity(s)} />)}
            </View>
            <Card style={{ marginTop: spacing.lg }}><Toggle label="Cancelled services" detail="When a service here is cancelled" value={cancellations} onChange={setCancellations} /></Card>
            <Button title={subscribed ? "Save" : "Turn on alerts"} onPress={save} loading={saving} style={{ marginTop: spacing.lg }} />
            {subscribed ? <Button title="Stop following this stop" variant="ghost" onPress={remove} style={{ marginTop: spacing.sm }} /> : null}
        </ScrollView>
    )
}
