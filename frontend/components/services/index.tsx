import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AccessibilityIcon, BikeIcon, ChevronDown, ChevronUp } from "lucide-react"
import { convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent, useIsMobile } from "@/lib/utils"
import ErrorScreen, { InfoScreen } from "../ui/error-screen"
import { DisplayTodaysAlerts } from "@/pages/alerts"
import ServicesLoadingSkeleton from "./loading-skeleton"
import { Button } from "../ui/button"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
}

export interface Service {
    trip_id: string
    headsign: string
    arrival_time: string
    platform: string
    stops_away: number
    occupancy: number
    canceled: boolean
    bikes_allowed: number
    wheelchairs_allowed: number
    route: ServicesRoute
    stop: ServicesStop
    tracking: boolean
    departed: boolean
    time_till_arrival: number
    stop_state: "Arrived" | "Departed" | "Arriving" | "Boarding"
}

export interface ServicesRoute {
    id: string
    name: string
    color: string
}

export interface ServicesStop {
    lat: number
    lon: number
    id: string
    name: string
    platform: string
    sequence: number
}

const REFRESH_INTERVAL = 10 // Refresh interval in seconds

export default function Services({ stopName, filterDate }: ServicesProps) {
    const [services, setServices] = useState<Service[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [errorTrace, setErrorTrace] = useState("")
    const [platformFilter, setPlatformFilter] = useState<string | number | "all">("all")
    const [isInitialLoading, setIsInitialLoading] = useState(true)
    const displayingSchedulePreview = filterDate ? true : false
    const [showAllPlatforms, setShowAllPlatforms] = useState(false)
    const isMobile = useIsMobile()

    const getUniquePlatforms = (services: Service[]) => {
        const platforms = services.map((service) => service.platform)
        return [...new Set(platforms)]
            .filter((i) => i !== "" && i !== undefined && i !== "no platform")
            .sort((a, b) => {
                if (!isNaN(Number(a)) && !isNaN(Number(b))) {
                    return Number(a) - Number(b)
                }
                return a.localeCompare(b)
            })
    }

    useEffect(() => {
        if (stopName === "") {
            return
        }

        setServices([])
        setPlatformFilter("all")
        setIsInitialLoading(true)

        async function fetchServices(date?: Date) {
            const req = await ApiFetch<Service[]>(
                encodeURI(
                    `/services/${fullyEncodeURIComponent(stopName)}${date ? `/schedule?date=${Math.floor(date.getTime() / 1000)}` : "?limit=20"}`,
                ),
            )
            if (req.ok) {
                setServices(req.data)
                setIsInitialLoading(false)
                setErrorMessage("")
            } else {
                setErrorTrace(req.trace_id || "")
                if (req.status_code === 404) {
                    setErrorMessage("no-services")
                } else {
                    setErrorMessage(req.error)
                    setIsInitialLoading(false)
                }
            }
        }

        let intervalId: NodeJS.Timeout | null = null

        function startAutoRefresh() {
            fetchServices(filterDate)
            if (!filterDate) {
                intervalId = setInterval(() => fetchServices(filterDate), REFRESH_INTERVAL * 1000)
            }
        }

        startAutoRefresh()

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startAutoRefresh()
            } else if (document.visibilityState === "hidden") {
                if (intervalId) {
                    clearInterval(intervalId)
                }
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange)

        // Cleanup on unmount, visibility change, or dependencies update
        return () => {
            if (intervalId) {
                clearInterval(intervalId)
            }
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
    }, [stopName, filterDate])

    if (errorMessage !== "") {
        if (errorMessage === "no-services") {
            return (
                <>
                    <DisplayTodaysAlerts stopName={stopName} forceDisplay />
                    <InfoScreen infoTitle="No Services Scheduled" infoText={`No services are scheduled for departure today at "${stopName}".`} />
                </>
            )
        }
        return <ErrorScreen traceId={errorTrace} errorTitle="Uh Oh! An error has occurred..." errorText={errorMessage} />
    }

    if (stopName === "") {
        return null
    }

    if (isInitialLoading) {
        return <div className="max-w-[1400px] w-full mx-auto p-4"><ServicesLoadingSkeleton /></div>
    }

    const uniquePlatforms = getUniquePlatforms(services)
    const shouldShowExpandButton = uniquePlatforms.length > 3 && isMobile
    const platformsToShow = shouldShowExpandButton && !showAllPlatforms ? uniquePlatforms.slice(0, 3) : uniquePlatforms

    return (
        <div className="max-w-[1400px] w-full mx-auto p-4">
            <DisplayTodaysAlerts stopName={stopName} />
            {uniquePlatforms.length > 0 ? (
                <div className="mb-3">
                    <div
                        role="tablist"
                        aria-label="Filter services by platform"
                        className="bg-card/50 backdrop-blur-sm rounded-md border shadow-sm p-3"
                    >
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            <Button
                                variant={platformFilter === "all" ? "default" : "outline"}
                                size="sm"
                                role="tab"
                                aria-selected={platformFilter === "all"}
                                aria-controls="services-list"
                                onClick={() => setPlatformFilter("all")}
                            >
                                All Platforms
                            </Button>

                            {platformsToShow.map((platform) => (
                                <Button
                                    key={platform}
                                    variant={platformFilter === platform ? "default" : "outline"}
                                    size="sm"
                                    role="tab"
                                    aria-selected={platformFilter === platform}
                                    aria-controls="services-list"
                                    onClick={() => setPlatformFilter(platform)}
                                >
                                    Platform {platform}
                                </Button>
                            ))}
                        </div>

                        {shouldShowExpandButton && (
                            <div className="flex justify-center mt-3">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                                >
                                    {showAllPlatforms ? (
                                        <>
                                            <ChevronUp className="w-3 h-3 mr-1" />
                                            Show Less
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown className="w-3 h-3 mr-1" />
                                            Show More ({uniquePlatforms.length - 3} more)
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
            <ul
                aria-label="List of services for the stop"
                className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 bg-secondary rounded-md"
            >
                {sortServices(services, platformFilter).map((service) => (
                    <li key={service.trip_id + service.platform}>
                        <Card
                            className={`
                            backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300
                            ${service.departed
                                    ? "bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-orange-950/50 dark:via-amber-950/50 dark:to-yellow-950/50 border-orange-200 dark:border-orange-800"
                                    : ""
                                } 
                            ${service.canceled
                                    ? "bg-gradient-to-br from-red-50 via-rose-50 to-pink-50 dark:from-red-950/50 dark:via-rose-950/50 dark:to-pink-950/50 border-red-200 dark:border-red-800"
                                    : ""
                                }
                            `}
                        >

                            <CardHeader>
                                <CardTitle>
                                    <div className="flex items-center justify-between overflow-hidden">
                                        <div className="line-clamp-2 text-ellipsis overflow-hidden">
                                            {service.canceled ? (
                                                <>
                                                    <span className="text-red-600 dark:text-red-400">Canceled | </span>
                                                    <span className="text-red-600 dark:text-red-400">{formatTextToNiceLookingWords(service.headsign)} </span>
                                                </>
                                            ) : (
                                                <>
                                                    {!displayingSchedulePreview && service.departed ? (
                                                        <>
                                                            <span className="text-orange-600 dark:text-orange-400">Departed | </span>
                                                            <span className="text-orange-600 dark:text-orange-400">{formatTextToNiceLookingWords(service.headsign)} </span>
                                                        </>
                                                    ) : (
                                                        <span className="text-foreground">{formatTextToNiceLookingWords(service.headsign)}</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        <div className="ml-auto flex gap-1 items-center mr-2">
                                            <BikeIcon
                                                aria-label={
                                                    service.bikes_allowed === 0
                                                        ? "Bikes might be allowed"
                                                        : service.bikes_allowed === 1
                                                            ? "Bikes are allowed"
                                                            : "Bikes are not allowed"
                                                }
                                                className={`w-4 h-4 ${service.bikes_allowed === 0
                                                    ? "text-yellow-500 dark:text-yellow-400"
                                                    : service.bikes_allowed === 1
                                                        ? "text-green-500 dark:text-green-400"
                                                        : "text-red-500 dark:text-red-400"
                                                    }`}
                                            />
                                            <AccessibilityIcon
                                                aria-label={
                                                    service.wheelchairs_allowed === 0
                                                        ? "Might not be wheelchair accessible"
                                                        : service.wheelchairs_allowed === 1
                                                            ? "Is wheelchair accessible"
                                                            : "Not Wheelchair accessible"
                                                }
                                                className={`w-4 h-4 ${service.wheelchairs_allowed === 0
                                                    ? "text-yellow-500 dark:text-yellow-400"
                                                    : service.wheelchairs_allowed === 1
                                                        ? "text-green-500 dark:text-green-400"
                                                        : "text-red-500 dark:text-red-400"
                                                    }`}
                                            />
                                        </div>
                                        <span
                                            aria-label="Service route name"
                                            className="shrink-0 px-2 py-1 rounded text-white dark:text-gray-100 text-xs font-medium"
                                            style={{
                                                background: "#" + (service.route.color !== "" ? service.route.color : "000000"),
                                                filter: "brightness(0.9) contrast(1.1)"
                                            }}
                                        >
                                            {service.route.name}
                                        </span>
                                    </div>
                                </CardTitle>

                                <CardDescription>
                                    <div className="grid grid-cols-2">
                                        <div className="grid">
                                            <p>Arriving: {convert24hTo12h(service.arrival_time)}</p>
                                            {!service.canceled && !displayingSchedulePreview && !service.departed ? (
                                                <>
                                                    <p>Stops away: {service.stops_away || 0}</p>
                                                    <p className="inline-flex gap-1 items-center">
                                                        Occupancy: <OccupancyStatusIndicator type="people" value={service.occupancy} />
                                                    </p>
                                                </>
                                            ) : null}
                                        </div>
                                        <div>
                                            {service.platform !== "" && service.platform !== "no platform" ? (
                                                <p className="text-blue-400 text-right">
                                                    Platform: <span className="font-medium">{service.platform}</span>
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                </CardDescription>
                            </CardHeader>
                            {!displayingSchedulePreview && !service.canceled && !service.departed ? (
                                <CardContent>
                                    <div className="grid grid-cols-2 items-center justify-items-center gap-2">
                                        <ServiceTrackerModal
                                            previewData={{
                                                tripHeadsign: service.headsign,
                                                route_id: service.route.id,
                                                route_name: service.route.name,
                                                trip_id: service.trip_id,
                                            }}
                                            currentStop={service.stop}
                                            loaded={true}
                                            has={service.tracking}
                                            tripId={service.trip_id}
                                        />
                                        <span aria-label="Arriving in" className={`text-center rounded-md font-medium p-1 h-full w-full`}>
                                            {service.departed ? "Departed" : (service.stops_away === 0 && service.time_till_arrival <= 1) ? "Arriving now" : `${formatArrivalTime(service.time_till_arrival)}`}
                                        </span>
                                    </div>
                                </CardContent>
                            ) : null}
                        </Card>
                    </li>
                ))}
            </ul>
            <div className="py-4 mt-2 flex flex-col gap-2 sm:gap-1">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1 items-center justify-center">
                        <BikeIcon aria-label="Bikes might be allowed icon" className={`w-4 h-4 text-yellow-500`} />
                        <small className="text-xs font-medium leading-none">Bikes might be allowed (ask)</small>
                    </div>
                    <div className="flex gap-1 items-center justify-center">
                        <BikeIcon aria-label="Bikes are allowed icon" className={`w-4 h-4 text-green-500`} />
                        <small className="text-xs font-medium leading-none">Bikes are allowed</small>
                    </div>
                    <div className="flex gap-1 items-center justify-center">
                        <BikeIcon aria-label="Bikes are not allowed icon" className={`w-4 h-4 text-red-500`} />
                        <small className="text-xs font-medium leading-none">Bikes are not allowed</small>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1 items-center justify-center">
                        <AccessibilityIcon
                            aria-label="Might not be wheelchair accessible icon"
                            className={`w-4 h-4 text-yellow-500`}
                        />
                        <small className="text-xs font-medium leading-none">Might not be wheelchair accessible (ask)</small>
                    </div>
                    <div className="flex gap-1 items-center justify-center">
                        <AccessibilityIcon aria-label="Is wheelchair accessible icon" className={`w-4 h-4 text-green-500`} />
                        <small className="text-xs font-medium leading-none">Is wheelchair accessible</small>
                    </div>
                    <div className="flex gap-1 items-center justify-center">
                        <AccessibilityIcon aria-label="Is not wheelchair accessible icon" className={`w-4 h-4 text-red-500`} />
                        <small className="text-xs font-medium leading-none">Is not wheelchair accessible</small>
                    </div>
                </div>
            </div>
        </div>
    )
}

function sortServices(
    services: Service[],
    platformFilter: string | number | undefined,
) {

    return services
        .filter(item =>
            platformFilter === "all" || item.platform === platformFilter
        )
        .filter((item) => item.time_till_arrival >= -2)
        .sort((a, b) => {
            // Departed services first, still ordered by arrival time within each group
            if (a.departed && !b.departed) return -1;
            if (!a.departed && b.departed) return 1;
            return timeTillArrival(a.arrival_time) - timeTillArrival(b.arrival_time);
        })
}

function formatArrivalTime(minutes: number): string {
    if (minutes <= 0.5) return 'Arriving now';

    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);

    if (hours > 0 && mins > 0) return `${hours}h ${mins}min`;
    if (hours > 0) return `${hours}h`;
    return `${mins}min`;
}
