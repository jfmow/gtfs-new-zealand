import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/router"
import { Header } from "@/components/nav"
import { useQueryParams } from "@/lib/url-params"
import { ApiFetch } from "@/lib/url-context"
import { getRegionSlug, getUrlOptionBySlug, urlStore } from "@/lib/url-store"
import LoadingSpinner from "@/components/loading-spinner"
import ErrorScreen from "@/components/ui/error-screen"
import { Button } from "@/components/ui/button"
import { RouteDetailSheet } from "@/components/journey/route-detail-sheet"
import { JourneyErrorBoundary } from "@/components/journey/journey-error-boundary"
import { LeaveReminderDialog } from "@/components/journey/leave-reminder-dialog"
import type { JourneyType, Location } from "@/components/journey/types"

/**
 * Dedicated full-screen view for one journey, opened by a share link or a
 * "resume / when to leave" notification - `/journey?id=<plan uuid>`. The plan is
 * fetched by id from the durable plan store, so the link is just the id (no
 * start/end/date blob) and the planner's search form + results list aren't shown.
 */
export default function JourneyPage() {
    const router = useRouter()
    const { id, region } = useQueryParams({
        id: { type: "string", default: "" },
        region: { type: "string", default: "" },
    })

    const [regionResolved, setRegionResolved] = useState(false)
    const [route, setRoute] = useState<JourneyType | null>(null)
    const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading")
    const [startLocation, setStartLocation] = useState<Location | null>(null)
    const [endLocation, setEndLocation] = useState<Location | null>(null)
    const [leaveReminderOpen, setLeaveReminderOpen] = useState(false)

    // Seed the region store from the link so a fresh device hits the right
    // realtime feed (the plan store itself is shared across regions).
    useEffect(() => {
        if (region.found && region.value) {
            const option = getUrlOptionBySlug(region.value)
            if (option) urlStore.currentUrl = option
        }
        setRegionResolved(true)
    }, [region.found, region.value])

    useEffect(() => {
        if (!regionResolved || !id.value) return
        let cancelled = false
        setStatus("loading")
        ApiFetch<JourneyType[]>(`/services/plan/${encodeURIComponent(id.value)}`).then((res) => {
            if (cancelled) return
            if (res.ok && res.data.length > 0) {
                const r = res.data[0]
                setRoute(r)
                setStartLocation({ lat: r.StartLat, lon: r.StartLon, label: "Start" })
                setEndLocation({ lat: r.EndLat, lon: r.EndLon, label: "Destination" })
                setStatus("ok")
            } else {
                setStatus("notfound")
            }
        })
        return () => { cancelled = true }
    }, [regionResolved, id.value])

    // Fill in real place names for the labels (best-effort - the plan store keeps
    // coordinates, not the names the searcher typed).
    useEffect(() => {
        if (!route) return
        let cancelled = false
        const label = async (lat: number, lon: number, fallback: string) => {
            try {
                const res = await ApiFetch<{ name: string }>(`/map/reverse?lat=${lat}&lon=${lon}`)
                return res.ok && res.data.name ? res.data.name : fallback
            } catch {
                return fallback
            }
        }
        Promise.all([
            label(route.StartLat, route.StartLon, "Start"),
            label(route.EndLat, route.EndLon, "Destination"),
        ]).then(([s, e]) => {
            if (cancelled) return
            setStartLocation({ lat: route.StartLat, lon: route.StartLon, label: s })
            setEndLocation({ lat: route.EndLat, lon: route.EndLon, label: e })
        })
        return () => { cancelled = true }
    }, [route])

    const regionSlug = region.value || getRegionSlug(urlStore.currentUrl)

    const sharePath = useCallback((r: JourneyType) =>
        `/journey?id=${encodeURIComponent(r.ID)}${regionSlug ? `&region=${regionSlug}` : ""}`, [regionSlug])

    const buildShareUrl = useCallback((r: JourneyType) => {
        if (typeof window === "undefined") return ""
        return `${window.location.origin}${sharePath(r)}`
    }, [sharePath])

    // "See other options" / mid-journey replan both drop back into the full
    // planner, pre-filled from this journey.
    const toPlanner = useCallback((extra: Record<string, string> = {}) => {
        if (!route) return
        const params = new URLSearchParams({
            startLat: String(route.StartLat),
            startLon: String(route.StartLon),
            startLabel: startLocation?.label ?? "Start",
            endLat: String(route.EndLat),
            endLon: String(route.EndLon),
            endLabel: endLocation?.label ?? "Destination",
            ...extra,
        })
        router.push(`/plan?${params.toString()}`)
    }, [route, startLocation, endLocation, router])

    const requestContext = useMemo(() => ({
        startLocation,
        endLocation,
        maxWalkKm: "1",
        walkSpeed: "4.8",
        maxTransfers: "5",
        timeType: "leaveat" as const,
        selectedDate: route ? new Date(route.DepartureTime) : new Date(),
    }), [startLocation, endLocation, route])

    if (router.isReady && (!id.found || !id.value)) {
        return (
            <>
                <Header title="Journey" />
                <ErrorScreen errorTitle="No journey specified" errorText="This link is missing a journey id." />
            </>
        )
    }

    if (!router.isReady || !regionResolved || status === "loading") {
        return (
            <>
                <Header title="Journey" />
                <LoadingSpinner description="Loading journey..." height="60vh" />
            </>
        )
    }

    if (status === "notfound" || !route) {
        return (
            <>
                <Header title="Journey" />
                <ErrorScreen
                    errorTitle="This journey link has expired"
                    errorText="Shared journeys are kept until a while after they arrive. Plan the trip again to get fresh times."
                />
                <div className="flex justify-center pb-8">
                    <Button variant="outline" onClick={() => router.push("/plan")}>Open the planner</Button>
                </div>
            </>
        )
    }

    return (
        <>
            <Header title="Journey" />
            <JourneyErrorBoundary resetKey={route.ID}>
                <RouteDetailSheet
                    open
                    onOpenChange={(o) => { if (!o) router.push("/plan") }}
                    route={route}
                    startLocation={startLocation}
                    endLocation={endLocation}
                    buildShareUrl={buildShareUrl}
                    onShowAlternates={() => toPlanner({ timeType: "leaveat", date: new Date(route.DepartureTime).toISOString() })}
                    onReplanFromHere={(origin, departAt) => toPlanner({
                        startLat: String(origin.lat),
                        startLon: String(origin.lon),
                        startLabel: origin.label,
                        timeType: "leaveat",
                        date: departAt.toISOString(),
                    })}
                    autoTrack
                    onRemindToLeave={() => setLeaveReminderOpen(true)}
                />
            </JourneyErrorBoundary>

            <LeaveReminderDialog
                open={leaveReminderOpen}
                onOpenChange={setLeaveReminderOpen}
                route={route}
                deeplink={sharePath(route)}
                requestContext={requestContext}
            />
        </>
    )
}
