import { useQueries, useQuery } from "@tanstack/react-query"
import * as Location from "expo-location"
import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import { DepartureDetector, haversineMeters } from "@transit/shared/logic/basics"
import { buildLiveJourney } from "@transit/shared/logic/journey-live"
import { buildLiveActivityContent, type LiveActivityContent } from "@transit/shared/logic/live-content"
import { OfflineRideEstimator, type GPSFix, type RideProgress } from "@transit/shared/logic/offline"
import { JourneyProgressModel, gpsMode, type JourneyProgressSnapshot } from "@transit/shared/logic/tracking"
import { goTime, type Coordinate, type StopTimeUpdate, type TripStopRef, type Vehicle } from "@transit/shared/models"
import type { JourneyType } from "@transit/shared/types/journey"
import { api } from "./api"
import { getJourneyFix, onJourneyFix, setJourneyLocationMode, type JourneyFix } from "./journey-location"
import { unwrap } from "./queries"
import { useRegion } from "./region"
import { stored, useStored } from "./storage"

/**
 * One tracked journey - iOS `JourneyTrackingSession`. Polls the combined
 * `realtime/journey` feed, places the rider (GPS + DepartureDetector +
 * OfflineRideEstimator when the feed has nothing), runs the shared
 * JourneyProgressModel, and builds the same content the Live Activity /
 * Android live notification shows.
 */

export interface ActiveJourney {
    planId: string
    region: string
    startedAt: number
    /** When the rider set off on the first walk (ms), once seen. */
    setOffAt: number | null
    alightedThroughLeg: number
    rides: Record<string, RideProgress>
}

export const activeJourneyStore = stored<ActiveJourney | null>("active-journey", null)

export function useActiveJourney() {
    return useStored(activeJourneyStore)
}

export interface JourneyTick {
    displayPlan: JourneyType
    snapshot: JourneyProgressSnapshot
    content: LiveActivityContent
    vehicles: Record<string, Vehicle>
    user: Coordinate | null
    online: boolean
    lastLiveAt: number | null
    /** For the server's leave alerts: when you set off (unix s), 0 while GPS still has you at the start, undefined when it can't tell. */
    leftAt?: number
}

const POLL_MS = 10_000
const TICK_MS = 5_000

export function useJourneySession(plan: JourneyType | undefined): JourneyTick | null {
    const { region, ready } = useRegion()
    const tz = region.timeZone
    const [active, setActive] = useActiveJourney()
    // Long-lived state machines for this session (not React state - they mutate).
    const [model] = useState(() => new JourneyProgressModel())
    const [estimator] = useState(() => new OfflineRideEstimator())
    const detector = useRef<DepartureDetector | null>(null)
    const lastFix = useRef<GPSFix | null>(null)
    const lastTracked = useRef<string | null>(null)
    /** The trip whose vehicle was at your stop last tick (boarding) - GPS can then tell you've got on sooner. */
    const boardingTrip = useRef<string | null>(null)
    const [tick, setTick] = useState(0)
    const [user, setUser] = useState<{ c: Coordinate; accuracy: number | null } | null>(null)

    const transitLegs = plan?.Legs.filter((l) => l.Mode === "transit" && l.TripID) ?? []
    const tripIds = [...new Set(transitLegs.map((l) => l.TripID))]

    // Pick up where the saved journey left off. `startJourney` saved it
    // fresh, and the runner only mounts a session for the saved journey.
    useEffect(() => {
        const current = activeJourneyStore.get()
        if (!plan || current?.planId !== plan.ID) return
        model.restore(current.alightedThroughLeg)
        estimator.restore(current.rides)
        detector.current = new DepartureDetector(current.setOffAt ? new Date(current.setOffAt) : null)
    }, [plan, model, estimator])

    // Journey GPS - keeps running with the screen off (journey-location.ts).
    // Starts precise (the journey is opened from the foreground); each tick
    // then picks the mode the SwiftUI app's GPS policy would.
    const refetchLive = useRef<() => void>(() => {})
    useEffect(() => {
        let cancelled = false
        Location.requestForegroundPermissionsAsync().then(({ granted }) => {
            if (granted && !cancelled) setJourneyLocationMode("precise").catch(() => {})
        })
        const apply = (f: JourneyFix) => {
            lastFix.current = { coordinate: f.coordinate, speed: f.speed, timestamp: new Date(f.timestamp) }
            setUser({ c: f.coordinate, accuracy: f.accuracy })
            // Timers don't run in the background, but fixes do: use them to keep the live data fresh.
            refetchLive.current()
        }
        const last = getJourneyFix()
        if (last) apply(last)
        const off = onJourneyFix(apply)
        return () => {
            cancelled = true
            off()
        }
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setTick((t) => t + 1), TICK_MS)
        return () => clearInterval(timer)
    }, [])

    const live = useQuery({
        queryKey: ["journey-live", region.url, plan?.ID, tripIds.join(",")],
        queryFn: async () =>
            unwrap(api.journeyLive(tripIds, transitLegs.map((l) => l.FromStop?.stop_id ?? ""), transitLegs.map((l) => l.ToStop?.stop_id ?? ""))),
        enabled: ready && tripIds.length > 0 && region.realtime !== false,
        refetchInterval: POLL_MS,
        retry: false,
    })
    useEffect(() => {
        refetchLive.current = () => {
            if (!live.isFetching && Date.now() - live.dataUpdatedAt > POLL_MS) live.refetch().catch(() => {})
        }
    }, [live])
    const tripStops = useQueries({
        queries: tripIds.map((id) => ({ queryKey: ["trip-stops", region.url, id], queryFn: async () => (await unwrap(api.stopsForTrip(id))) ?? [], enabled: ready, staleTime: Infinity })),
    })
    const stopsByTrip: Record<string, TripStopRef[]> = {}
    tripIds.forEach((id, i) => (stopsByTrip[id] = tripStops[i]?.data ?? []))

    const [snapshot, setSnapshot] = useState<JourneyTick | null>(null)

    useEffect(() => {
        if (!plan || !active || active.planId !== plan.ID) return
        const now = new Date()
        const fix = lastFix.current
        const stopTimes: Record<string, StopTimeUpdate[]> = { ...(live.data?.stop_times ?? {}) }
        const vehicles: Record<string, Vehicle> = {}
        for (const v of live.data?.vehicles ?? []) vehicles[v.trip_id] = v

        // Set off: from GPS on the first walk.
        const first = plan.Legs[0]
        const firstRide = plan.Legs.find((l) => l.Mode === "transit")
        if (first?.Mode === "walk" && firstRide?.FromStop && detector.current && user) {
            const left = detector.current.update({ lat: plan.StartLat, lon: plan.StartLon }, { lat: firstRide.FromStop.stop_lat, lon: firstRide.FromStop.stop_lon }, user.c, user.accuracy, now)
            if (left && !active.setOffAt) setActive((a) => (a ? { ...a, setOffAt: left.getTime() } : a))
        }

        // No live vehicle for a ride: the rider's own GPS can stand in (offline or a quiet feed).
        const estimated = new Set<string>()
        for (const leg of transitLegs) {
            const stops = stopsByTrip[leg.TripID]
            if (!stops?.length) continue
            const est = estimator.estimate(leg, stops, fix, goTime(leg.DepartureTime as unknown as string), now, boardingTrip.current === leg.TripID)
            if (!est) continue
            if (vehicles[leg.TripID]) vehicles[leg.TripID] = OfflineRideEstimator.advancing(vehicles[leg.TripID], est)
            else {
                vehicles[leg.TripID] = est
                estimated.add(leg.TripID)
                const retimed = estimator.adjustedStopTimes(leg.TripID, stops, stopTimes[leg.TripID] ?? [])
                if (retimed) stopTimes[leg.TripID] = retimed
            }
        }

        const setOffAt = active.setOffAt ? new Date(active.setOffAt) : null
        const displayPlan = buildLiveJourney(plan, stopTimes, setOffAt)
        const holdAtStart = !!(user && !setOffAt && first?.Mode === "walk" && haversineMeters(user.c, { lat: plan.StartLat, lon: plan.StartLon }) < 100)
        // The stop list is the trip the previous tick tracked (iOS's one-tick lag), else the next ride.
        const trackedStops = (lastTracked.current && stopsByTrip[lastTracked.current]) || trackedStopsFor(plan, stopsByTrip, model)
        const tracked = model.update({ plan, displayPlan, now, vehiclesByTripId: vehicles, stopTimesByTripId: stopTimes, journeyStarted: true, trackedStops, userLocation: user?.c ?? null, estimatedTripIds: estimated, holdAtStart })
        lastTracked.current = tracked.trackedTripId
        boardingTrip.current = tracked.phase === "boarding" ? tracked.trackedTripId : null

        const trackedVehicle = tracked.trackedTripId ? vehicles[tracked.trackedTripId] : null
        const content = buildLiveActivityContent(displayPlan.Legs, {
            legIndex: tracked.progressLegIndex,
            phase: tracked.phase,
            arrived: tracked.journeyArrived,
            stopsAway: tracked.trackedStopsAway,
            nextStopName: trackedVehicle?.trip?.next_stop?.name ?? null,
            isRealtime: tracked.trackingLevel === "live",
            hasVehicle: !!trackedVehicle,
            occupancy: trackedVehicle && trackedVehicle.occupancy >= 0 ? trackedVehicle.occupancy : null,
            offline: !!live.error,
            setOffAt,
            stillAtStart: holdAtStart,
        }, tz, now)

        // Persist what can't be re-derived after a relaunch.
        if (model.alightedThroughLeg !== active.alightedThroughLeg || JSON.stringify(estimator.progress) !== JSON.stringify(active.rides)) {
            setActive((a) => (a ? { ...a, alightedThroughLeg: model.alightedThroughLeg, rides: estimator.progress } : a))
        }
        // iOS `watchingDeparture`: a walk first, and a fix from the last 2 min.
        const watching = first?.Mode === "walk" && !!fix && now.getTime() - fix.timestamp.getTime() <= 120_000
        const leftAt = setOffAt ? Math.floor(setOffAt.getTime() / 1000) : watching ? 0 : undefined
        setSnapshot({ displayPlan, snapshot: tracked, content, vehicles, user: user?.c ?? null, online: !live.error, lastLiveAt: live.dataUpdatedAt || null, leftAt })

        // How much GPS to use now - the SwiftUI app's JourneyGPSPolicy: precise
        // while you're looking, resting on a live-tracked ride far from your stop.
        const leg = displayPlan.Legs[Math.max(0, tracked.progressLegIndex)]
        setJourneyLocationMode(gpsMode({
            appActive: AppState.currentState === "active",
            offline: !!live.error,
            phase: tracked.phase,
            boarded: tracked.boarded,
            trackingLevel: tracked.trackingLevel,
            liveFresh: !!live.dataUpdatedAt && now.getTime() - live.dataUpdatedAt < 3 * POLL_MS,
            stopsAway: tracked.trackedStopsAway,
            alightAt: leg && leg.Mode === "transit" ? goTime(leg.ArrivalTime as unknown as string) : null,
            waitingToSetOff: !setOffAt && first?.Mode === "walk",
            leaveAt: goTime(plan.DepartureTime as unknown as string),
            now,
        })).catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, live.data, live.error, user, plan, active?.planId, active?.setOffAt, tripStops.map((q) => q.dataUpdatedAt).join(",")])

    return snapshot
}

/**
 * The stop list of the ride being tracked. The progress model takes the
 * tracked trip's stops; before the first tick names a trip, the earliest
 * ride not yet alighted is the one to watch (same one-tick lag as iOS).
 */
function trackedStopsFor(plan: JourneyType, stopsByTrip: Record<string, TripStopRef[]>, model: JourneyProgressModel): TripStopRef[] {
    const legs = plan.Legs
    for (let i = Math.max(0, model.alightedThroughLeg + 1); i < legs.length; i++) {
        if (legs[i].Mode === "transit" && legs[i].TripID) return stopsByTrip[legs[i].TripID] ?? []
    }
    return []
}

export function endJourney() {
    activeJourneyStore.set(null)
}
