import { useEffect, useRef, useSyncExternalStore } from "react"
import { goTime } from "@transit/shared/models"
import type { JourneyType } from "@transit/shared/types/journey"
import { activeJourneyStore, endJourney, useActiveJourney, useJourneySession, type JourneyTick } from "./journey-session"
import { stopJourneyLocation } from "./journey-location"
import { clearJourneyPack, journeyPackStore, packIsComplete, saveJourneyPack, seedFromPack, useJourneyPack } from "./journey-pack"
import { endLiveSurface, updateLiveSurface } from "./live-surface"
import { resetMoments, scheduleMoments } from "./moments"
import { planContext, usePlan } from "./plans"
import { useRegion } from "./region"
import { cleanStopName } from "@transit/shared/formatting"
import { getRegionSlug } from "@transit/shared/regions"

/**
 * The tracked journey, app-wide - iOS `JourneyTrackingSession`, which lives
 * on the app environment rather than in the tracker screen. Mounted once in
 * the root layout, so tracking, the Live Activity / live notification and
 * the get-off reminders keep going when the tracker is minimised; the
 * tracker screen and the resume bar just read the latest tick.
 */

let latest: JourneyTick | null = null
const listeners = new Set<() => void>()
const journeyTickStore = {
    get: () => latest,
    set: (t: JourneyTick | null) => {
        latest = t
        listeners.forEach((l) => l())
    },
    subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
    },
}

/** The latest tick for `planId` (null until the runner has one). */
export function useJourneyTick(planId: string | undefined): JourneyTick | null {
    const tick = useSyncExternalStore(journeyTickStore.subscribe, journeyTickStore.get, journeyTickStore.get)
    return tick && planId && tick.displayPlan.ID === planId ? tick : null
}

/** Start tracking `plan` - only one journey at a time, so this replaces any other. */
export function startJourney(planId: string, regionUrl: string) {
    const current = activeJourneyStore.get()
    if (current?.planId === planId) return
    if (current) stopJourney()
    activeJourneyStore.set({ planId, region: regionUrl, startedAt: Date.now(), setOffAt: null, alightedThroughLeg: -1, rides: {} })
}

/** End the journey: tracking, reminders and the Lock Screen surface. */
export function stopJourney() {
    const planId = activeJourneyStore.get()?.planId
    endJourney()
    clearJourneyPack()
    stopJourneyLocation().catch(() => {})
    journeyTickStore.set(null)
    resetMoments()
    endLiveSurface(planId).catch(() => {})
}

/** How long after arriving the journey stays resumable - iOS `ResumeJourneyVisibility.grace`. */
export const RESUME_GRACE_MS = 45 * 60_000

/** How long the Lock Screen shows "arrived" before it goes - the server's `endGraceAfterArrival`. */
const ARRIVED_SURFACE_GRACE_MS = 90_000

/** Where the journey ends, for the resume bar and the Live Activity. */
export function destinationLabel(plan: JourneyType): string {
    // From the search when there was one; a shared link has none, so the last named stop on the way.
    const lastStop = [...plan.Legs].reverse().find((l) => l.ToStop?.stop_name)?.ToStop?.stop_name
    return planContext(plan.ID)?.end?.label ?? (lastStop ? cleanStopName(lastStop) : null) ?? "your destination"
}

export function JourneyRunner() {
    const [active] = useActiveJourney()
    const pack = useJourneyPack(active?.planId)
    // No signal after a relaunch: the saved copy stands in for the server's plan.
    useEffect(() => { if (pack) seedFromPack(pack) }, [pack])
    const { data: fetched } = usePlan(active?.planId)
    const plan = fetched ?? pack?.plan
    if (!active || !plan || plan.ID !== active.planId) return null
    return <Session key={plan.ID} plan={plan} />
}

function Session({ plan }: { plan: JourneyType }) {
    const { region } = useRegion()
    const tz = region.timeZone
    const tick = useJourneySession(plan)
    const surfaceEnded = useRef(false)

    // Save the journey for offline use as soon as it starts (and again if a ride's stops were missing).
    useEffect(() => {
        const pack = journeyPackStore.get()
        if (pack?.planId !== plan.ID || !packIsComplete(pack)) saveJourneyPack(plan, region.url).catch(() => {})
    }, [plan, region.url])

    // Journey over (ended, replaced, or the app moved on): stop the background GPS.
    useEffect(() => () => { stopJourneyLocation().catch(() => {}) }, [])

    useEffect(() => {
        // A tick landing after the journey ended must not reschedule reminders or restart the Live Activity.
        if (!tick || activeJourneyStore.get()?.planId !== plan.ID) return
        journeyTickStore.set(tick)
        // Keep the local get-off reminders and the Lock Screen in step with the live times.
        if (tick.snapshot.journeyArrived) {
            resetMoments()
            // Arrived a while ago: take the Live Activity / live notification down
            // rather than keep updating it - and, after a relaunch, rather than
            // starting a fresh one for a journey that's already over.
            const lastLeg = tick.displayPlan.Legs[tick.displayPlan.Legs.length - 1]
            const arrival = goTime((lastLeg?.ArrivalTime ?? tick.displayPlan.ArrivalTime) as unknown as string)?.getTime() ?? 0
            if (Date.now() >= arrival + ARRIVED_SURFACE_GRACE_MS) {
                if (!surfaceEnded.current) {
                    surfaceEnded.current = true
                    endLiveSurface(plan.ID).catch(() => {})
                }
                return
            }
        } else scheduleMoments(tick.displayPlan.Legs, tick.snapshot.progressLegIndex, tick.snapshot.phase === "onboard", tick.content.phase === "walking" && tick.content.primaryText.startsWith("Walk"), tz, plan.ID, getRegionSlug(region)).catch(() => {})
        updateLiveSurface(plan.ID, destinationLabel(plan), region, tick.content, tick.snapshot, tick.online, tick.leftAt).catch(() => {})
    }, [tick, tz, plan, region])

    // A journey nobody ended stops itself a while after it arrives.
    useEffect(() => {
        const arrival = goTime(plan.ArrivalTime as unknown as string)?.getTime()
        if (!arrival) return
        const check = () => { if (Date.now() > arrival + RESUME_GRACE_MS) stopJourney() }
        check()
        const t = setInterval(check, 60_000)
        return () => clearInterval(t)
    }, [plan])

    return null
}
