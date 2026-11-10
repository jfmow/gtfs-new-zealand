import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Alert, ScrollView, View } from "react-native"
import { AlertList, Toggle } from "@/components/alerts"
import { Card, EmptyState, ErrorText, Loading } from "@/components/ui"
import { api } from "@/lib/api"
import { requestNotifications } from "@/lib/push"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, useColors } from "@/theme"
import { readable, useLayout } from "@/lib/layout"

/** A route's service alerts, and following it (the web's /alerts/route/:id). */
export default function RouteAlerts() {
    const colors = useColors()
    const { wide } = useLayout()
    const { routeId } = useLocalSearchParams<{ routeId: string }>()
    const { region, ready } = useRegion()
    const alerts = useQuery({ queryKey: ["route-alerts", region.url, routeId], queryFn: async () => (await unwrap(api.alertsForRoute(routeId!))) ?? [], enabled: ready && !!routeId })
    const mine = useQuery({ queryKey: ["mine", region.url], queryFn: async () => unwrap(api.mySubscriptions()), enabled: ready })
    const following = (mine.data?.routes ?? []).some((r) => r.route_id === routeId)
    const [busy, setBusy] = useState(false)

    const toggle = async (on: boolean) => {
        if (on && !(await requestNotifications())) return Alert.alert("Notifications are off", "Turn them on in Settings first.")
        setBusy(true)
        const res = on ? await api.subscribeToRoute(routeId!) : await api.unsubscribeFromRoute(routeId!)
        setBusy(false)
        if (!res.ok) Alert.alert("Couldn't update", res.error)
        mine.refetch()
    }

    return (
        <>
            <Stack.Screen options={{ title: `Route ${routeId}` }} />
            <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[{ padding: spacing.lg, gap: spacing.md }, readable(wide)]}>
                <Card><Toggle label="Tell me about disruptions" value={following} onChange={(v) => !busy && toggle(v)} /></Card>
                {alerts.isLoading ? <Loading /> : null}
                {alerts.error ? <ErrorText>{(alerts.error as Error).message}</ErrorText> : null}
                {alerts.data?.length === 0 ? <EmptyState title="No alerts on this route" /> : null}
                <View>{alerts.data?.length ? <AlertList byRoute={{ [routeId!]: alerts.data }} /> : null}</View>
            </ScrollView>
        </>
    )
}
