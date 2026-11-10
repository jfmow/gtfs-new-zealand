import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { WalkNavigationTracker } from "@transit/shared/logic/basics"
import type { Coordinate, DirectionStep } from "@transit/shared/models"
import type { JourneyType } from "@transit/shared/types/journey"
import { api } from "./api"
import { unwrap } from "./queries"
import { useRegion } from "./region"

export interface WalkStep {
    step: DirectionStep
    distance: number
    arrived: boolean
}

/**
 * Turn-by-turn for whichever leg is a walk right now - iOS
 * `JourneyTrackingSession.walkDirections` + `walkStep`. Directions are fetched
 * once per walk leg (from the leg's start, so they don't refetch as you move)
 * and the shared `WalkNavigationTracker` advances through them from GPS.
 */
export function useWalkNavigation(plan: JourneyType | undefined, legIndex: number, walking: boolean, user: Coordinate | null): WalkStep | null {
    const { region, ready } = useRegion()
    const leg = plan?.Legs[legIndex]
    const isWalk = walking && leg?.Mode === "walk"
    const prev = plan?.Legs[legIndex - 1]
    const from: Coordinate | null = !isWalk || !plan ? null
        : prev?.ToStop ? { lat: prev.ToStop.stop_lat, lon: prev.ToStop.stop_lon }
            : legIndex === 0 ? { lat: plan.StartLat, lon: plan.StartLon } : leg?.FromStop ? { lat: leg.FromStop.stop_lat, lon: leg.FromStop.stop_lon } : null
    const to: Coordinate | null = !isWalk || !plan ? null
        : leg?.ToStop ? { lat: leg.ToStop.stop_lat, lon: leg.ToStop.stop_lon }
            : legIndex === plan.Legs.length - 1 ? { lat: plan.EndLat, lon: plan.EndLon } : null
    const key = `${plan?.ID}:${legIndex}`
    const directions = useQuery({
        queryKey: ["walk-nav", region.url, key],
        queryFn: async () => unwrap(api.walkingDirections(from!, to!)),
        enabled: ready && !!from && !!to,
        staleTime: Infinity,
        retry: 1,
    })
    // One tracker per walk leg - it only ever moves forward.
    const [trackers] = useState(() => new Map<string, WalkNavigationTracker>())
    const steps = directions.data?.steps ?? []
    if (!isWalk || !user || steps.length === 0) return null
    let tracker = trackers.get(key)
    if (!tracker) {
        tracker = new WalkNavigationTracker()
        trackers.set(key, tracker)
    }
    const snap = tracker.update(steps, user)
    const step = steps[snap.currentStepIndex]
    return step ? { step, distance: snap.distanceToNextManeuver, arrived: snap.arrived } : null
}
