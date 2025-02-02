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
	Canceled    bool   `json:"canceled"`

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
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Id   string  `json:"id"`
	Name string  `json:"name"`
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
}

// Notifications
type NotificationsResponse struct {
}
