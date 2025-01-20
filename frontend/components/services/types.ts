export interface Service {
    service_data: ServiceData;
    trip_update: TripUpdate;
    vehicle: TripUpdateVehicle;
    has: Has;
}

export interface Has {
    trip_update: boolean;
    vehicle: boolean;
}

export interface ServiceData {
    trip_id: string;
    arrival_time: string;
    departure_time: string;
    stop_id: string;
    stop_sequence: number;
    stop_headsign: string;
    platform: string;
    stop_data: StopData;
    trip_data: TripData;
    route_color: string;
}

export interface StopData {
    location_type: number;
    parent_station: string;
    stop_code: string;
    stop_id: string;
    stop_lat: number;
    stop_lon: number;
    stop_name: string;
    wheelchair_boarding: number;
    platform_number: string;
    stop_type: string;
    stop_sequence: number;
}

export interface TripData {
    bikes_allowed: number;
    direction_id: number;
    route_id: string;
    service_id: string;
    shape_id: string;
    trip_headsign: string;
    trip_id: string;
    wheelchair_accessible: number;
}

export interface TripUpdate {
    trip: Trip;
    stop_time_update: StopTimeUpdate;
    vehicle: TripUpdateVehicle;
    timestamp: number;
    delay: number;
}

export interface StopTimeUpdate {
    stop_sequence: number;
    arrival: Arrival;
    departure: Arrival;
    stop_id: string;
    schedule_relationship: number;
}

export interface Arrival {
    delay: number;
    time: number;
}

export interface Trip {
    trip_id: string;
    start_time: string;
    start_date: string;
    schedule_relationship: number;
    route_id: string;
    direction_id?: number;
}

export interface TripUpdateVehicle {
    trip: Trip;
    position: Position;
    timestamp: number;
    vehicle: VehicleVehicle;
    occupancy_status: number;
}

export interface Position {
    latitude: number;
    longitude: number;
    speed: number;
}

export interface VehicleVehicle {
    id: string;
    label: string;
    license_plate: string;
    type: string;
}