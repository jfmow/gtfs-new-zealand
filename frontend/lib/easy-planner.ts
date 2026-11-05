import type { JourneyType } from "@transit/shared/types/journey"
import * as shared from "@transit/shared/easy-planner"
import { regionTimeZone } from "@/lib/url-store"

/**
 * The step-by-step planner's logic lives in the shared package
 * (packages/shared/src/easy-planner.ts), a port of the iOS app's
 * `EasyPlanner.swift`, so every app recommends the same journey in the same
 * words. These wrappers fill in the selected region's timezone.
 */

export {
    GENTLE, RELAXED, STANDARD, modesSummary, easyAttempts, recommendedPlan, rankedPlans, legMode, defaultArriveBy,
    type EasyTravelMode, type EasyPlannerOptions, type EasyAttempt, type EasyStep,
} from "@transit/shared/easy-planner"

/** "10:01 am" on the region's clock. */
export function clock(date: Date | string): string {
    return shared.clock(date, regionTimeZone())
}

/** The steps for `plan`. `destinationName` names the last walk. */
export function easySteps(plan: JourneyType, destinationName: string): shared.EasyStep[] {
    return shared.easySteps(plan, destinationName, regionTimeZone())
}
