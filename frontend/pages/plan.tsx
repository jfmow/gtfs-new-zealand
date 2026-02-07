'use client'

import { MapItem } from "@/components/map/markers/create";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiFetch, useUrl } from "@/lib/url-context";
import { useIsMobile } from "@/lib/utils";
import { Header } from "@/components/nav";
import { Bus } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense, useState, useRef, useEffect } from "react";
import type { GeoJSON } from "@/components/map/geojson-types"
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
    const [isSelectingOnMap, setIsSelectingOnMap] = useState(false);
    const [isRouteMapOpen, setIsRouteMapOpen] = useState(false);
    const [isLocating, setIsLocating] = useState<null | 'start' | 'end'>(null);
    const [locationError, setLocationError] = useState<string | null>(null);
    const isMobile = useIsMobile();
    const { currentUrl } = useUrl()


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
        setIsSelectingOnMap(false);
    };

    const handleSelectFromMap = (mode: 'start' | 'end') => {
        setLocationMode(mode);
        setIsSelectingOnMap(true);
    };

    const handleUseCurrentLocation = (mode: 'start' | 'end') => {
        setLocationError(null);
        if (!navigator?.geolocation) {
            setLocationError("Current location is unavailable in this browser.");
            return;
        }
        setIsLocating(mode);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    label: "Current location",
                };
                if (mode === 'start') {
                    setStartLocation(location);
                } else {
                    setEndLocation(location);
                }
                setIsLocating(null);
            },
            () => {
                setLocationError("Unable to access your current location.");
                setIsLocating(null);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    // Plan the journey
    const planJourney = async () => {
        if (!startLocation || !endLocation) return;

        setIsSearching(true);
        setApiResponse([])
        try {
            // Simulate API call - replace with your actual API endpoint
            const response = await ApiFetch<JourneyType[]>(
                `/services/plan?startLat=${startLocation.lat}&startLon=${startLocation.lon}&endLat=${endLocation.lat}&endLon=${endLocation.lon}&date=${selectedDate.toISOString()}&maxWalkKm=${maxWalkKm}&walkSpeed=${walkSpeed}&maxTransfers=${maxTransfers}`
            );

            if (response.ok) {
                setApiResponse(response.data);
            }
        } catch (error) {
            console.error("Error planning journey:", error);
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
        <>
            <Header title="Train, Bus, Ferry - Find your next journey" />
            <div className="mx-auto w-full max-w-[1400px] flex flex-col gap-6 px-4 pb-4">
                <div className="grid gap-6 mx-auto w-full max-w-4xl">
                    <Card className="">
                        <CardHeader>
                            <CardTitle>Journey Options</CardTitle>
                            <CardDescription>Plan a trip that works for you.</CardDescription>
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
                                onSelectFromMap={() => handleSelectFromMap('start')}
                                onUseCurrentLocation={() => handleUseCurrentLocation('start')}
                                isLocating={isLocating === 'start'}
                            />

                            <LocationSearchInput
                                placeholder="Search end location..."
                                value={endLocation}
                                onSelect={setEndLocation}
                                storageKey="recentEndLocations"
                                onSelectFromMap={() => handleSelectFromMap('end')}
                                onUseCurrentLocation={() => handleUseCurrentLocation('end')}
                                isLocating={isLocating === 'end'}
                            />

                            {locationError && (
                                <p className="text-sm text-destructive" role="alert">
                                    {locationError}
                                </p>
                            )}

                            <div className="grid gap-4 sm:grid-cols-3">
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

                    <div className="">
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
                                                    onClick={() => {
                                                        setSelectedRoute(route);
                                                        setIsRouteMapOpen(true);
                                                    }}
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
                    </div>
                </div>


            </div>

            {isMobile ? (
                <Sheet open={isRouteMapOpen} onOpenChange={setIsRouteMapOpen}>
                    <SheetContent side="bottom" className="max-h-[85vh] overflow-hidden">
                        <SheetHeader>
                            <SheetTitle>Route Details</SheetTitle>
                            <SheetDescription>Review the selected journey on the map or in a list.</SheetDescription>
                        </SheetHeader>
                        <Tabs defaultValue="details" className="mt-4">
                            <TabsList className="w-full">
                                <TabsTrigger value="map" className="flex-1">Map</TabsTrigger>
                                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                            </TabsList>
                            <TabsContent value="map">
                                {selectedRoute && (
                                    <div className="h-[60vh] overflow-hidden rounded-md border">
                                        <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                            <LeafletMap
                                                defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                                mapItems={mapMarkers}
                                                map_id="journey-planner-route-map"
                                                height="100%"
                                                line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="details">
                                {selectedRoute && (
                                    <div className="max-h-[60vh] overflow-y-auto p-2">
                                        <RouteDetailsContent route={selectedRoute} />
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={isRouteMapOpen} onOpenChange={setIsRouteMapOpen}>
                    <DialogContent className="max-w-5xl">
                        <DialogHeader>
                            <DialogTitle>Route Details</DialogTitle>
                            <DialogDescription>Review the selected journey on the map or in a list.</DialogDescription>
                        </DialogHeader>
                        <Tabs defaultValue="details" className="mt-4">
                            <TabsList className="w-full">
                                <TabsTrigger value="map" className="flex-1">Map</TabsTrigger>
                                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                            </TabsList>
                            <TabsContent value="map">
                                {selectedRoute && (
                                    <div className="h-[60vh] overflow-hidden rounded-md border">
                                        <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                            <LeafletMap
                                                defaultZoom={[[selectedRoute.StartLat, selectedRoute.StartLon], [selectedRoute.EndLat, selectedRoute.EndLon]]}
                                                mapItems={mapMarkers}
                                                map_id="journey-planner-route-map"
                                                height="100%"
                                                line={selectedRoute ? { GeoJson: selectedRoute.RouteGeoJSON, color: "" } : undefined}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="details">
                                {selectedRoute && (
                                    <div className="max-h-[60vh] overflow-y-auto p-2">
                                        <RouteDetailsContent route={selectedRoute} />
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </DialogContent>
                </Dialog>
            )}

            {isMobile ? (
                <Sheet open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <SheetContent side="bottom" className="h-[85vh] overflow-hidden">
                        <SheetHeader>
                            <SheetTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</SheetTitle>
                            <SheetDescription>Tap the map to set your {locationMode} point.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={isSelectingOnMap} onOpenChange={setIsSelectingOnMap}>
                    <DialogContent className="max-w-5xl">
                        <DialogHeader>
                            <DialogTitle>Select {locationMode === 'start' ? 'start' : 'end'} location</DialogTitle>
                            <DialogDescription>Click the map to set your {locationMode} point.</DialogDescription>
                        </DialogHeader>
                        <div className="mt-4 h-[65vh] overflow-hidden rounded-md border">
                            <Suspense fallback={<div className="flex h-full items-center justify-center">Loading map...</div>}>
                                <LeafletMap
                                    defaultZoom={["user", currentUrl.defaultMapCenter]}
                                    mapItems={mapMarkers}
                                    map_id="journey-planner-select-map"
                                    height="100%"
                                    onMapClick={handleMapClick}
                                />
                            </Suspense>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
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

function RouteDetailsContent({ route }: { route: JourneyType }) {
    return (
        <div className="space-y-4">
            {route.Legs.map((leg, index) => (
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
                </div>
            ))}
        </div>
    );
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
        <div className="flex flex-col space-y-2">
            <Label>Date & Time</Label>
            <div className="flex flex-col md:flex-row gap-2">
                <div className="">
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                id="date-picker-optional"
                                className="font-normal"
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
                </div>
                <div className="space-y-1">
                    <Input
                        type="time"
                        id="time-picker-optional"
                        step="1"
                        value={date ? format(date, "HH:mm:ss") : "00:00:00"}
                        onChange={handleTimeChange}
                        className="w-fit bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                    />
                </div>
            </div>
        </div>
    )
}
