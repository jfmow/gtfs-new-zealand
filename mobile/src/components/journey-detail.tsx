import { Stack, router } from "expo-router"
import { AlarmClock, Bookmark, Expand, Navigation, Share2, TriangleAlert } from "@/components/icons"
import { useEffect, useState, type ReactNode } from "react"
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { laClock } from "@transit/shared/logic/journey-live"
import { getRegionSlug } from "@transit/shared/regions"
import { JourneyLegBar, JourneyMap, JourneyTimeline, isDisrupted, legDate, summaryLine } from "@/components/journey"
import { Button, ErrorText, Loading } from "@/components/ui"
import { useActiveJourney } from "@/lib/journey-session"
import { readable, useLayout } from "@/lib/layout"
import { journeyWebLink } from "@/lib/links"
import { planContext, useConnectionOdds, useFares, useLiveTripIds, usePlan } from "@/lib/plans"
import { useRegion } from "@/lib/region"
import { radius, spacing, type, useColors } from "@/theme"

/**
 * One planned journey - iOS `JourneyDetailView`: a still map preview (tap
 * for full screen), the summary card with the leg bar and fare, a
 * disruption banner, the "Your trip" timeline, and Start / Remind me pinned
 * at the bottom.
 */
export function JourneyDetailView({ id, embedded }: { id: string; embedded?: boolean }) {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { wide } = useLayout()
    const { region } = useRegion()
    const tz = region.timeZone
    const { data: plan, isLoading, error } = usePlan(id)
    const fares = useFares(plan ? [plan.ID] : [])
    const fare = plan ? fares[plan.ID] ?? null : null
    const odds = useConnectionOdds(plan)
    const liveTrips = useLiveTripIds(plan)
    const [active] = useActiveJourney()
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 15_000)
        return () => clearInterval(t)
    }, [])

    if (isLoading) return <Loading />
    if (error || !plan) return <View style={{ padding: spacing.lg }}><ErrorText>{(error as Error | null)?.message ?? "Journey not found"}</ErrorText></View>

    const ctx = planContext(plan.ID)
    const depart = legDate(plan.DepartureTime)
    const arrive = legDate(plan.ArrivalTime)
    const hasTransit = plan.Legs.some((l) => l.Mode === "transit")
    const isActive = active?.planId === plan.ID
    const leaveMinutes = depart ? Math.floor((depart.getTime() - now) / 60_000) : null
    const share = () => Share.share({
        message: `${arrive ? `Follow my journey - arriving around ${laClock(arrive, tz)}` : "Follow my journey"}\n${journeyWebLink(plan.ID, getRegionSlug(region))}`,
    })
    const destinationName = ctx?.end?.label ?? plan.Legs[plan.Legs.length - 1]?.ToStop?.stop_name ?? "your destination"

    const headerActions = (
                        <View style={{ flexDirection: "row", gap: spacing.lg }}>
                            {ctx?.start && ctx?.end ? (
                                <Pressable accessibilityRole="button" accessibilityLabel="Save trip" hitSlop={10} onPress={() => router.push({ pathname: "/save-trip", params: { id: plan.ID } })}>
                                    <Bookmark size={20} color={colors.foreground} />
                                </Pressable>
                            ) : null}
                            <Pressable accessibilityRole="button" accessibilityLabel="Share this journey" hitSlop={10} onPress={share}>
                                <Share2 size={20} color={colors.foreground} />
                            </Pressable>
                        </View>
    )

    return (
        <>
            {/* Embedded in the Planner's split view there's no stack header, so the title and actions head the column. */}
            {embedded ? null : <Stack.Screen options={{ title: "Journey", headerRight: () => headerActions }} />}
            <View style={{ flex: 1, backgroundColor: colors.background }}>
                {embedded ? <EmbeddedHeader actions={headerActions} /> : null}
                <ScrollView contentContainerStyle={[styles.content, readable(wide && !embedded)]} contentInsetAdjustmentBehavior="automatic">
                    <Pressable accessibilityRole="button" accessibilityLabel="Map of this journey" accessibilityHint="Opens the map full screen" onPress={() => router.push({ pathname: "/journey-map", params: { id: plan.ID } })}
                        style={[styles.preview, { borderColor: colors.border }]}>
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                            <JourneyMap plan={plan} interactive={false} padding={{ top: 30, bottom: 30, left: 30, right: 30 }} />
                        </View>
                        <View style={[styles.expand, { backgroundColor: colors.card + "e6" }]}><Expand size={15} color={colors.foreground} /></View>
                    </Pressable>

                    <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.summaryHead}>
                            <View style={{ flex: 1, gap: 3 }}>
                                {depart && arrive ? (
                                    <Text style={[type.number, { fontSize: 22, color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
                                        {laClock(depart, tz)}<Text style={{ color: colors.mutedForeground }}>  →  </Text>{laClock(arrive, tz)}
                                    </Text>
                                ) : null}
                                <Text style={[type.meta, { color: colors.mutedForeground }]}>{summaryLine(plan, fare?.label)}</Text>
                            </View>
                            {depart && leaveMinutes !== null && depart.getTime() - now < 3 * 3_600_000 ? (
                                <View style={{ alignItems: "flex-end" }} accessible accessibilityLabel={leaveMinutes <= 0 ? "Leave now" : `Leave in ${leaveMinutes} minutes`}>
                                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{leaveMinutes <= 0 ? "Leave" : "Leave in"}</Text>
                                    <Text style={[type.minutes, { fontSize: 20, color: leaveMinutes <= 2 ? colors.warning : colors.live }]}>{leaveMinutes <= 0 ? "now" : `${leaveMinutes} min`}</Text>
                                </View>
                            ) : null}
                        </View>
                        <JourneyLegBar plan={plan} />
                        {fare && (fare.detail || fare.note) ? <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={2}>{fare.detail || fare.note}</Text> : null}
                    </View>

                    {isDisrupted(plan) ? (
                        <View style={[styles.disruption, { backgroundColor: colors.danger + "0f", borderColor: colors.danger + "4d" }]}>
                            <TriangleAlert size={16} color={colors.danger} />
                            <Text style={[type.body, { flex: 1, color: colors.danger }]}>Service disruption on this route. Check alternative routes.</Text>
                        </View>
                    ) : null}

                    <Text style={[type.metaMedium, { color: colors.mutedForeground, marginTop: spacing.sm }]}>Your trip</Text>
                    <JourneyTimeline
                        legs={plan.Legs}
                        tz={tz}
                        destinationName={destinationName}
                        startName={ctx?.start?.label ?? plan.Legs[0]?.FromStop?.stop_name}
                        odds={odds}
                        tracked={(i) => {
                            // A trip id can repeat on another day - a ride hours off keeps the plan's answer.
                            const leg = plan.Legs[i]
                            const dep = legDate(leg?.DepartureTime)
                            if (!liveTrips || !leg || leg.Mode !== "transit" || !dep || dep.getTime() - now > 3 * 3_600_000) return undefined
                            return liveTrips.has(leg.TripID)
                        }}
                    />
                </ScrollView>

                <View style={[styles.actions, { paddingBottom: (embedded ? 0 : insets.bottom) + spacing.sm, backgroundColor: colors.background, borderTopColor: colors.border }]}>
                    <Button title={isActive ? "Resume tracking" : "Start this journey"} icon={Navigation} onPress={() => router.push({ pathname: "/journey/track/[id]", params: { id: plan.ID } })} style={{ flex: 1 }} />
                    {hasTransit && depart && depart.getTime() > now + 60_000 ? (
                        <Pressable accessibilityRole="button" accessibilityLabel="Remind me when to leave" onPress={() => router.push({ pathname: "/leave-reminder", params: { id: plan.ID } })}
                            style={[styles.alarm, { borderColor: colors.border, backgroundColor: colors.card }]}>
                            <AlarmClock size={20} color={colors.foreground} />
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </>
    )
}

function EmbeddedHeader({ actions }: { actions: ReactNode }) {
    const colors = useColors()
    return (
        <View style={styles.embeddedHeader}>
            <Text accessibilityRole="header" style={[type.cardTitle, { color: colors.foreground }]}>Journey</Text>
            {actions}
        </View>
    )
}

const styles = StyleSheet.create({
    embeddedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
    content: { padding: spacing.lg, paddingBottom: 40, gap: spacing.lg },
    preview: { height: 240, borderRadius: radius.xl + 4, overflow: "hidden", borderWidth: 1 },
    expand: { position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    summary: { padding: spacing.lg, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 14 },
    summaryHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
    disruption: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderWidth: 1 },
    actions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
    alarm: { width: 52, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
})
