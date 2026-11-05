import DateTimePicker from "@react-native-community/datetimepicker"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Check } from "@/components/icons"
import { useState } from "react"
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { laClock } from "@transit/shared/logic/journey-live"
import { leaveTime, makeReminderRequest, reminderFormFields } from "@transit/shared/logic/reminders"
import { getRegionSlug } from "@transit/shared/regions"
import { normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { legDate } from "@/components/journey"
import { Button, Loading, Segmented, HeaderTextButton } from "@/components/ui"
import { api } from "@/lib/api"
import { planContext, usePlan } from "@/lib/plans"
import { requestNotifications } from "@/lib/push"
import { useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import { spacing, type, useColors } from "@/theme"

type Repeat = "once" | "weekdays" | "custom"
const OFFSETS = [0, 5, 15, 30]
const WATCH = [{ value: 30, label: "30 minutes before" }, { value: 60, label: "1 hour before" }, { value: 120, label: "2 hours before" }]
const DAYS = ["M", "T", "W", "T", "F", "S", "S"]
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/**
 * "Remind me when to leave" - iOS `LeaveReminderSheet`: heads-up times,
 * or "only if something changes", repeating never / weekdays / custom days
 * with an optional last day.
 */
export default function LeaveReminder() {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { id } = useLocalSearchParams<{ id: string }>()
    const { data: plan } = usePlan(id)
    const { region } = useRegion()
    const tz = region.timeZone
    const [settings] = useSettings()
    const [offsets, setOffsets] = useState<number[]>([30, 15, 5, 0])
    const [mode, setMode] = useState<"leave" | "changes">("leave")
    const [watchFrom, setWatchFrom] = useState(60)
    const [repeat, setRepeat] = useState<Repeat>("once")
    const [days, setDays] = useState<boolean[]>(Array(7).fill(false))
    const [hasUntil, setHasUntil] = useState(false)
    const [until, setUntil] = useState(() => new Date(Date.now() + 30 * 86_400_000))
    const [untilPicker, setUntilPicker] = useState(false)
    const [busy, setBusy] = useState(false)
    const [now] = useState(() => Date.now())
    if (!plan) return <Loading />

    const ctx = planContext(plan.ID)
    const leave = leaveTime(plan)
    const watching = mode === "changes"
    const offsetPassed = (m: number) => repeat === "once" && !!leave && leave.getTime() - m * 60_000 <= now + 15_000
    const leftAlready = repeat === "once" && !!leave && leave.getTime() <= now + 15_000
    const usable = watching ? [watchFrom] : offsets.filter((o) => !offsetPassed(o)).sort((a, b) => b - a)
    const mask = repeat === "once" ? "" : repeat === "weekdays" ? "1111100" : days.some(Boolean) ? days.map((d) => (d ? "1" : "0")).join("") : ""
    const startPlace = ctx?.start ? { label: ctx.start.label, coordinate: { lat: ctx.start.lat, lon: ctx.start.lon } } : { label: "Start", coordinate: { lat: plan.StartLat, lon: plan.StartLon } }
    const endPlace = ctx?.end ? { label: ctx.end.label, coordinate: { lat: ctx.end.lat, lon: ctx.end.lon } } : { label: "Destination", coordinate: { lat: plan.EndLat, lon: plan.EndLon } }
    const ride = plan.Legs.find((l) => l.Mode === "transit")
    const target = ctx?.arriveBy ? legDate(plan.ArrivalTime) : legDate(ride?.scheduled_departure_time) ?? legDate(ride?.DepartureTime)
    const targetText = `${ctx?.arriveBy ? "Arrive by" : "Depart"} ${target ? laClock(target, tz) : ""}`
    const disabled = busy || usable.length === 0 || (repeat === "custom" && !mask) || (watching && leftAlready)

    const submit = async () => {
        if (!usable.length) {
            Alert.alert(offsets.length ? "Those alert times have already passed" : "Pick at least one alert time")
            return
        }
        const req = makeReminderRequest({
            plan, start: startPlace, end: endPlace, arriveBy: ctx?.arriveBy ?? false,
            maxWalkKm: ctx?.maxWalkKm ?? 1, walkSpeed: ctx?.walkSpeed ?? Number(normalizeWalkSpeed(settings.walkSpeed)),
            maxTransfers: ctx?.maxTransfers ?? 5, onlyRoutes: ctx?.onlyRoutes ?? [], modes: ctx?.modes, minTransferSec: ctx?.minTransferSec,
            offsets: usable, recurrence: mask,
            recurrenceUntil: hasUntil && mask ? `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}` : null,
            alertMode: mode, regionSlug: getRegionSlug(region), tz,
        })
        if (!req) {
            Alert.alert("This journey has no ride to remind you about.")
            return
        }
        await requestNotifications()
        setBusy(true)
        const res = await api.addJourneyReminder(reminderFormFields(req))
        setBusy(false)
        if (!res.ok) {
            Alert.alert("Couldn't set the reminder", res.error)
            return
        }
        router.back()
        Alert.alert(
            watching ? "Watching this journey" : "Reminder set",
            watching ? "We'll only tell you if something changes." : res.data?.next_leave_local ? `Leave around ${res.data.next_leave_local}.` : "We'll work out your leave time on the day.",
        )
    }

    return (
        <>
            <Stack.Screen options={{ title: watching ? "Watch journey" : "Remind me", headerLeft: () => <HeaderTextButton title="Cancel" side="left" onPress={() => router.back()} /> }} />
            <View style={{ flex: 1, backgroundColor: colors.grouped }}>
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={[styles.group, { backgroundColor: colors.card, padding: spacing.lg, gap: 4 }]}>
                        <Text style={[type.bodyMedium, { color: colors.foreground }]} numberOfLines={3}>{startPlace.label} → {endPlace.label}</Text>
                        <Text style={[type.meta, { color: colors.mutedForeground }]}>{targetText}</Text>
                        {leave && repeat === "once" ? (
                            <Text style={[type.body, { color: colors.mutedForeground, marginTop: 4 }]}>Leave at <Text style={{ fontFamily: "Geist-SemiBold", color: colors.foreground }}>{laClock(leave, tz)}</Text></Text>
                        ) : null}
                    </View>

                    <Segmented<"leave" | "changes">
                        options={[{ value: "leave", label: "When to leave" }, { value: "changes", label: "If something changes" }]}
                        value={mode}
                        onChange={(m) => { setMode(m); if (m === "changes" && repeat === "once") setRepeat("weekdays") }}
                    />

                    {watching ? (
                        <View>
                            <Text style={[type.metaMedium, styles.header, { color: colors.mutedForeground }]}>Start watching</Text>
                            <View style={[styles.group, { backgroundColor: colors.card }]}>
                                {WATCH.map((w, i) => (
                                    <Row key={w.value} title={w.label} on={watchFrom === w.value} border={i > 0} onPress={() => setWatchFrom(w.value)} />
                                ))}
                            </View>
                            <Text style={[type.meta, styles.footer, { color: colors.mutedForeground }]}>
                                {leftAlready ? "This journey has already left." : "No notifications on a normal day. We'll tell you if your service is running late or early, cancelled (with the next way to go), or has a service alert."}
                            </Text>
                        </View>
                    ) : (
                        <View>
                            <Text style={[type.metaMedium, styles.header, { color: colors.mutedForeground }]}>Notify me</Text>
                            <View style={[styles.group, { backgroundColor: colors.card }]}>
                                {OFFSETS.map((o, i) => (
                                    <Row key={o} title={o === 0 ? "When it's time to leave" : `${o} minutes before`} on={offsets.includes(o) && !offsetPassed(o)} passed={offsetPassed(o)} border={i > 0}
                                        onPress={() => setOffsets((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]))} />
                                ))}
                            </View>
                            <Text style={[type.meta, styles.footer, { color: colors.mutedForeground }]}>
                                {repeat === "once" && usable.length === 0 && offsets.length > 0 ? "This journey leaves too soon to set a reminder. Try repeating it, or an earlier trip." : "\"When it's time to leave\" is the go signal; the others are early nudges."}
                            </Text>
                        </View>
                    )}

                    <View>
                        <Text style={[type.metaMedium, styles.header, { color: colors.mutedForeground }]}>Repeat</Text>
                        <View style={[styles.group, { backgroundColor: colors.card }]}>
                            {(["once", "weekdays", "custom"] as const).map((r, i) => (
                                <Row key={r} title={r === "once" ? "Never" : r === "weekdays" ? "Weekdays" : "Custom"} on={repeat === r} border={i > 0} onPress={() => setRepeat(r)} />
                            ))}
                            {repeat === "custom" ? (
                                <View style={[styles.days, { borderTopColor: colors.border }]}>
                                    {DAYS.map((d, i) => (
                                        <Pressable key={i} accessibilityRole="button" accessibilityLabel={DAY_NAMES[i]} accessibilityState={{ selected: days[i] }} onPress={() => setDays((s) => s.map((v, k) => (k === i ? !v : v)))}
                                            style={[styles.day, { backgroundColor: days[i] ? colors.primary : colors.muted }]}>
                                            <Text style={[type.metaMedium, { color: days[i] ? colors.primaryForeground : colors.foreground }]}>{d}</Text>
                                        </Pressable>
                                    ))}
                                </View>
                            ) : null}
                            {repeat !== "once" ? (
                                <View style={[styles.row, styles.border, { borderTopColor: colors.border }]}>
                                    <Text style={[type.body, { flex: 1, fontSize: 17, color: colors.foreground }]}>End repeat</Text>
                                    <Switch value={hasUntil} onValueChange={setHasUntil} trackColor={{ true: colors.success }} />
                                </View>
                            ) : null}
                            {repeat !== "once" && hasUntil ? (
                                <View style={[styles.row, styles.border, { borderTopColor: colors.border }]}>
                                    <Text style={[type.body, { flex: 1, fontSize: 17, color: colors.foreground }]}>Last day</Text>
                                    {Platform.OS === "ios" ? (
                                        <DateTimePicker value={until} mode="date" minimumDate={new Date(now)} maximumDate={new Date(now + 90 * 86_400_000)} onChange={(_, d) => d && setUntil(d)} />
                                    ) : (
                                        <>
                                            <Text onPress={() => setUntilPicker(true)} style={[type.bodyMedium, { color: colors.primary }]}>{until.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</Text>
                                            {untilPicker ? <DateTimePicker value={until} mode="date" minimumDate={new Date(now)} maximumDate={new Date(now + 90 * 86_400_000)} onChange={(_, d) => { setUntilPicker(false); if (d) setUntil(d) }} /> : null}
                                        </>
                                    )}
                                </View>
                            ) : null}
                        </View>
                        {mask && !watching ? <Text style={[type.meta, styles.footer, { color: colors.mutedForeground }]}>{"Each day we'll find the best journey with these settings and tell you when to leave. Up to 90 days ahead."}</Text> : null}
                    </View>
                </ScrollView>
                <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, backgroundColor: colors.background }}>
                    <Button title={busy ? "Setting…" : watching ? "Watch journey" : "Set reminder"} onPress={submit} disabled={disabled} />
                    {busy ? <ActivityIndicator style={{ position: "absolute", left: spacing.xl + 8, top: spacing.lg + 14 }} /> : null}
                </View>
            </View>
        </>
    )
}

function Row({ title, on, passed, border, onPress }: { title: string; on: boolean; passed?: boolean; border?: boolean; onPress: () => void }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!passed }} disabled={passed} onPress={onPress}
            style={[styles.row, border && [styles.border, { borderTopColor: colors.border }]]}>
            <Text style={[type.body, { fontSize: 17, color: passed ? colors.mutedForeground : colors.foreground }]}>{title}</Text>
            {passed ? <Text style={[type.meta, { color: colors.mutedForeground }]}>passed</Text> : null}
            <View style={{ flex: 1 }} />
            {on ? <Check size={18} color={colors.primary} /> : null}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 40 },
    group: { borderRadius: 18, overflow: "hidden" },
    header: { marginLeft: spacing.lg, marginBottom: 6, textTransform: "uppercase", fontSize: 12, letterSpacing: 0.4 },
    footer: { marginHorizontal: spacing.lg, marginTop: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 50 },
    border: { borderTopWidth: StyleSheet.hairlineWidth },
    days: { flexDirection: "row", justifyContent: "space-around", paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
    day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
})
