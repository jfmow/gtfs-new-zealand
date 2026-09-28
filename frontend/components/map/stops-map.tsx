/** A stop from `/stops` or `/stops/closest-stop`. */
export interface Stop {
    location_type: number;
    parent_station: string;
    stop_code: string;
    stop_id: string;
    stop_lat: number;
    stop_lon: number;
    stop_name: string;
    stop_headsign: string;
    wheelchair_boarding: number;
    platform_number: string;
    stop_type: string;
    stop_sequence: number;
    is_child_stop: boolean;
}
