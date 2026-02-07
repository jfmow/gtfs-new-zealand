'use client'

import { MapItem } from "@/components/map/markers/create";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiFetch } from "@/lib/url-context";
import { ArrowRight, Bus, Clock, MapPin, Navigation, X } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense, useState, useRef, useEffect } from "react";

const LeafletMap = dynamic(() => import("@/components/map/map"), {
    ssr: false,
});

interface Location {
    lat: number;
    lon: number;
    label: string;
}

export default function PlanJourney() {
    const [startLocation, setStartLocation] = useState<Location | null>(null);
    const [endLocation, setEndLocation] = useState<Location | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [maxWalkKm, setMaxWalkKm] = useState<string>("1");
    const [walkSpeed, setWalkSpeed] = useState<string>("4.8");
    const [maxTransfers, setMaxTransfers] = useState<string>("5");
    const [apiResponse, setApiResponse] = useState<JourneyType[]>([]);
    const [selectedRoute, setSelectedRoute] = useState<JourneyType | undefined>();
    const [isSearching, setIsSearching] = useState(false);
    const [locationMode, setLocationMode] = useState<'start' | 'end'>('start');

    const totalDistance = selectedRoute ? selectedRoute.Legs.reduce((sum, leg) => sum + leg.DistanceKm, 0) : 0;

    // Handle map clicks to set start/end locations
    const locationModeRef = useRef<'start' | 'end'>('start');
    useEffect(() => {
        locationModeRef.current = locationMode;
    }, [locationMode]);

    const handleMapClick = (lat: number, lon: number) => {
        if (locationModeRef.current === 'start') {
            setStartLocation({ lat, lon, label: "Start Point" });
        } else {
            setEndLocation({ lat, lon, label: "End Point" });
        }
    };


    // Plan the journey
    const planJourney = async () => {
        if (!startLocation || !endLocation) return;

        setIsSearching(true);
        try {
            // Simulate API call - replace with your actual API endpoint
            const response = await ApiFetch<JourneyType[]>(
                `/services/plan?startLat=${startLocation.lat}&startLon=${startLocation.lon}&endLat=${endLocation.lat}&endLon=${endLocation.lon}&date=${selectedDate.toISOString()}&maxWalkKm=${maxWalkKm}&walkSpeed=${walkSpeed}&maxTransfers=${maxTransfers}`
            );

            if (response.ok) {
                setApiResponse(response.data);
                if (response.data.length > 0) {
                    setSelectedRoute(response.data[0]);
                }
            }
        } catch (error) {
            console.error("[v0] Error planning journey:", error);
        } finally {
            setIsSearching(false);
        }
    };

    // Map markers for start and end points
    const mapMarkers: MapItem[] = [];

    if (startLocation) {
        mapMarkers.push({
            lat: startLocation.lat,
            lon: startLocation.lon,
            icon: "marked stop marker",
            id: "start",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>Start Point</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        });
    }

    if (endLocation) {
        mapMarkers.push({
            lat: endLocation.lat,
            lon: endLocation.lon,
            icon: "end marker",
            id: "end",
            routeID: "",
            zIndex: 200,
            onClick: () => { },
            description: {
                text: `<strong>End Point</strong>`,
                alwaysShow: true
            },
            type: "stop" as const
        });
    }

    // Add route markers if a route is selected
    if (selectedRoute) {
        selectedRoute.Legs.forEach((leg, index) => {
            if (leg.FromStop) {
                mapMarkers.push({
                    lat: leg.FromStop.stop_lat,
                    lon: leg.FromStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.FromStop.stop_id + "-" + index,
                    routeID: leg.RouteID,
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.FromStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `${leg.Route?.route_short_name} - ${formatTime(leg.DepartureTime)}` : 'Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                });
            }
            if (leg.ToStop) {
                mapMarkers.push({
                    lat: leg.ToStop.stop_lat,
                    lon: leg.ToStop.stop_lon,
                    icon: "next stop marker",
                    id: leg.ToStop.stop_id + "-" + index,
                    routeID: leg.RouteID,
                    zIndex: 100,
                    onClick: () => { },
                    description: {
                        text: `<strong>${leg.ToStop?.stop_name}</strong><br/>${leg.Mode === 'transit' ? `${leg.Route?.route_short_name} - ${formatTime(leg.ArrivalTime)}` : 'Walking'}`,
                        alwaysShow: false
                    },
                    type: "stop" as const
                });
            }
        });
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
                <div className="space-y-2">
                    <h1 className="text-balance text-3xl font-bold tracking-tight">Plan Your Journey</h1>
                    <p className="text-muted-foreground">Click on the map to select start and end points, then customize your journey options</p>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Map Section */}
                    <div className="lg:col-span-2">
                        <Card className="overflow-hidden">
                            <CardHeader>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1.5">
                                        <CardTitle>Interactive Map</CardTitle>
                                        <CardDescription>
                                            Click on the map to set your {locationMode} location
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant={locationMode === 'start' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setLocationMode('start')}
                                        >
                                            Set Start
                                        </Button>
                                        <Button
                                            variant={locationMode === 'end' ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setLocationMode('end')}
                                        >
                                            Set End
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Suspense fallback={<div className="flex h-[600px] items-center justify-center">Loading map...</div>}>
                                    <LeafletMap
                                        defaultZoom={["user", [51.5074, -0.1278]]}
                                        mapItems={mapMarkers}
                                        map_id="journey-planner-map"
                                        height="600px"
                                        line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                        onMapClick={handleMapClick}
                                    />
                                </Suspense>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Options Panel */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Journey Options</CardTitle>
                                <CardDescription>Customize your journey preferences</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <DatePicker onDateChange={(d) => setSelectedDate(d)} />
                                </div>

                                <LocationSearchInput
                                    placeholder="Search start location..."
                                    value={startLocation}
                                    onSelect={setStartLocation}
                                    storageKey="recentStartLocations"
                                />

                                <LocationSearchInput
                                    placeholder="Search end location..."
                                    value={endLocation}
                                    onSelect={setEndLocation}
                                    storageKey="recentEndLocations"
                                />

                                {/* Max Walk Distance */}
                                <div className="space-y-2">
                                    <Label htmlFor="maxWalk">Max Walking Distance</Label>
                                    <Select value={maxWalkKm} onValueChange={setMaxWalkKm}>
                                        <SelectTrigger id="maxWalk">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0.5">0.5 km</SelectItem>
                                            <SelectItem value="1">1 km</SelectItem>
                                            <SelectItem value="1.5">1.5 km</SelectItem>
                                            <SelectItem value="2">2 km</SelectItem>
                                            <SelectItem value="3">3 km</SelectItem>
                                            <SelectItem value="5">5 km</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Walking Speed */}
                                <div className="space-y-2">
                                    <Label htmlFor="walkSpeed">Walking Speed</Label>
                                    <Select value={walkSpeed} onValueChange={setWalkSpeed}>
                                        <SelectTrigger id="walkSpeed">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="3">3 km/h (Slow)</SelectItem>
                                            <SelectItem value="4.8">4.8 km/h (Average)</SelectItem>
                                            <SelectItem value="5.5">5.5 km/h (Brisk)</SelectItem>
                                            <SelectItem value="6.5">6.5 km/h (Fast)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Max Transfers */}
                                <div className="space-y-2">
                                    <Label htmlFor="maxTransfers">Max Transfers</Label>
                                    <Select value={maxTransfers} onValueChange={setMaxTransfers}>
                                        <SelectTrigger id="maxTransfers">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0">Direct only</SelectItem>
                                            <SelectItem value="1">1 transfer</SelectItem>
                                            <SelectItem value="2">2 transfers</SelectItem>
                                            <SelectItem value="3">3 transfers</SelectItem>
                                            <SelectItem value="5">5 transfers</SelectItem>
                                            <SelectItem value="10">10 transfers</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <Button
                                    className="w-full"
                                    onClick={planJourney}
                                    disabled={!startLocation || !endLocation || isSearching}
                                >
                                    {isSearching ? "Searching..." : "Search Routes"}
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Trip Summary */}
                        {selectedRoute && (
                            <Card>
                                <CardHeader>
                                    <CardTitle>Trip Summary</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <Clock className="mt-0.5 h-5 w-5 text-muted-foreground" />
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Duration</p>
                                            <p className="text-2xl font-bold">{formatDuration(selectedRoute.TotalDuration)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Navigation className="mt-0.5 h-5 w-5 text-muted-foreground" />
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Distance</p>
                                            <p className="text-2xl font-bold">{totalDistance.toFixed(2)} km</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <MapPin className="mt-0.5 h-5 w-5 text-muted-foreground" />
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Transfers</p>
                                            <p className="text-2xl font-bold">{selectedRoute.Transfers}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <ArrowRight className="mt-0.5 h-5 w-5 text-muted-foreground" />
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Time</p>
                                            <p className="text-sm">{formatTime(selectedRoute.DepartureTime)} - {formatTime(selectedRoute.ArrivalTime)}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

                {/* Route Options */}
                {apiResponse.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Route Options</CardTitle>
                            <CardDescription>Select a route to view on the map</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {apiResponse.map((route, index) => {
                                    const isSelected = route.ID === selectedRoute?.ID;
                                    return (
                                        <Button
                                            key={index}
                                            variant={isSelected ? 'default' : 'outline'}
                                            className="h-auto justify-start p-4 text-left"
                                            onClick={() => setSelectedRoute(route)}
                                        >
                                            <div className="flex w-full flex-col gap-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <Badge variant={route.Transfers > 0 ? 'secondary' : 'default'}>
                                                        Option {index + 1}
                                                    </Badge>
                                                    <span className="text-sm font-semibold">{formatDuration(route.TotalDuration)}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <Bus className="h-3 w-3" />
                                                    <span>{getRouteSummary(route)}</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs">
                                                    <span>{route.Transfers} transfer{route.Transfers !== 1 ? 's' : ''}</span>
                                                    <span>{formatTime(route.DepartureTime)} - {formatTime(route.ArrivalTime)}</span>
                                                </div>
                                            </div>
                                        </Button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Route Details */}
                {selectedRoute && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Route Details</CardTitle>
                            <CardDescription>Step-by-step journey information</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {selectedRoute.Legs.map((leg, index) => (
                                <div key={index} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={leg.Mode === 'walk' ? 'secondary' : 'default'}
                                            style={leg.Route?.route_color ? { backgroundColor: `#${leg.Route.route_color}`, color: '#fff' } : undefined}
                                        >
                                            {leg.Mode === 'walk' ? 'Walk' : `${leg.Route?.vehicle_type || 'Bus'} ${leg.Route?.route_short_name || leg.RouteID}`}
                                        </Badge>
                                        <span className="text-sm text-muted-foreground">
                                            {formatDuration(leg.Duration)}
                                        </span>
                                    </div>
                                    <div className="space-y-1 text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 w-2 rounded-full bg-green-500" />
                                            <span className="font-medium">{formatTime(leg.DepartureTime)}</span>
                                            <span className="text-muted-foreground">
                                                {leg.FromStop?.stop_name || 'Start'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 w-2 rounded-full bg-red-500" />
                                            <span className="font-medium">{formatTime(leg.ArrivalTime)}</span>
                                            <span className="text-muted-foreground">
                                                {leg.ToStop?.stop_name || 'Destination'}
                                            </span>
                                        </div>
                                    </div>
                                    {leg.DistanceKm > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            Distance: {leg.DistanceKm.toFixed(2)} km
                                        </p>
                                    )}
                                    {leg.Route && (
                                        <div className="space-y-0.5 text-xs text-muted-foreground">
                                            <p>Agency: {leg.Route.agency_id}</p>
                                            <p>Trip ID: {leg.TripID}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}

function getRouteSummary(route: JourneyType) {
    const transitLegs = route.Legs.filter((leg) => leg.Mode === 'transit');
    const routeNames = transitLegs.map((leg) => leg.Route?.route_short_name || leg.RouteID);
    return routeNames.join(' → ') || 'Walking only';
}

function formatTime(dateString: string | Date) {
    return new Date(dateString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatDuration(nanoseconds: number) {
    const minutes = Math.round(nanoseconds / 60000000000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

export interface JourneyType {
    ID: string;
    StartLat: number;
    StartLon: number;
    EndLat: number;
    EndLon: number;
    DepartureTime: Date;
    ArrivalTime: Date;
    TotalDuration: number;
    Transfers: number;
    TransferStops: null;
    Legs: Leg[];
    RouteGeoJSON: GeoJSON;
}

export interface Leg {
    Mode: string;
    RouteID: string;
    TripID: string;
    FromStop?: Stop;
    ToStop?: Stop;
    DepartureTime: Date;
    ArrivalTime: Date;
    Duration: number;
    DistanceKm: number;
    Route?: Route;
}

export interface Stop {
    stop_id: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
}

export interface Route {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_type: number;
    route_color?: string;
    route_text_color?: string;
    agency_id: string;
    vehicle_type?: string;
}

import { Calendar } from "@/components/ui/calendar"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { format } from "date-fns"
import { ChevronDownIcon } from "lucide-react"
import { LocationSearchInput } from "@/components/map/search";

function DatePicker({ onDateChange }: { onDateChange: (date: Date) => void }) {
    const [open, setOpen] = useState(false)
    const [date, setDate] = useState<Date>(new Date())

    // Handle time input changes
    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!date) return
        const [hours, minutes, seconds] = e.target.value.split(":").map(Number)
        const updatedDate = new Date(date)
        updatedDate.setHours(hours, minutes, seconds || 0)
        setDate(updatedDate)
    }

    useEffect(() => {
        if (date && onDateChange) {
            onDateChange(date)
        }
    }, [date])

    return (
        <FieldGroup className="mx-auto max-w-xs flex-row">
            {/* Date Picker */}
            <Field>
                <FieldLabel htmlFor="date-picker-optional">Date</FieldLabel>
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            id="date-picker-optional"
                            className="w-32 justify-between font-normal"
                        >
                            {date ? format(date, "PPP") : "Select date"}
                            <ChevronDownIcon />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={date}
                            captionLayout="dropdown"
                            defaultMonth={date}
                            onSelect={(selectedDate) => {
                                if (!selectedDate) return
                                const updatedDate = new Date(selectedDate)
                                // Preserve current time
                                updatedDate.setHours(date.getHours(), date.getMinutes(), date.getSeconds())
                                setDate(updatedDate)
                                setOpen(false)
                            }}
                        />
                    </PopoverContent>
                </Popover>
            </Field>

            {/* Time Picker */}
            <Field className="w-32">
                <FieldLabel htmlFor="time-picker-optional">Time</FieldLabel>
                <Input
                    type="time"
                    id="time-picker-optional"
                    step="1"
                    value={date ? format(date, "HH:mm:ss") : "00:00:00"}
                    onChange={handleTimeChange}
                    className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                />
            </Field>
        </FieldGroup>
    )
}

