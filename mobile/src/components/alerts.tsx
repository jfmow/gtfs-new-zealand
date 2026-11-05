import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { ALERT_CAUSE_INFO, type AlertCause } from "@transit/shared/alerts"
import { alertStatus } from "@transit/shared/logic/basics"
import type { TransitAlert } from "@transit/shared/models"
import { spacing, type, useColors } from "@/theme"
import { Card, Muted } from "./ui"

export function AlertCard({ alert, route }: { alert: TransitAlert; route?: string }) {
    const colors = useColors()
    const [open, setOpen] = useState(false)
    const status = alertStatus(alert)
    const cause = ALERT_CAUSE_INFO[alert.cause as AlertCause]
    const tone = cause?.variant === "destructive" ? colors.danger : status.kind === "active" ? colors.warning : colors.mutedForeground
    const range = (s: number) => new Date(s * 1000).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })
    return (
        <Card onPress={() => setOpen((o) => !o)} accessibilityLabel={`${alert.title}, ${status.label}`} style={{ borderLeftWidth: 3, borderLeftColor: tone }}>
            <View style={styles.row}>
                <Text style={[type.badge, { color: tone }]}>{status.label.toUpperCase()}</Text>
                {cause ? <Muted>· {cause.label}</Muted> : null}
                {route ? <Muted>· {route}</Muted> : null}
            </View>
            <Text style={[type.bodyMedium, { color: colors.foreground, marginTop: 2 }]}>{alert.title}</Text>
            {open ? (
                <>
                    <Text style={[type.body, { color: colors.foreground, marginTop: spacing.xs }]}>{alert.description}</Text>
                    <Muted style={{ marginTop: spacing.xs }}>{range(alert.start_date)}{alert.end_date > 0 ? ` – ${range(alert.end_date)}` : ""}</Muted>
                </>
            ) : null}
        </Card>
    )
}

export function AlertList({ byRoute }: { byRoute: Record<string, TransitAlert[]> }) {
    const all = Object.entries(byRoute).flatMap(([route, alerts]) => alerts.map((a) => ({ a, route })))
    // Live ones first, then soon, then the rest.
    const rank = { active: 0, soon: 1, inactive: 2 }
    all.sort((x, y) => rank[alertStatus(x.a).kind] - rank[alertStatus(y.a).kind] || x.a.start_date - y.a.start_date)
    // The same alert is often listed under several routes.
    const seen = new Set<string>()
    const unique = all.filter(({ a }) => (seen.has(a.title + a.start_date) ? false : (seen.add(a.title + a.start_date), true)))
    return <View style={{ gap: spacing.sm }}>{unique.map(({ a, route }, i) => <AlertCard key={i} alert={a} route={route} />)}</View>
}

export function Toggle({ label, value, onChange, detail }: { label: string; value: boolean; onChange: (v: boolean) => void; detail?: string }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={styles.toggle}>
            <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: colors.foreground }]}>{label}</Text>
                {detail ? <Muted>{detail}</Muted> : null}
            </View>
            <View style={[styles.track, { backgroundColor: value ? colors.primary : colors.muted }]}>
                <View style={[styles.thumb, { backgroundColor: colors.card, alignSelf: value ? "flex-end" : "flex-start" }]} />
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
    toggle: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
    track: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: "center" },
    thumb: { width: 22, height: 22, borderRadius: 11 },
})
