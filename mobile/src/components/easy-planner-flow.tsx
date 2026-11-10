import DateTimePicker from "@react-native-community/datetimepicker"
import { Stack, router } from "expo-router"
import { Bus, Check, Footprints, LocateFixed, MapPin, Navigation, Ship, TrainFront } from "@/components/icons"
import { useState } from "react"
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { defaultArriveBy, easyAttempts, easySteps, recommendedPlan, type EasyTravelMode } from "@transit/shared/easy-planner"
import { laClock } from "@transit/shared/logic/journey-live"
import type { JourneyType } from "@transit/shared/types/journey"
import { normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { LocationResults, type PickedPlace } from "./location-search"
import { Button, Loading, SearchField, HeaderTextButton } from "./ui"
import { api } from "@/lib/api"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { contextFor, rememberPlans } from "@/lib/plans"
import { useRegion } from "@/lib/region"
import { useSettings } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"
import type { JourneyPlanRequest } from "@transit/shared/endpoints"
import { readable, useLayout } from "@/lib/layout"

type Step = "to" | "from" | "how" | "when" | "result"

/**
 * The step-by-step planner - iOS `EasyPlannerFlow`: four plain questions,
 * then the easiest way in words. `embedded` when it is the Planner tab
 * itself (Settings > Planner > Step by step) rather than a modal.
 */
export function EasyPlannerFlow({ embedded = false }: { embedded?: boolean }) {
    const colors = useColors()
    const { wide } = useLayout()
    const { region } = useRegion()
    const tz = region.timeZone
    const [settings] = useSettings()
    const here = coordinateOf(useUserLocation())
    const [step, setStep] = useState<Step>("to")
    const [to, setTo] = useState<PickedPlace | null>(null)
    const [from, setFrom] = useState<PickedPlace | null>(null)
    const [fromSearch, setFromSearch] = useState(false)
    const [query, setQuery] = useState("")
    const [modes, setModes] = useState<EasyTravelMode[]>([])
    const [walkLess, setWalkLess] = useState(false)
    const [arriveBy, setArriveBy] = useState<Date | null>(null)
    const [picking, setPicking] = useState(false)
    const [result, setResult] = useState<{ plan: JourneyType; note: string | null } | null | "none">(null)
    const [busy, setBusy] = useState(false)

    const questionIndex = { to: 1, from: 2, how: 3, when: 4, result: 4 }[step]

    const find = async () => {
        const start = from ?? (here ? { label: "Where I am now", ...here } : null)
        if (!start || !to) return
        setStep("result")
        setBusy(true)
        setResult(null)
        for (const attempt of easyAttempts(modes, walkLess)) {
            const req: JourneyPlanRequest = {
                start: { lat: start.lat, lon: start.lon }, end: { lat: to.lat, lon: to.lon },
                date: arriveBy ?? undefined, timeType: arriveBy ? "arriveat" : "now",
                maxWalkKm: attempt.options.maxWalkKm, walkSpeed: walkLess ? attempt.options.walkSpeed : Number(normalizeWalkSpeed(settings.walkSpeed)),
                maxTransfers: attempt.options.maxTransfers, minTransferSec: attempt.options.minTransferSec, modes: attempt.modes,
            }
            const res = await api.plan(req)
            const plans = res.ok ? res.data ?? [] : []
            const best = recommendedPlan(plans, arriveBy)
            if (best) {
                rememberPlans(plans, contextFor(req, start, to))
                setResult({ plan: best, note: attempt.note })
                setBusy(false)
                return
            }
        }
        setResult("none")
        setBusy(false)
    }

    const title = step === "result" ? "Your journey" : `Question ${questionIndex} of 4`
    const go = embedded ? router.push : router.replace
    const body = (
        <>
            {embedded ? null : <Stack.Screen options={{ title, headerLeft: () => <HeaderTextButton title="Close" side="left" onPress={() => router.back()} /> }} />}
            {embedded ? <Text style={[type.metaMedium, { color: colors.mutedForeground, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, readable(wide)]}>{title}</Text> : null}
            <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, readable(wide)]} keyboardShouldPersistTaps="handled">
                {step === "to" ? (
                    <>
                        <Text style={[styles.question, { color: colors.foreground }]}>Where do you want to go?</Text>
                        <SearchField value={query} onChangeText={setQuery} placeholder="Search for a place" autoFocus accessibilityLabel="Search for a place" />
                        <LocationResults query={query} showCurrent={false} onPick={(p) => { setTo(p); setQuery(""); setStep("from") }} />
                    </>
                ) : null}

                {step === "from" ? (
                    <>
                        <Text style={[styles.question, { color: colors.foreground }]}>Where are you starting from?</Text>
                        {!fromSearch ? (
                            <View style={{ gap: spacing.md }}>
                                <Choice icon={LocateFixed} title="Where I am now" detail="Uses your phone's location" disabled={!here} onPress={() => { setFrom(null); setStep("how") }} />
                                <Choice icon={MapPin} title="Somewhere else" detail="Search for a place" onPress={() => setFromSearch(true)} />
                            </View>
                        ) : (
                            <>
                                <SearchField value={query} onChangeText={setQuery} placeholder="Search for a place" autoFocus accessibilityLabel="Starting place" />
                                <LocationResults query={query} showCurrent={false} onPick={(p) => { setFrom(p); setQuery(""); setStep("how") }} />
                            </>
                        )}
                    </>
                ) : null}

                {step === "how" ? (
                    <>
                        <Text style={[styles.question, { color: colors.foreground }]}>How do you want to get there?</Text>
                        <Text style={[type.body, { color: colors.mutedForeground, marginBottom: spacing.md }]}>You can choose more than one.</Text>
                        <View style={{ gap: spacing.md }}>
                            <Choice title="Any way is fine" selected={modes.length === 0} onPress={() => setModes([])} />
                            {([["bus", Bus, "Bus"], ["train", TrainFront, "Train"], ["ferry", Ship, "Ferry"]] as const).map(([m, Icon, label]) => (
                                <Choice key={m} icon={Icon} title={label} selected={modes.includes(m)} onPress={() => setModes((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))} />
                            ))}
                            <Choice icon={Footprints} title="Walk less, fewer changes" detail="Short walks at an easy pace, at most one change, and extra time to change." selected={walkLess} onPress={() => setWalkLess((w) => !w)} />
                        </View>
                        <Button title="Next" onPress={() => setStep("when")} style={{ marginTop: spacing.xl }} />
                    </>
                ) : null}

                {step === "when" ? (
                    <>
                        <Text style={[styles.question, { color: colors.foreground }]}>What time do you want to get there?</Text>
                        <View style={{ gap: spacing.md }}>
                            <Choice title="As soon as I can" detail="Leave now" selected={!arriveBy} onPress={() => setArriveBy(null)} />
                            <Choice title="By a certain time" detail={arriveBy ? laClock(arriveBy, tz) : "Choose the time below"} selected={!!arriveBy} onPress={() => { setArriveBy((a) => a ?? defaultArriveBy()); if (Platform.OS === "android") setPicking(true) }} />
                        </View>
                        {arriveBy && (Platform.OS === "ios" || picking) ? (
                            <View style={[styles.pickerCard, { backgroundColor: colors.card }]}>
                                <DateTimePicker value={arriveBy} mode="time" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(_, d) => { setPicking(false); if (d) setArriveBy(d) }} />
                            </View>
                        ) : null}
                        <Button title="Find the easiest way" onPress={find} style={{ marginTop: spacing.xl }} />
                    </>
                ) : null}

                {step === "result" ? (
                    busy ? (
                        <View style={{ alignItems: "center", marginTop: spacing.xxl }}>
                            <Loading />
                            <Text style={[type.body, { color: colors.mutedForeground }]}>Finding the easiest way…</Text>
                        </View>
                    ) : result === "none" ? (
                        <>
                            <Text style={[styles.question, { color: colors.foreground }]}>Sorry</Text>
                            <Text style={[type.body, { color: colors.mutedForeground, marginBottom: spacing.lg }]}>{"We couldn't find a way. You could try:"}</Text>
                            <View style={{ gap: spacing.md }}>
                                <Choice title="Change the time" onPress={() => setStep("when")} />
                                <Choice title="Change how you travel" onPress={() => setStep("how")} />
                                <Choice title="Change where you start" onPress={() => { setFromSearch(false); setStep("from") }} />
                                <Choice title="Change where you're going" onPress={() => setStep("to")} />
                            </View>
                        </>
                    ) : result ? (
                        <>
                            <Text style={[styles.question, { color: colors.foreground }]}>The easiest way</Text>
                            {result.note ? <Text style={[type.body, { color: colors.mutedForeground, marginBottom: spacing.md }]}>{result.note}</Text> : null}
                            {result.plan.Legs.some((l) => l.Mode === "transit" && !l.trip_usable) ? (
                                <Text style={[type.body, { color: colors.danger, marginBottom: spacing.md }]}>One of these services has a problem today. It may not run.</Text>
                            ) : null}
                            <View style={[styles.steps, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                {easySteps(result.plan, to?.label ?? "your destination", tz).map((s, i) => (
                                    <View key={i} style={styles.stepRow}>
                                        <View style={[styles.stepNum, { backgroundColor: colors.primary }]}><Text style={[type.metaMedium, { color: colors.primaryForeground }]}>{i + 1}</Text></View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[type.bodyMedium, { fontSize: 17, color: colors.foreground }]}>{s.headline}</Text>
                                            {s.detail ? <Text style={[type.body, { color: colors.mutedForeground }]}>{s.detail}</Text> : null}
                                        </View>
                                    </View>
                                ))}
                            </View>
                            <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
                                <Button title="Start this journey" icon={Navigation} onPress={() => go({ pathname: "/journey/track/[id]", params: { id: result.plan.ID } })} />
                                <Button title="Remind me when to leave" variant="secondary" onPress={() => router.push({ pathname: "/journey/[id]", params: { id: result.plan.ID, remind: "1" } })} />
                                <Button title="See it on a map" variant="secondary" onPress={() => router.push({ pathname: "/journey/[id]", params: { id: result.plan.ID } })} />
                                <Button title="Plan another journey" variant="ghost" onPress={() => { setTo(null); setFrom(null); setModes([]); setWalkLess(false); setArriveBy(null); setStep("to") }} />
                            </View>
                        </>
                    ) : null
                ) : null}

                {step !== "to" && step !== "result" ? (
                    <Text onPress={() => (embedded ? router.push({ pathname: "/(tabs)/planner", params: { standard: "1" } }) : router.replace("/(tabs)/planner"))} style={[type.body, { color: colors.mutedForeground, textAlign: "center", marginTop: spacing.xl, textDecorationLine: "underline" }]}>Full planner</Text>
                ) : null}
            </ScrollView>
        </>
    )
    return embedded ? <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>{body}</SafeAreaView> : body
}

function Choice({ icon: Icon, title, detail, selected, onPress, disabled }: { icon?: typeof Bus; title: string; detail?: string; selected?: boolean; onPress: () => void; disabled?: boolean }) {
    const colors = useColors()
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
            style={[styles.choice, { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : StyleSheet.hairlineWidth, opacity: disabled ? 0.5 : 1 }]}>
            {Icon ? <Icon size={24} color={colors.foreground} /> : null}
            <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { fontSize: 17, color: colors.foreground }]}>{title}</Text>
                {detail ? <Text style={[type.body, { color: colors.mutedForeground }]}>{detail}</Text> : null}
            </View>
            {selected ? <Check size={20} color={colors.primary} /> : null}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    question: { fontFamily: "Geist-Bold", fontSize: 26, letterSpacing: -0.3, marginBottom: spacing.lg },
    choice: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg + 4, minHeight: 64 },
    pickerCard: { borderRadius: 18, marginTop: spacing.lg, padding: spacing.sm, alignItems: "center" },
    steps: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.md },
    stepRow: { flexDirection: "row", gap: spacing.md },
    stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
})
