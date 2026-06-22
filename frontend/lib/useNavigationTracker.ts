import { useCallback, useRef, useState } from "react"
import type { DirectionStep } from "@/components/map/navigate"
import { haversineDistance } from "./utils"

const ARRIVAL_THRESHOLD_M = 25

interface NavigationTrackerResult {
    currentStepIndex: number
    distanceToNextManeuver: number
    isFollowing: boolean
    setIsFollowing: (v: boolean) => void
    handleLocationUpdate: (lat: number, lon: number) => void
    arrived: boolean
}

export function useNavigationTracker(
    steps: DirectionStep[] | undefined
): NavigationTrackerResult {
    const [currentStepIndex, setCurrentStepIndex] = useState(0)
    const [distanceToNextManeuver, setDistanceToNextManeuver] = useState(0)
    const [isFollowing, setIsFollowing] = useState(true)
    const [arrived, setArrived] = useState(false)

    const currentStepRef = useRef(0)

    const handleLocationUpdate = useCallback((lat: number, lon: number) => {
        if (!steps || steps.length === 0 || arrived) return

        const idx = currentStepRef.current

        for (let i = idx; i < steps.length; i++) {
            const step = steps[i]
            if (step.lat === 0 && step.lon === 0) continue

            const dist = haversineDistance(lat, lon, step.lat, step.lon)

            if (dist < ARRIVAL_THRESHOLD_M) {
                if (step.type === "arrive") {
                    setArrived(true)
                    setCurrentStepIndex(i)
                    currentStepRef.current = i
                    setDistanceToNextManeuver(0)
                    return
                }

                const nextIdx = Math.min(i + 1, steps.length - 1)
                if (nextIdx > idx) {
                    setCurrentStepIndex(nextIdx)
                    currentStepRef.current = nextIdx
                }
                break
            }
        }

        const target = steps[currentStepRef.current]
        if (target && (target.lat !== 0 || target.lon !== 0)) {
            setDistanceToNextManeuver(haversineDistance(lat, lon, target.lat, target.lon))
        }
    }, [steps, arrived])

    return {
        currentStepIndex,
        distanceToNextManeuver,
        isFollowing,
        setIsFollowing,
        handleLocationUpdate,
        arrived,
    }
}
