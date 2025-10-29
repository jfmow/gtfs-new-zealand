import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { MapItem } from '@/components/map/markers/create'
import dynamic from 'next/dynamic'
import { ApiFetch } from '@/lib/url-context'
import { useQueryParams } from '@/lib/url-params'
import { convertSecondsToTimeNoDecimal, fullyEncodeURIComponent } from '@/lib/utils'
import { getStopsForTrip } from '@/components/services/stops'
import { ServicesStop, StopTimes } from '@/components/services/tracker'
import { Header } from '@/components/nav'
import { Checkbox } from '@/components/ui/checkbox'
import { formatUnixTime } from '@/lib/formating'
import SearchForRoute from '@/components/routes/search'

const LeafletMap = dynamic(() => import("../../components/map/map"), {
    ssr: false,
});

export default function VehicleDataPage() {
    const [data, setData] = useState<History>()
    const [loading, setLoading] = useState(false)
    const { tripid, selected_route } = useQueryParams({ tripid: { type: 'string', default: '' }, selected_route: { type: "string", default: "", keys: ["r"] } })
    const [stops, setStops] = useState<ServicesStop[]>([])
    const [routeLoading, setRouteLoading] = useState(false)
    const [routeResults, setRouteResults] = useState<Trip[]>([])
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
    const [showStops, setShowStops] = useState(false)
    const [stopTimes, setStopTimes] = useState<StopTimes[]>([])

    // pagination
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 7
    const totalPages = Math.ceil(routeResults.length / pageSize)
    const paginatedResults = routeResults.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    // Helpers to format timestamps (stored as seconds) to date and 12h time with am/pm
    const formatDate = (ts: number) => {
        const d = new Date(ts * 1000)
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }

    const formatTime = (ts: number) => {
        const d = new Date(ts * 1000)
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    }

    useEffect(() => {
        if (tripid.value !== "") {
            async function fetchData() {
                setLoading(true)
                ApiFetch<History>(`/hs/${fullyEncodeURIComponent(tripid.value)}`).then((res) => {
                    if (res.ok) {
                        setData(res.data)
                    }
                    setLoading(false)
                }).catch((err) => {
                    console.error('Error fetching vehicle data:', err)
                    setLoading(false)
                })
                const stopsData = await getStopsForTrip(tripid.value)
                if (stopsData) {
                    setStops(stopsData)
                }
                const stopTimesRes = await ApiFetch<StopTimes[]>(`realtime/stop-times?tripId=${fullyEncodeURIComponent(tripid.value)}`, {
                    method: "GET",
                })
                if (stopTimesRes.ok) {
                    setStopTimes(stopTimesRes.data)
                    stopTimesRes.data.map((i) => {
                        console.log("Stop time:", formatUnixTime(i.arrival_time), formatUnixTime(i.departure_time))
                    })
                }
            }
            fetchData()
        }
    }, [tripid])

    useEffect(() => {
        async function fetchRouteResults() {
            if (!selected_route.found || selected_route.value === "") return
            setRouteLoading(true)
            setRouteResults([])
            try {
                const now = Math.floor(Date.now() / 1000)
                const d = selectedDate ?? new Date()
                const start = new Date(d)
                start.setHours(0, 0, 0, 0)
                const startVal = Math.floor(start.getTime() / 1000).toString()

                let endVal: string
                const today = new Date()
                if (d.toDateString() === today.toDateString()) {
                    endVal = now.toString()
                } else {
                    const end = new Date(d)
                    end.setHours(23, 59, 59, 999)
                    endVal = Math.floor(end.getTime() / 1000).toString()
                }

                let url = `/hs/route/${fullyEncodeURIComponent(selected_route.value)}`
                const params: string[] = []
                if (startVal) params.push(`start=${encodeURIComponent(startVal)}`)
                if (endVal) params.push(`end=${encodeURIComponent(endVal)}`)
                if (params.length) url += `?${params.join('&')}`

                const res = await ApiFetch<Trip[]>(url)
                if (res.ok) {
                    setRouteResults(res.data || [])
                    setCurrentPage(1) // reset pagination
                }
            } catch (err) {
                console.error('Route search error', err)
            } finally {
                setRouteLoading(false)
            }
        }
        fetchRouteResults()
    }, [selected_route.value, selectedDate])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[80vh] text-muted-foreground">
                <Loader2 className="animate-spin mr-2" /> Loading vehicle data...
            </div>
        )
    }

    const positions = data?.positions || []
    const updates = data?.updates || []

    return (
        <>
            <Header title="Train, Bus, Ferry - Find your next journey" />
            <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4">
                <h1 className="text-3xl font-semibold tracking-tight mb-4">Trip History</h1>
                <div className='grid lg:grid-cols-[3fr_5fr] gap-2'>
                    <Tabs defaultValue={"route"} className='mb-4'>
                        <TabsList>
                            <TabsTrigger value="route">Search by Route</TabsTrigger>
                            <TabsTrigger value="stop">Search by Stop</TabsTrigger>
                        </TabsList>
                        <TabsContent value="route">
                            <Card className="shadow-md">
                                <CardHeader>
                                    <CardTitle>Search historic trips by Route</CardTitle>
                                    <CardDescription>Includes trips completed for the last 3 days</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center gap-2 mb-4 items-end">
                                        <div className='w-full'>
                                            <SearchForRoute />
                                        </div>
                                        <div className='shrink-0'>
                                            <DatePicker defaultValue={selectedDate} onChange={(d) => setSelectedDate(d)} />
                                        </div>
                                    </div>

                                    {routeLoading && (<div className="text-muted-foreground">Searching... <Loader2 className="animate-spin inline-block ml-2" /></div>)}

                                    {routeResults.length > 0 && (
                                        <div className="text-sm text-muted-foreground mb-3">
                                            Found {routeResults.length} trip{routeResults.length !== 1 && 's'} for route <b>{selected_route.value}</b>
                                        </div>
                                    )}

                                    <div className="overflow-x-auto rounded-md border border-border/40">
                                        <Table>
                                            <TableHeader className="bg-muted/40 sticky top-0">
                                                <TableRow>
                                                    <TableHead>Trip</TableHead>
                                                    <TableHead>Start</TableHead>
                                                    <TableHead>Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {routeResults.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                                                            {routeLoading ? 'Loading...' : 'No results found'}
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    paginatedResults.map((r, i) => (
                                                        <TableRow key={i} className="hover:bg-muted/10 transition-colors">
                                                            <TableCell>{r.trip_headsign}</TableCell>
                                                            <TableCell>{new Date(r.first_stop_arrival_date_time).toLocaleString('en-US', {
                                                                year: 'numeric',
                                                                month: 'short',
                                                                day: 'numeric',
                                                                hour: 'numeric',
                                                                minute: '2-digit',
                                                                hour12: true,
                                                            })
                                                            }</TableCell>
                                                            <TableCell>
                                                                <Button variant="secondary" size="sm" onClick={() => tripid.set(r.trip_id)}>
                                                                    Open
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {routeResults.length > 0 && (
                                        <div className="flex items-center justify-between px-2 py-3 text-sm text-muted-foreground">
                                            <span>
                                                Page {currentPage} of {totalPages}
                                            </span>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={currentPage === 1}
                                                    onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                                                >
                                                    Previous
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={currentPage === totalPages}
                                                    onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                                                >
                                                    Next
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    {/* Rest of your tabs for position and updates unchanged */}
                    {data && (
                        <Tabs defaultValue="positions" className="w-full">
                            <TabsList className="">
                                <TabsTrigger value="positions">Location History</TabsTrigger>
                                <TabsTrigger value="updates">Stop Updates</TabsTrigger>
                            </TabsList>

                            <TabsContent value="positions">
                                <Card className="shadow-md">
                                    <CardHeader>
                                        <CardTitle>Location history</CardTitle>
                                        <div className='flex items-center justify-start pt-2'>
                                            <Checkbox checked={showStops} onCheckedChange={() => setShowStops(p => !p)} id="show-stops-checkbox" />
                                            <Label className="ml-2 select-none" htmlFor="show-stops-checkbox">Show Trip Stops</Label>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <LeafletMap
                                            defaultZoom={positions.length > 0 ? [[positions[0]?.Latitude, positions[0]?.Longitude], [positions[positions.length - 1]?.Latitude, positions[positions.length - 1]?.Longitude]] : ["user", [0, 0]]}
                                            mapItems={[
                                                ...positions.map(
                                                    (vehicle, index) =>
                                                        ({
                                                            lat: vehicle.Latitude,
                                                            lon: vehicle.Longitude,
                                                            icon: index === 0 ? "end marker" : index === positions.length - 1 ? "stop marker" : "dot gray",
                                                            id: vehicle.TripID + vehicle.Timestamp,
                                                            routeID: "",
                                                            zIndex: index === 0 || index === positions.length - 1 ? positions.length : index,
                                                            type: "waypoint",
                                                            description: { text: `${index === 0 ? "End |" : index === positions.length - 1 ? "Start |" : ""} Speed ${vehicle.Speed}kmh`, alwaysShow: false },
                                                        }) as MapItem
                                                ),
                                                ...(showStops ? stops.map(
                                                    (item) =>
                                                        ({
                                                            lat: item.lat,
                                                            lon: item.lon,
                                                            icon: "dot",
                                                            id: item.name,
                                                            routeID: "",
                                                            description: {
                                                                text: `${item.name} ${item.platform ? `| Platform ${item.platform}` : ""}`,
                                                                alwaysShow: false,
                                                            },
                                                            type: "stop",
                                                            zIndex: 2,
                                                            onClick: () => (window.location.href = `/?s=${encodeURIComponent(item.name)}`),
                                                        }) as MapItem,
                                                ) : [])
                                            ]}
                                            map_id={"testmap"}
                                            height={"500px"} />
                                        <div className="overflow-x-auto rounded-md border border-border/40 mt-4">
                                            <Table>
                                                <TableHeader className="bg-muted/40 sticky top-0">
                                                    <TableRow>
                                                        <TableHead>Vehicle</TableHead>
                                                        <TableHead>Latitude</TableHead>
                                                        <TableHead>Longitude</TableHead>
                                                        <TableHead>Speed (km/h)</TableHead>
                                                        <TableHead>Timestamp</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {positions.map((pos: Position, i: number) => (
                                                        <TableRow key={i}>
                                                            <TableCell>{pos.VehicleLabel}</TableCell>
                                                            <TableCell>{pos.Latitude.toFixed(5)}</TableCell>
                                                            <TableCell>{pos.Longitude.toFixed(5)}</TableCell>
                                                            <TableCell>{pos.Speed}</TableCell>
                                                            <TableCell>{`${formatDate(pos.Timestamp)} ${formatTime(pos.Timestamp)}`}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="updates">
                                {updates.map((update: Update, index: number) => (
                                    <Card key={index} className="mb-4 border border-muted-foreground/10">
                                        <CardHeader>
                                            <CardTitle className="text-base font-semibold">
                                                {update.RouteID} – Trip {update.TripID}
                                            </CardTitle>
                                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                                {stopTimes.filter((i) => !i.passed).length >= 1 ? (
                                                    <>
                                                        <span className="relative flex h-2 w-2">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                                        </span>
                                                        {`${stopTimes.filter((i) => !i.passed).length} stops remaining`}
                                                    </>
                                                ) : (
                                                    `Trip Completed`
                                                )}
                                            </p>

                                            <p className="text-sm text-muted-foreground">
                                                Refreshed: {`${formatDate(update.Timestamp)} ${formatTime(update.Timestamp)}`}
                                            </p>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="overflow-x-auto rounded-md border border-border/40">
                                                <Table>
                                                    <TableHeader className='bg-muted/40'>
                                                        <TableRow>
                                                            <TableHead>Stop</TableHead>
                                                            <TableHead>Sequence</TableHead>
                                                            <TableHead>Delay</TableHead>
                                                            <TableHead>Arrival Time</TableHead>
                                                            <TableHead>Departure Time</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {update.StopTimeUpdates?.sort((a, b) => b.StopSequence - a.StopSequence).map((s: StopTimeUpdate, i: number) => (
                                                            <TableRow key={i}>
                                                                <TableCell>{stops.find(stop => stop.parent_stop_id === s.StopID || stop.child_stop_id === s.StopID)?.name || s.StopID}</TableCell>
                                                                <TableCell>{s.StopSequence}</TableCell>
                                                                <TableCell>
                                                                    {(() => {
                                                                        const delay = s.ArrivalDelay === 0 ? s.DepartureDelay : s.ArrivalDelay;
                                                                        const prefix = delay < 0 ? "Early: " : "Late: ";
                                                                        return prefix + convertSecondsToTimeNoDecimal(delay < 0 ? -delay : delay);
                                                                    })()}
                                                                </TableCell>
                                                                <TableCell>{formatUnixTime(stopTimes.find(st => st.parent_stop_id === s.StopID || st.child_stop_id === s.StopID)?.arrival_time || s.ArrivalTime * 1000)}</TableCell>
                                                                <TableCell>{formatUnixTime(stopTimes.find(st => st.parent_stop_id === s.StopID || st.child_stop_id === s.StopID)?.departure_time || s.DepartureTime * 1000)}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </TabsContent>
                        </Tabs>
                    )}

                </div>
            </div>
        </>
    )
}

export interface History {
    positions: Position[];
    updates: Update[];
}

export interface Position {
    TripID: TripID;
    RouteID: RouteID;
    VehicleID: string;
    VehicleLabel: VehicleLabel;
    LicensePlate: LicensePlate;
    Timestamp: number;
    Latitude: number;
    Longitude: number;
    Bearing: number;
    Speed: number;
    Odometer: number;
    CurrentStopSequence: number;
    StopID: string;
    VehicleStopStatus: VehicleStopStatus;
    CongestionLevel: CongestionLevel;
    OccupancyStatus: OccupancyStatus;
    OccupancyPercentage: number;
}

export enum CongestionLevel {
    UnknownCongestionLevel = "UNKNOWN_CONGESTION_LEVEL",
}

export enum LicensePlate {
    Hel389 = "HEL389",
}

export enum OccupancyStatus {
    Empty = "EMPTY",
}

export enum RouteID {
    Out202 = "OUT-202",
}

export enum TripID {
    The125306301502802Eb72B740 = "1253-06301-50280-2-eb72b740",
}

export enum VehicleLabel {
    Nb4311 = "NB4311",
}

export enum VehicleStopStatus {
    InTransitTo = "IN_TRANSIT_TO",
}

export interface Update {
    TripID: TripID;
    RouteID: RouteID;
    ScheduleRelationship: ScheduleRelationship;
    Timestamp: number;
    StopTimeUpdates: StopTimeUpdate[];
}

export enum ScheduleRelationship {
    Scheduled = "SCHEDULED",
}

export interface StopTimeUpdate {
    StopID: string;
    StopSequence: number;
    ArrivalDelay: number;
    ArrivalTime: number;
    ArrivalUncertainty: number;
    DepartureDelay: number;
    DepartureTime: number;
    DepartureUncertainty: number;
    ScheduleRelationship: ScheduleRelationship;
}



export interface Trip {
    bikes_allowed: number;
    direction_id: number;
    route_id: string;
    service_id: string;
    shape_id: string;
    trip_headsign: string;
    trip_id: string;
    wheelchair_accessible: number;
    first_stop_arrival_time: string;
    service_date: string;
    first_stop_arrival_date_time: string;
    first_stop_id: string;
}

