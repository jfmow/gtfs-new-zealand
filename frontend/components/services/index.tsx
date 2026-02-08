import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AccessibilityIcon, BadgeInfo, BadgeInfoIcon, BikeIcon, ChevronDown, ChevronUp } from "lucide-react"
import { convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"
import { ApiFetch } from "@/lib/url-context"
import { fullyEncodeURIComponent, useIsMobile } from "@/lib/utils"
import ErrorScreen, { InfoScreen } from "../ui/error-screen"
import { DisplayTodaysAlerts } from "@/pages/alerts"
import ServicesLoadingSkeleton from "./loading-skeleton"
import { Button } from "../ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"

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
    skipped: boolean
    bikes_allowed: number
    wheelchairs_allowed: number
    route: ServicesRoute
    stop: ServicesStop
    trip_update_tracking: boolean
    location_tracking: boolean
    departed: boolean
    time_till_arrival: number
    stop_state: "Arrived" | "Departed" | "Arriving" | "Boarding"
    platform_changed: boolean
    trip_started: boolean
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
                    `/services/${fullyEncodeURIComponent(stopName)}${date ? `/schedule?date=${Math.floor(date.getTime() / 1000)}` : "?limit=100"}`,
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
                    <InfoScreen
                        infoTitle="No Services Scheduled"
                        infoText={`No services are scheduled at "${stopName}".`}
                    />
                </>
            )
        }
        return <ErrorScreen traceId={errorTrace} errorTitle="An error has occurred" errorText={errorMessage} />
    }

    if (stopName === "") {
        return null
    }

    if (isInitialLoading) {
        return (
            <div className="max-w-[1400px] w-full mx-auto p-4">
                <ServicesLoadingSkeleton />
            </div>
        )
    }

    const uniquePlatforms = getUniquePlatforms(services)
    const shouldShowExpandButton = uniquePlatforms.length > 3 && isMobile
    const platformsToShow = shouldShowExpandButton && !showAllPlatforms ? uniquePlatforms.slice(0, 3) : uniquePlatforms

    return (
        <div className="max-w-[1400px] w-full mx-auto px-4 pb-8">
            {uniquePlatforms.length > 1 && (
                <section className="mb-6" aria-labelledby="platform-filter-heading">
                    <h2 id="platform-filter-heading" className="sr-only">
                        Filter services by platform
                    </h2>
                    <div role="tablist" aria-label="Platform filters" className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            <Button
                                variant={platformFilter === "all" ? "default" : "outline"}
                                size="sm"
                                role="tab"
                                aria-selected={platformFilter === "all"}
                                aria-controls="services-list"
                                onClick={() => setPlatformFilter("all")}
                                className="w-full transition-colors duration-200"
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
                                    className="w-full transition-colors duration-200"
                                >
                                    Platform {platform}
                                </Button>
                            ))}
                        </div>

                        {shouldShowExpandButton && (
                            <div className="flex justify-center">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                                    aria-expanded={showAllPlatforms}
                                    aria-label={
                                        showAllPlatforms ? "Show fewer platforms" : `Show ${uniquePlatforms.length - 3} more platforms`
                                    }
                                    className="transition-colors duration-200"
                                >
                                    {showAllPlatforms ? (
                                        <>
                                            <ChevronUp className="w-4 h-4 mr-2" aria-hidden="true" />
                                            Show Less
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown className="w-4 h-4 mr-2" aria-hidden="true" />
                                            Show {uniquePlatforms.length - 3} More
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </section>
            )}

            <section aria-labelledby="services-heading">
                <h2 id="services-heading" className="sr-only">
                    Available services
                </h2>
                <ul
                    id="services-list"
                    role="list"
                    aria-live="polite"
                    aria-atomic="false"
                    className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                >
                    <AnimatePresence mode="popLayout">
                        {sortServices(services, platformFilter).map((service, index) => (
                            <motion.li
                                key={service.trip_id + service.platform}
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{
                                    duration: 0.2,
                                    delay: Math.min(index * 0.03, 0.3),
                                    layout: { duration: 0.3 },
                                }}
                            >
                                <Card
                                    className={`
                    h-full backdrop-blur-sm shadow-md hover:shadow-xl transition-shadow duration-300
                    ${service.departed
                                            ? "bg-orange-50/80 dark:bg-orange-950/30 border-orange-300 dark:border-orange-800"
                                            : ""
                                        } 
                    ${service.canceled ? "bg-red-50/80 dark:bg-red-950/30 border-red-300 dark:border-red-800" : ""}
                    ${service.skipped ? "bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800" : ""}
                  `}
                                    role="article"
                                    aria-label={`${service.route.name} service to ${formatTextToNiceLookingWords(service.headsign)}`}
                                >
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    {service.canceled ? (
                                                        <span className="text-red-700 dark:text-red-300 font-semibold text-balance">
                                                            <span className="sr-only">Service canceled: </span>
                                                            Canceled | {formatTextToNiceLookingWords(service.headsign)}
                                                        </span>
                                                    ) : service.skipped ? (
                                                        <span className="text-blue-700 dark:text-blue-300 font-semibold text-balance">
                                                            <span className="sr-only">Service skipped: </span>
                                                            Skipped | {formatTextToNiceLookingWords(service.headsign)}
                                                        </span>
                                                    ) : service.departed && !displayingSchedulePreview ? (
                                                        <span className="text-orange-700 dark:text-orange-300 font-semibold text-balance">
                                                            <span className="sr-only">Service departed: </span>
                                                            Departed | {formatTextToNiceLookingWords(service.headsign)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-foreground font-semibold text-balance">
                                                            {formatTextToNiceLookingWords(service.headsign)}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex gap-2 items-center shrink-0">
                                                    <BikeIcon
                                                        aria-label={
                                                            service.bikes_allowed === 0
                                                                ? "Bikes might be allowed, please ask"
                                                                : service.bikes_allowed === 1
                                                                    ? "Bikes are allowed on this service"
                                                                    : "Bikes are not allowed on this service"
                                                        }
                                                        className={`w-5 h-5 ${service.bikes_allowed === 0
                                                            ? "text-yellow-600 dark:text-yellow-400"
                                                            : service.bikes_allowed === 1
                                                                ? "text-green-600 dark:text-green-400"
                                                                : "text-red-600 dark:text-red-400"
                                                            }`}
                                                    />
                                                    <AccessibilityIcon
                                                        aria-label={
                                                            service.wheelchairs_allowed === 0
                                                                ? "Wheelchair accessibility unknown, please ask"
                                                                : service.wheelchairs_allowed === 1
                                                                    ? "This service is wheelchair accessible"
                                                                    : "This service is not wheelchair accessible"
                                                        }
                                                        className={`w-5 h-5 ${service.wheelchairs_allowed === 0
                                                            ? "text-yellow-600 dark:text-yellow-400"
                                                            : service.wheelchairs_allowed === 1
                                                                ? "text-green-600 dark:text-green-400"
                                                                : "text-red-600 dark:text-red-400"
                                                            }`}
                                                    />
                                                    <span
                                                        aria-label="Service route name"
                                                        className="shrink-0 px-2 py-1 rounded text-white dark:text-gray-100 text-xs font-medium"
                                                        style={{
                                                            background: "#" + (service.route.color !== "" ? service.route.color : "424242"),
                                                            filter: "brightness(0.9) contrast(1.1)",
                                                        }}
                                                    >
                                                        {service.route.name}
                                                    </span>
                                                    {service.trip_update_tracking && !service.location_tracking && service.trip_started && (
                                                        <TooltipProvider>
                                                            <Tooltip delayDuration={0}>
                                                                <TooltipTrigger>
                                                                    <BadgeInfo className="w-4 h-4" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>Partial service updates available</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </div>
                                            </div>
                                        </CardTitle>

                                        <CardDescription className="text-sm">
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                <div className="space-y-1">
                                                    {service.platform_changed && (
                                                        <p className="font-semibold text-red-600 dark:text-red-400 text-xs uppercase tracking-wide">
                                                            Platform Changed
                                                        </p>
                                                    )}
                                                    <p className="font-medium">
                                                        <span className="text-muted-foreground">{service.skipped ? "Passing by" : "Arriving"}:</span>{" "}
                                                        <time dateTime={service.arrival_time}>{convert24hTo12h(service.arrival_time)}</time>
                                                    </p>
                                                    {!service.canceled && !service.skipped && !displayingSchedulePreview && !service.departed && (
                                                        <>
                                                            <p>
                                                                <span className="text-muted-foreground">Stops away:</span>{" "}
                                                                <span className="font-medium">{service.stops_away || 0}</span>
                                                            </p>
                                                            {service.occupancy > 0 ? (
                                                                <>
                                                                    <p className="inline-flex gap-1.5 items-center">
                                                                        <span className="text-muted-foreground">Occupancy:</span>
                                                                        <OccupancyStatusIndicator value={service.occupancy} type="people" />
                                                                    </p>
                                                                </>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </div>
                                                <div className="text-right">
                                                    {service.platform !== "" && service.platform !== "no platform" && (
                                                        <p className="text-blue-600 dark:text-blue-400 font-medium">
                                                            Platform <span className="text-lg font-bold">{service.platform}</span>
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </CardDescription>
                                    </CardHeader>

                                    {!displayingSchedulePreview && (
                                        <CardContent className={`pt-0 ${service.canceled || service.departed || service.skipped ? "hidden" : ""}`}>
                                            <div className="grid grid-cols-2 items-stretch gap-2">
                                                <ServiceTrackerModal
                                                    previewData={{
                                                        tripHeadsign: service.headsign,
                                                        route_id: service.route.id,
                                                        route_name: service.route.name,
                                                        trip_id: service.trip_id,
                                                        route_color: service.route.color
                                                    }}
                                                    currentStop={service.stop}
                                                    loaded={true}
                                                    has={service.location_tracking}
                                                    tripId={service.trip_id}
                                                />
                                                <div
                                                    className="flex items-center justify-center text-center rounded-md font-semibold p-1 bg-primary/10 text-primary border border-primary/20"
                                                    aria-label={`Arriving in ${formatArrivalTime(service.time_till_arrival)}`}
                                                >
                                                    {service.departed
                                                        ? "Departed"
                                                        : service.stops_away === 0 && service.time_till_arrival <= 1
                                                            ? "Arriving now"
                                                            : formatArrivalTime(service.time_till_arrival)}
                                                </div>
                                            </div>
                                        </CardContent>
                                    )}
                                </Card>
                            </motion.li>
                        ))}
                    </AnimatePresence>
                </ul>
            </section>

            <footer className="mt-8 pt-6 border-t border-border" aria-labelledby="legend-heading">
                <h2 id="legend-heading" className="sr-only">
                    Service information legend
                </h2>
                <div className="space-y-4">
                    <div className="flex items-center gap-1">
                        <BadgeInfoIcon className="w-4 h-4" />
                        <p className="text-sm text-muted-foreground font-medium">Tracking data is incomplete, but service is updating.</p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <h3 className="text-sm font-semibold mb-2 text-foreground">Bicycle Access</h3>
                            <ul className="space-y-2">
                                <li className="flex gap-2 items-center">
                                    <BikeIcon aria-hidden="true" className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                                    <span className="text-sm text-muted-foreground">Bikes are allowed</span>
                                </li>
                                <li className="flex gap-2 items-center">
                                    <BikeIcon aria-hidden="true" className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                                    <span className="text-sm text-muted-foreground">Bikes might be allowed</span>
                                </li>
                                <li className="flex gap-2 items-center">
                                    <BikeIcon aria-hidden="true" className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                                    <span className="text-sm text-muted-foreground">Bikes are not allowed</span>
                                </li>
                            </ul>
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold mb-2 text-foreground">Wheelchair Accessibility</h3>
                            <ul className="space-y-2">
                                <li className="flex gap-2 items-center">
                                    <AccessibilityIcon
                                        aria-hidden="true"
                                        className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0"
                                    />
                                    <span className="text-sm text-muted-foreground">Wheelchair accessible</span>
                                </li>
                                <li className="flex gap-2 items-center">
                                    <AccessibilityIcon
                                        aria-hidden="true"
                                        className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0"
                                    />
                                    <span className="text-sm text-muted-foreground">Accessibility unknown</span>
                                </li>
                                <li className="flex gap-2 items-center">
                                    <AccessibilityIcon aria-hidden="true" className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                                    <span className="text-sm text-muted-foreground">Not wheelchair accessible</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    )
}

function sortServices(services: Service[], platformFilter: string | number | undefined) {
    return services
        .filter((item) => platformFilter === "all" || item.platform === platformFilter)
        .filter((item) => item.time_till_arrival >= -2)
        .sort((a, b) => {
            // Departed services first, still ordered by arrival time within each group
            if (!a.canceled && !b.canceled) {
                if (a.departed && !b.departed) return -1
                if (!a.departed && b.departed) return 1
            }
            return timeTillArrival(a.arrival_time) - timeTillArrival(b.arrival_time)
        })
}

function formatArrivalTime(minutes: number): string {
    if (minutes <= 0.5) return "now"

    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)

    if (hours > 0 && mins > 0) return `${hours}h ${mins}min`
    if (hours > 0) return `${hours}h`
    return `${mins}min`
}
