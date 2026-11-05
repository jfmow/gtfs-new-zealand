import { useQuery } from "@tanstack/react-query"
import { Stack, router } from "expo-router"
import { Trash2 } from "@/components/icons"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { cleanStopName } from "@transit/shared/formatting"
import { reminderDetail, subscriptionDetail } from "@transit/shared/logic/reminders"
import { Loading } from "@/components/ui"
import { api } from "@/lib/api"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { spacing, type, useColors } from "@/theme"

/** "Alerts & reminders" - iOS `ManageNotificationsView`: leave-by reminders, route alerts and stop alerts; tap to edit, bin to remove. */
export default function ManageNotifications() {
    const colors = useColors()
    const { region, ready } = useRegion()
    const mine = useQuery({ queryKey: ["mine", region.url], queryFn: async () => unwrap(api.mySubscriptions()), enabled: ready })
    const reminders = useQuery({ queryKey: ["reminders", region.url], queryFn: async () => (await unwrap(api.journeyReminders())) ?? [], enabled: ready })
    const routes = useQuery({ queryKey: ["routes", region.url], queryFn: async () => (await unwrap(api.routes())) ?? {}, enabled: ready, staleTime: Infinity })
    const refresh = () => { mine.refetch(); reminders.refetch() }
    const stops = mine.data?.stops ?? []
    const followed = mine.data?.routes ?? []
    const none = !reminders.isLoading && !mine.isLoading && (reminders.data ?? []).length === 0 && stops.length === 0 && followed.length === 0

    return (
        <>
            <Stack.Screen options={{ title: "Alerts & reminders" }} />
            <ScrollView style={{ backgroundColor: colors.grouped }} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={refresh} />}>
                {mine.isLoading || reminders.isLoading ? <Loading /> : null}
                {none ? <Text style={[type.body, { color: colors.mutedForeground, textAlign: "center", marginTop: spacing.xl }]}>{"Nothing set up yet. Tap the bell on a stop for its alerts, or \"Remind me\" on a planned journey."}</Text> : null}
                {(reminders.data ?? []).length ? (
                    <Group title="Leave-by reminders">
                        {(reminders.data ?? []).map((r, i) => (
                            <Row key={r.id} border={i > 0} title={r.route_short_name ? `${r.route_short_name} from ${r.board_stop_name ?? r.start_label}` : `${r.start_label} to ${r.end_label}`} detail={reminderDetail(r)}
                                onRemove={async () => { await api.removeJourneyReminder(r.id); reminders.refetch() }} />
                        ))}
                    </Group>
                ) : null}
                {followed.length ? (
                    <Group title="Routes">
                        {followed.map((r, i) => {
                            const route = routes.data?.[r.route_id]
                            return (
                                <Row key={r.route_id} border={i > 0} title={route ? `${route.route_short_name} ${route.route_long_name}`.trim() : `Route ${r.route_id}`} detail={subscriptionDetail(r.causes, r.min_severity, r.notify_cancellations)}
                                    onPress={() => router.push({ pathname: "/alerts/route", params: { routeId: r.route_id } })} />
                            )
                        })}
                    </Group>
                ) : null}
                {stops.length ? (
                    <Group title="Stops">
                        {stops.map((s, i) => (
                            <Row key={s.parent_stop_id} border={i > 0} title={cleanStopName(s.parent_stop_id)}
                                detail={subscriptionDetail(s.causes, s.min_severity, s.notify_cancellations, s.routes?.length ? `${s.routes.length} route${s.routes.length > 1 ? "s" : ""}` : "All routes")}
                                onPress={() => router.push({ pathname: "/alerts/subscribe", params: { stop: s.parent_stop_id } })} />
                        ))}
                    </Group>
                ) : null}
            </ScrollView>
        </>
    )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    const colors = useColors()
    return (
        <View>
            <Text style={[type.metaMedium, styles.header, { color: colors.mutedForeground }]}>{title}</Text>
            <View style={[styles.group, { backgroundColor: colors.card }]}>{children}</View>
        </View>
    )
}

function Row({ title, detail, border, onPress, onRemove }: { title: string; detail: string; border?: boolean; onPress?: () => void; onRemove?: () => void }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={[styles.row, border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.bodyMedium, { color: colors.foreground }]}>{title}</Text>
                <Text style={[type.meta, { color: colors.mutedForeground }]}>{detail}</Text>
            </View>
            {onRemove ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title}`} hitSlop={8} onPress={onRemove}><Trash2 size={18} color={colors.danger} /></Pressable>
            ) : null}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 60 },
    header: { marginLeft: spacing.lg, marginBottom: 6, textTransform: "uppercase", fontSize: 12, letterSpacing: 0.4 },
    group: { borderRadius: 18, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
})
