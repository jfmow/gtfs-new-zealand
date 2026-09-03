import { useCallback, useEffect, useRef, useState } from "react"
import { haversineDistance } from "@/lib/utils"
import { findStopSequence } from "./helpers"
import type { JourneyType, Leg, Stop } from "./types"
import type { ServicesStop, VehiclesResponse } from "@/components/services/tracker"

/**
 * Fires one-shot, centered in-app alert cards (see JourneyAlertOverlay), plus a
 * system notification when the tab is backgrounded and permission is granted,
 * for the events a rider being live-tracked on a journey actually cares about:
 * the bus is a stop away, get on now, your stop is next, get off here, transfer
 * on foot, you've arrived.
 *
 * Every distinct event fires at most once per journey - keyed by the leg's trip
 * id so a multi-leg journey still gets a fresh set of alerts for each leg - and
 * the whole fired-set is reset when a different route is selected.
 */

export type JourneyAlertVariant = "info" | "action" | "success" | "error"

export interface JourneyAlert {
    /** Unique per firing - used as the React key and for dismissal. */
    id: string
    variant: JourneyAlertVariant
    title: string
    body?: string
    /** How long before it auto-dismisses, ms - also drives the timer bar. */
    duration: number
}

interface JourneyAlertsParams {
    /** Tracking is live (GO tapped) and the sheet is open. */
    active: boolean
    route: JourneyType | null
    trackedVehicle: VehiclesResponse | undefined
    /** The tracked vehicle's full stop list - the trustworthy source of stop_sequence. */
    trackedStops: ServicesStop[] | null
    /** The rider's board/alight stops for the leg currently being tracked. */
    trackedBoardStop: Stop | undefined
    trackedAlightStop: Stop | undefined
    /** The journey leg currently being tracked (the transit leg the rider is on / about to board). */
    trackedLeg: Leg | undefined
    /** The tracked vehicle has already carried the rider past their boarding stop. */
    boarded: boolean
    /** Every leg's (live) arrival is in the past - the rider is at their destination. */
    journeyArrived: boolean
    /** A downstream connection has become unmakeable. */
    replanUrgent: boolean
    /** Destination label for the "arrived" alert. */
    endLabel?: string
}

const ALERT_DURATION_MS = 9000
/** Attention-grabbing alerts stay up longer and buzz the phone. */
const URGENT_DURATION_MS = 15000
/** Cap the on-screen stack; oldest falls off. */
const MAX_STACK = 3
/**
 * How close (metres) the vehicle must be to the rider's alight stop - with that
 * stop as its next stop - before the "this is your stop" alert fires. Tuned so
 * the alert lands while the vehicle is pulling in, not once it has left again.
 */
const NEAR_ALIGHT_M = 350

function routeName(leg: Leg | undefined): string {
    return leg?.Route?.route_short_name || leg?.RouteID || "service"
}

/** True once at least one earlier leg is a transit leg - i.e. reaching `leg` means a transfer. */
function isTransfer(route: JourneyType, leg: Leg): boolean {
    const idx = route.Legs.indexOf(leg)
    return idx > 0 && route.Legs.slice(0, idx).some((l) => l.Mode === "transit")
}

export function useJourneyAlerts({
    active,
    route,
    trackedVehicle,
    trackedStops,
    trackedBoardStop,
    trackedAlightStop,
    trackedLeg,
    boarded,
    journeyArrived,
    replanUrgent,
    endLabel,
}: JourneyAlertsParams) {
    const [alerts, setAlerts] = useState<JourneyAlert[]>([])
    const firedRef = useRef<Set<string>>(new Set())
    const idRef = useRef(0)
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    const dismiss = useCallback((id: string) => {
        setAlerts((prev) => prev.filter((a) => a.id !== id))
        const t = timersRef.current.get(id)
        if (t) {
            clearTimeout(t)
            timersRef.current.delete(id)
        }
    }, [])

    const dismissAll = useCallback(() => {
        setAlerts([])
        timersRef.current.forEach(clearTimeout)
        timersRef.current.clear()
    }, [])

    // New journey - forget everything fired for (and shown from) the previous one.
    useEffect(() => {
        firedRef.current = new Set()
        dismissAll()
    }, [route?.ID, dismissAll])

    // Clear every pending auto-dismiss timer on unmount.
    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(clearTimeout)
            timers.clear()
        }
    }, [])

    const fire = useRef((key: string, variant: JourneyAlertVariant, title: string, body?: string) => {
        if (firedRef.current.has(key)) return
        firedRef.current.add(key)

        const urgent = variant === "action" || variant === "error"
        const duration = urgent ? URGENT_DURATION_MS : ALERT_DURATION_MS
        const id = String(++idRef.current)

        setAlerts((prev) => [...prev, { id, variant, title, body, duration }].slice(-MAX_STACK))
        timersRef.current.set(id, setTimeout(() => dismiss(id), duration))

        if (urgent && typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate?.([120, 60, 120])
        }

        // When the app is backgrounded, a card the rider can't see is no use -
        // surface a real notification instead (best-effort; polling is paused
        // while hidden, so this lands on the first tick after they look away).
        if (
            typeof document !== "undefined" &&
            document.visibilityState === "hidden" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            "serviceWorker" in navigator
        ) {
            navigator.serviceWorker
                .getRegistration("/pwa/sw.js")
                .then((reg) => reg?.showNotification(title, {
                    body,
                    tag: key,
                    icon: "/pwa/icon512_rounded.png",
                    badge: "/pwa/icon512_rounded.png",
                }))
                .catch(() => { })
        }
    }).current

    useEffect(() => {
        if (!active || !route) return

        // --- Whole-journey events ---
        if (journeyArrived) {
            fire("journey:arrived", "success", "You've arrived", endLabel ? `Welcome to ${endLabel}.` : undefined)
        }
        if (replanUrgent) {
            fire(
                "journey:missed-connection",
                "error",
                "You're likely to miss a connection",
                "Tap “Find a better route from here” for other options.",
            )
        }

        // --- Per-leg vehicle-position events ---
        if (!trackedLeg || !trackedVehicle) return

        const tripId = trackedLeg.TripID
        const boardSeq = findStopSequence(trackedStops, trackedBoardStop)
        const alightSeq = findStopSequence(trackedStops, trackedAlightStop)
        const curSeq = trackedVehicle.trip?.current_stop?.sequence
        const nextSeq = trackedVehicle.trip?.next_stop?.sequence
        const name = routeName(trackedLeg)

        // Transfer nudge - the rider has just been handed onto a later leg on
        // foot (previous leg alighted), before that leg's vehicle is even near.
        if (!boarded && isTransfer(route, trackedLeg) && trackedBoardStop) {
            fire(
                `${tripId}:transfer`,
                "info",
                `Transfer to the ${name}`,
                `Make your way to ${trackedBoardStop.stop_name}${trackedBoardStop.platform_number ? ` (platform ${trackedBoardStop.platform_number})` : ""}.`,
            )
        }

        // Approaching / at the boarding stop.
        if (!boarded && boardSeq !== undefined) {
            if (nextSeq !== undefined && nextSeq === boardSeq) {
                fire(
                    `${tripId}:board-soon`,
                    "info",
                    `The ${name} is one stop away`,
                    trackedBoardStop ? `Get ready to board at ${trackedBoardStop.stop_name}.` : "Get ready to board.",
                )
            }
            if (curSeq !== undefined && curSeq === boardSeq) {
                fire(
                    `${tripId}:board-now`,
                    "action",
                    `Get on the ${name} now`,
                    trackedBoardStop ? `It's at ${trackedBoardStop.stop_name}.` : undefined,
                )
            }
        }

        // Approaching / at the alighting stop.
        if (boarded && alightSeq !== undefined) {
            const nextIsAlight = nextSeq !== undefined && nextSeq === alightSeq
            const atOrPast = curSeq !== undefined && curSeq >= alightSeq
            const metresToAlight = trackedAlightStop
                ? haversineDistance(
                    trackedVehicle.position.lat,
                    trackedVehicle.position.lon,
                    trackedAlightStop.stop_lat,
                    trackedAlightStop.stop_lon,
                )
                : Infinity
            // "Get off" fires while the vehicle is pulling in - its next stop is
            // yours and it's physically close now - or once it's there / just
            // past (a fallback if the approach poll was missed). Not a stop later.
            const arriving = (nextIsAlight && metresToAlight <= NEAR_ALIGHT_M) || atOrPast

            // The earlier heads-up only while the stop is genuinely still a stop
            // away - skipped when "arriving" already covers it (close stops).
            if (nextIsAlight && !arriving) {
                fire(
                    `${tripId}:alight-soon`,
                    "action",
                    "Your stop is next",
                    trackedAlightStop ? `Get ready to get off the ${name} at ${trackedAlightStop.stop_name}.` : `Get ready to get off the ${name}.`,
                )
            }
            if (arriving) {
                fire(
                    `${tripId}:alight-now`,
                    "action",
                    "This is your stop",
                    trackedAlightStop ? `Get off the ${name} here — ${trackedAlightStop.stop_name}.` : `Get off the ${name} here.`,
                )
            }
        }
    }, [
        active,
        route,
        trackedVehicle,
        trackedStops,
        trackedBoardStop,
        trackedAlightStop,
        trackedLeg,
        boarded,
        journeyArrived,
        replanUrgent,
        endLabel,
        fire,
    ])

    return { alerts, dismiss, dismissAll }
}
