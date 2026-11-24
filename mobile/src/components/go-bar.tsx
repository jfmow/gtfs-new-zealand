import { useQuery } from "@tanstack/react-query"
import { router, useIsFocused } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { rankedPlans } from "@transit/shared/easy-planner"
import type { JourneyPlanRequest } from "@transit/shared/endpoints"
import { pruneDominatedPlans } from "@transit/shared/logic/basics"
import { likelyDestination, type GoPlace } from "@transit/shared/logic/go"
import { laClock } from "@transit/shared/logic/journey-live"
import { cleanStopName } from "@transit/shared/formatting"
import { getRegionSlug } from "@transit/shared/regions"
import { normalizeWalkSpeed } from "@transit/shared/walk-speed"
import { ArrowRight } from "@/components/icons"
import { legDate, legRouteName } from "@/components/journey"
import { placeTitle } from "@/components/place-style"
import { api } from "@/lib/api"
import { useAppActive } from "@/lib/app-active"
import { coordinateOf, useUserLocation } from "@/lib/location"
import { usePlannerOptions, useRecentDestinations } from "@/lib/planner-store"
import { contextFor, rememberPlans } from "@/lib/plans"
import { unwrap } from "@/lib/queries"
import { useRegion } from "@/lib/region"
import { useSavedPlaces, useSettings } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** Hour of the day on the region's clock. */
function localHour(tz: string): number {
    return Number(new Intl.DateTimeFormat("en-NZ", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()))
}

/** "leave now" / "leave in 6 min" / "leave 9:40am". */
function leaveText(dep: Date | null, tz: string, now = Date.now()): string {
    if (!dep) return ""
    const mins = Math.round((dep.getTime() - now) / 60_000)
    if (mins <= 0) return "leave now"
    return mins < 60 ? `leave in ${mins} min` : `leave ${laClock(dep, tz)}`
}

/**
 * Home's one-tap journey: plans from here to where you most likely want to
 * be (work in the morning, home later, or whichever of the two you're not
 * at) and shows the answer live. Tapping starts that journey; nothing shows
 * until there's a place and a plan.
 */
export function GoBar() {
    const colors = useColors()
    const { region, ready } = useRegion()
    const slug = getRegionSlug(region)
    const tz = region.timeZone
    const [settings] = useSettings()
    const [options] = usePlannerOptions()
    const places = useSavedPlaces(slug)
    const recents = useRecentDestinations(slug)
    const here = coordinateOf(useUserLocation(false))
    const focused = useIsFocused()
    const active = useAppActive()

    const goPlaces: GoPlace[] = places.places.map((p) => ({ kind: p.kind, label: placeTitle(p), lat: p.lat, lon: p.lon }))
    const dest = likelyDestination(goPlaces, here, localHour(tz), recents.recent.map((r) => ({ kind: "other", label: r.label, lat: r.lat, lon: r.lon })))
    // Rounded so walking around the block doesn't re-plan.
    const from = here ? { lat: Math.round(here.lat * 2000) / 2000, lon: Math.round(here.lon * 2000) / 2000 } : null
    const request: JourneyPlanRequest | null = from && dest ? {
        start: from,
        end: { lat: dest.lat, lon: dest.lon },
        timeType: "now",
        walkSpeed: Number(normalizeWalkSpeed(settings.walkSpeed)),
        maxWalkKm: options.maxWalkKm,
        maxTransfers: options.maxTransfers,
        modes: options.modes,
        accessible: options.accessible || undefined,
    } : null

    const plan = useQuery({
        queryKey: ["go", region.url, request && JSON.stringify(request)],
        queryFn: async () => {
            const res = (await unwrap(api.plan(request!))) ?? []
            rememberPlans(res, contextFor(request!, { label: "Current location", ...from! }, { label: dest!.label, lat: dest!.lat, lon: dest!.lon }))
            return rankedPlans(pruneDominatedPlans(res), null)[0] ?? null
        },
        enabled: ready && !!request,
        staleTime: 60_000,
        refetchInterval: focused && active ? 60_000 : false,
        retry: false,
    })

    const p = plan.data
    if (!dest || !p) return null
    const ride = p.Legs.find((l) => l.Mode === "transit")
    const dep = legDate(p.DepartureTime)
    const arr = legDate(p.ArrivalTime)
    const rideDep = ride ? legDate(ride.DepartureTime) : null
    const detail = ride
        ? `${legRouteName(ride)} ${rideDep ? laClock(rideDep, tz) : ""} from ${cleanStopName(ride.FromStop?.stop_name ?? "")} · arrive ${arr ? laClock(arr, tz) : ""}`
        : `Walk · arrive ${arr ? laClock(arr, tz) : ""}`
    const when = leaveText(dep, tz)

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Go to ${dest.label}, ${when}. ${detail}. Starts the journey.`}
            accessibilityHint="Long-press to see other routes"
            onPress={() => router.push({ pathname: "/journey/track/[id]", params: { id: p.ID } })}
            onLongPress={() => router.push({ pathname: "/(tabs)/planner", params: { toLat: String(dest.lat), toLon: String(dest.lon), toLabel: dest.label } })}
            style={({ pressed }) => [styles.bar, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
            <View style={[styles.arrow, { backgroundColor: colors.primaryForeground }]}>
                <ArrowRight size={18} color={colors.primary} strokeWidth={2.5} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.row}>
                    <Text style={[type.bodyMedium, { flex: 1, color: colors.primaryForeground }]} numberOfLines={1}>Go to {dest.label}</Text>
                    <Text style={[type.metaMedium, { color: colors.primaryForeground }]}>{when}</Text>
                </View>
                <Text style={[type.meta, { color: colors.primaryForeground, opacity: 0.85 }]} numberOfLines={1}>{detail}</Text>
            </View>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    bar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.xl, marginTop: spacing.lg },
    arrow: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
})
