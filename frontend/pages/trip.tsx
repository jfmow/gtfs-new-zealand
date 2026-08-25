import { useEffect, useState } from "react"
import { Header } from "@/components/nav"
import { useQueryParams } from "@/lib/url-params"
import { useServiceTracker, ServiceTrackerProvider } from "@/components/services/tracker/use-service-tracker"
import ServiceTrackerContent from "@/components/services/tracker/body"
import StopsList from "@/components/services/tracker/stops-list"
import LoadingSpinner from "@/components/loading-spinner"
import ErrorScreen from "@/components/ui/error-screen"
import { getUrlOptionBySlug, urlStore } from "@/lib/url-store"

/**
 * Static page (not a Next.js dynamic route) keyed by query params, matching this
 * app's existing convention of query-param-driven state on fixed pathnames.
 * `region` seeds the region store so a link opened on a fresh device/session
 * hits the right region's API without depending on that browser's localStorage.
 */
export default function TripPage() {
    const { tripId, region } = useQueryParams({
        tripId: { type: "string", default: "" },
        region: { type: "string", default: "" },
    })
    const [regionResolved, setRegionResolved] = useState(false)

    useEffect(() => {
        if (region.found && region.value) {
            const option = getUrlOptionBySlug(region.value)
            if (option) {
                urlStore.currentUrl = option
            }
        }
        setRegionResolved(true)
    }, [region.found, region.value])

    const active = regionResolved && tripId.value !== ""
    const { stops, stopTimes, vehicle, initialLoading, refreshing } = useServiceTracker(tripId.value, true, active)

    if (!tripId.found || !tripId.value) {
        return (
            <>
                <Header title="Trip" />
                <ErrorScreen errorTitle="No trip specified" errorText="This link is missing a trip id." />
            </>
        )
    }

    return (
        <>
            <Header title="Trip" />
            <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-4">
                {!regionResolved || initialLoading ? (
                    <LoadingSpinner description="Loading trip..." height="60vh" />
                ) : vehicle ? (
                    <ServiceTrackerProvider
                        value={{ vehicle, stops, stopTimes, tripId: tripId.value, refreshing }}
                    >
                        <ServiceTrackerContent />
                    </ServiceTrackerProvider>
                ) : stops ? (
                    <div className="space-y-3">
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                            This vehicle isn&apos;t currently live-tracked (the trip may have ended). Showing its scheduled stops.
                        </div>
                        <StopsList tripId={tripId.value} stops={stops} stopTimes={stopTimes} />
                    </div>
                ) : (
                    <ErrorScreen errorTitle="Trip not found" errorText="This trip couldn't be found - the link may have expired." />
                )}
            </div>
        </>
    )
}
