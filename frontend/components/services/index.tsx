import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AccessibilityIcon, BikeIcon } from "lucide-react"
import type { TrainsApiResponse } from "./types"
import { convert24hTo12h, formatTextToNiceLookingWords, timeTillArrival } from "@/lib/formating"
import OccupancyStatusIndicator from "./occupancy"
import ServiceTrackerModal from "./tracker"
import { urlStore } from "@/lib/url-store"
import { ApiFetch } from "@/lib/url-context"
import { Button } from "../ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { fullyEncodeURIComponent } from "@/lib/utils"
import ErrorScreen from "../ui/error-screen"

interface ServicesProps {
    stopName: string
    filterDate: Date | undefined
}

interface Service {
    time: number
    type: "service" | "realtime" // "initial" or "update"

    trip_id: string
    headsign: string
    arrival_time: string
    platform: string
    stops_away: number
    occupancy: number
    canceled?: boolean
    bikes_allowed: number
    wheelchairs_allowed: number

    route: ServicesRoute

    tracking: 0 | 1 | 2

    stop: ServicesStop

    departed?: boolean
    time_till_arrival?: number
}

interface ServicesRoute {
    id: string
    name: string
    color: string
}

interface ServicesStop {
    id: string
    lat: number
    lon: number
    name: string
}

export default function Services({ stopName, filterDate }: ServicesProps) {
    const { url } = urlStore.currentUrl
    const [services, setServices] = useState<Service[]>([])
    const [errorMessage, setErrorMessage] = useState("")
    const [platformFilter, setPlatformFilter] = useState<string | number | undefined>(undefined)
    const displayingSchedulePreview = filterDate ? true : false

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
        setPlatformFilter(undefined)

        let eventSource: EventSource | null = null

        const startEventSource = () => {
            if (!filterDate) {
                eventSource = new EventSource(encodeURI(`${url}/services/${fullyEncodeURIComponent(stopName)}`))

                eventSource.onmessage = (event) => {
                    try {
                        const parsedData: Service = JSON.parse(event.data)

                        if (Object.keys(parsedData).length > 0) {
                            setServices((prev) => [...prev, parsedData])
                            setErrorMessage("")
                        }
                    } catch (error) {
                        console.error("Error parsing SSE data:", error)
                    }
                }

                eventSource.onerror = () => {
                    console.error("SSE connection error.")
                    setErrorMessage("Failed to fetch data from the server.")
                    if (eventSource) {
                        eventSource.close()
                    }
                }
            } else {
                ApiFetch(`services/${fullyEncodeURIComponent(stopName)}/schedule?date=${Math.floor(filterDate.getTime() / 1000)}`)
                    .then(async (res) => {
                        if (res.ok) {
                            const data: TrainsApiResponse<Service[]> = await res.json()
                            setServices(data.data)
                            setErrorMessage("")
                        } else {
                            res.text().then((text) => {
                                console.error("Error fetching schedule:", text)
                            })
                            setErrorMessage("Failed to fetch data from the server.")
                        }
                    })
                    .catch((error) => {
                        console.error("Fetch error:", error)
                        setErrorMessage("Failed to fetch data from the server.")
                    })
            }
        }

        const stopEventSource = () => {
            if (eventSource) {
                eventSource.close()
            }
            eventSource = null
            setErrorMessage("")
        }

        startEventSource()

        // Visibility change handling
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                startEventSource()
            } else if (document.visibilityState === "hidden") {
                stopEventSource()
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange)

        // Cleanup on unmount, visibility change, or dependencies update
        return () => {
            stopEventSource()
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
    }, [stopName, filterDate, url])

    if (errorMessage !== "") {
        return <ErrorScreen errorTitle="An error occurred loading services for this stop" errorText={errorMessage} />
    }

    if (services.length === 0) {
        return null
    }

    return (
        <>

            {getUniquePlatforms(services).length > 0 ? (
                <ol className="flex mb-2 gap-2 items-center" aria-label="Toggle platforms list">
                    <li className="w-full">
                        <Button
                            aria-label="toggle all platforms"
                            variant={"outline"}
                            disabled={!platformFilter}
                            className="w-full"
                            size={"sm"}
                            onClick={() => setPlatformFilter(undefined)}
                        >
                            All
                        </Button>
                    </li>
                    {getUniquePlatforms(services).map((platform) => (
                        <li key={platform} className="w-full">
                            <Button
                                aria-label="toggle platform button"
                                className="w-full disabled:border-green-300 disabled:bg-green-200"
                                size={"sm"}
                                variant={"outline"}
                                disabled={platformFilter === platform}
                                onClick={() => setPlatformFilter(platform)}
                            >
                                {platform}
                            </Button>
                        </li>
                    ))}
                </ol>
            ) : null}
            <ul aria-label="List of services for the stop" className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 p-2 bg-secondary rounded-md overflow-hidden">
                {getService(services, platformFilter, displayingSchedulePreview)
                    .map((service) => (
                        <li
                            key={service.trip_id}
                            className={`overflow-hidden ${!displayingSchedulePreview && service.departed ? "" : ""} ${service.canceled ? "opacity-50" : ""}`}
                        >
                            <Card className="shadow-none">
                                <CardHeader>
                                    <CardTitle>
                                        <div className="flex items-center justify-between overflow-hidden">
                                            <div className="shrink flex-1 truncate overflow-hidden">
                                                {service.canceled ? (
                                                    <>
                                                        <span className="text-red-500">Canceled | </span>
                                                        <span className="opacity-50">{formatTextToNiceLookingWords(service.headsign)} </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {!displayingSchedulePreview && service.departed ? (
                                                            <>
                                                                <span className="text-orange-500">Departed | </span>
                                                                <span className="opacity-50">
                                                                    {formatTextToNiceLookingWords(service.headsign)}{" "}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="">{formatTextToNiceLookingWords(service.headsign)}</span>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            <div className="flex gap-1 items-center mr-2">
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger>
                                                            <BikeIcon
                                                                aria-label={service.bikes_allowed === 0
                                                                    ? "Bikes might/might not be allowed"
                                                                    : service.bikes_allowed === 1
                                                                        ? "Bikes are allowed"
                                                                        : "Bikes are not allowed"}
                                                                className={`w-4 h-4 ${service.bikes_allowed === 0 ? "text-yellow-500" : service.bikes_allowed === 1 ? "text-green-500" : "text-red-500"}`}
                                                            />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {service.bikes_allowed === 0
                                                                ? "Bikes might/might not be allowed"
                                                                : service.bikes_allowed === 1
                                                                    ? "Bikes are allowed"
                                                                    : "Bikes are not allowed"}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={0}>
                                                        <TooltipTrigger>
                                                            <AccessibilityIcon
                                                                aria-label={service.wheelchairs_allowed === 0
                                                                    ? "Might/Might not be wheelchair accessible"
                                                                    : service.wheelchairs_allowed === 1
                                                                        ? "Is wheelchair accessible"
                                                                        : "Not Wheelchair accessible"}
                                                                className={`w-4 h-4 ${service.wheelchairs_allowed === 0 ? "text-yellow-500" : service.wheelchairs_allowed === 1 ? "text-green-500" : "text-red-500"}`}
                                                            />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {service.wheelchairs_allowed === 0
                                                                ? "Might/Might not be wheelchair accessible"
                                                                : service.wheelchairs_allowed === 1
                                                                    ? "Is wheelchair accessible"
                                                                    : "Not Wheelchair accessible"}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                            <span
                                                aria-label="Service route name"
                                                className="shrink-0 px-2 py-1 rounded text-zinc-100 text-xs"
                                                style={{ background: "#" + service.route.color }}
                                            >
                                                {service.route.name}
                                            </span>
                                        </div>
                                    </CardTitle>

                                    <CardDescription>
                                        <div className="grid grid-cols-2">
                                            <div className="grid">
                                                <p className="">Arriving: {convert24hTo12h(service.arrival_time)}</p>
                                                {!service.canceled && !displayingSchedulePreview ? (
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
                                {!displayingSchedulePreview && !service.canceled ? (
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
                                                loaded={service.tracking !== 2}
                                                has={service.tracking === 1}
                                                tripId={service.trip_id}
                                            />
                                            <span
                                                aria-label="Arriving in"
                                                className={`text-center rounded-md font-medium p-1 h-full w-full`}
                                            >
                                                {service.time_till_arrival}min
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
        </>

    )
}

function getService(serviceData: Service[], platformFilter: string | number | undefined, displayingSchedulePreview: boolean): Service[] {
    const services = serviceData.filter((item) => item.type === "service").sort((a, b) => b.time - a.time)
    if (services.length === 0) {
        return []
    }

    const realtimeUpdates = serviceData.filter((item) => item.type === "realtime").sort((a, b) => b.time - a.time)

    const seenTripIds = new Set<string>() // Keep track of trip IDs already processed

    const result: Service[] = []

    services.map((service) => {
        if (!seenTripIds.has(service.trip_id)) {
            seenTripIds.add(service.trip_id)
            const latest_realtime_update = realtimeUpdates.find((item) => item.trip_id === service.trip_id)

            if (latest_realtime_update) {
                result.push({ ...service, ...latest_realtime_update, type: "service" })
            }
        }
    })

    return result
        .filter((item) => item.platform === platformFilter || platformFilter === undefined)
        .sort((a, b) => timeTillArrival(a.arrival_time) - timeTillArrival(b.arrival_time))
        .filter((item) => !(!displayingSchedulePreview && item.departed))
}