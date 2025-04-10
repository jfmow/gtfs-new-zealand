package at

// Services
type ServicesResponse2 struct {
	Time int64  `json:"time,omitempty"`
	Type string `json:"type"` //service, trip update, vehicle

	TripId      string `json:"trip_id,omitempty"`
	Headsign    string `json:"headsign,omitempty"`
	ArrivalTime string `json:"arrival_time,omitempty"`
	Platform    string `json:"platform,omitempty"`
	StopsAway   int16  `json:"stops_away,omitempty"`
	Occupancy   int8   `json:"occupancy,omitempty"`
	Canceled    bool   `json:"canceled,omitempty"`

	Route *ServicesRoute `json:"route,omitempty"`

	Stop *ServicesStop `json:"stop,omitempty"`

	Tracking int8 `json:"tracking"` //0: no, 1: yes, 2: loading
}

type ServicesRoute struct {
	RouteId        string `json:"id,omitempty"`
	RouteShortName string `json:"name,omitempty"`
	RouteColor     string `json:"color,omitempty"`
}

type ServicesStop struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	Platform string  `json:"platform"`
	Sequence int     `json:"sequence"`
}

// Routes
type RoutesResponse struct {
}

// Stops
type StopsResponse struct {
}

// Map
type MapResponse struct {
}

// Vehicles
type VehiclesResponse struct {
	TripId string `json:"trip_id"`
	Route  struct {
		RouteId        string `json:"id"`
		RouteShortName string `json:"name"`
		RouteColor     string `json:"color"`
	} `json:"route"`
	Trip struct {
		FirstStop   ServicesStop `json:"first_stop"`
		NextStop    ServicesStop `json:"next_stop"`
		FinalStop   ServicesStop `json:"final_stop"`
		CurrentStop ServicesStop `json:"current_stop"`

		Headsign string `json:"headsign"`
	} `json:"trip"`

	Occupancy    int8   `json:"occupancy"`
	LicensePlate string `json:"license_plate"`
	Position     struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"position"`

	Type string `json:"type"` //bus, tram, metro
}

// Notifications
type NotificationsResponse struct {
}
