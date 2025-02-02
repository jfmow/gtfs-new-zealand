package at

import "github.com/jfmow/gtfs"

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Time    int64  `json:"time"`
}

// Services
type ServicesResponse2 struct {
	TripId string `json:"trip_id"`
	Route  struct {
		RouteId        string `json:"route_id"`
		RouteShortName string `json:"route_short_name"`
		RouteColor     string `json:"route_color"`
	} `json:"route"`
	Service struct {
		ArrivalTime      string    `json:"arrival_time"`
		TripId           string    `json:"trip_id"`
		Destination      string    `json:"destination"`
		Platform         string    `json:"platform"`
		Bikes            bool      `json:"bikes"`
		WheelChairs      bool      `json:"wheelchairs"`
		NextStop         gtfs.Stop `json:"next_stop"`
		FinalStop        gtfs.Stop `json:"final_stop"`
		StopsTillArrival int       `json:"stops_away"`
	} `json:"service"`
	Realtime struct {
		Has struct {
			Vehicle    bool `json:"vehicle"`
			TripUpdate bool `json:"trip_update"`
		} `json:"has"`
	} `json:"realtime"`
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
