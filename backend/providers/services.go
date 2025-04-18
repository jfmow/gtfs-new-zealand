package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

func setupServicesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache func() map[string]stopsForTripId, getParentStopCache func() []gtfs.Stop) {
	servicesRoute := primaryRoute.Group("/services")

	servicesRoute.GET("/:stationName", func(c echo.Context) error {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Recovered from panic: %v", r)
			}
		}()

		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop",
				Data:    nil,
			})
		}

		// Fetch stop data
		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		now := time.Now().In(localTimeZone).Add(-10 * time.Minute)
		currentTime := now.Format("15:04:05")

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, currentTime, now, 20)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no services found for stop",
				Data:    nil,
			})
		}

		var filteredServices []gtfs.StopTimes
		stopsForTripCache := getStopsForTripCache()
		for _, service := range services {
			stopsForService, found := stopsForTripCache[service.TripID]
			if found {
				if stopsForService.LowestSequence == 1 {
					service.StopSequence = service.StopSequence - 1
				}
				if service.StopSequence != len(stopsForService.Stops) {
					filteredServices = append(filteredServices, service)
				}
			}
		}

		services = filteredServices

		// Set SSE headers
		w := c.Response()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		// Flush writer to keep the connection open
		flusher, ok := w.Writer.(http.Flusher)
		if !ok {
			return fmt.Errorf("streaming unsupported by ResponseWriter")
		}

		var mu sync.Mutex // Mutex for serializing writes

		sendTripUpdates := func(ctx context.Context, w http.ResponseWriter, flusher http.Flusher) {
			go func() {
				now := time.Now().In(localTimeZone)
				for _, service := range services {
					var response ServicesResponse2
					response.Type = "service"
					response.StopsAway = int16(service.StopSequence)

					response.ArrivalTime = service.ArrivalTime

					if service.StopHeadsign != "" {
						response.Headsign = service.StopHeadsign
					} else {
						response.Headsign = service.TripData.TripHeadsign
					}
					response.Platform = service.Platform
					response.Route = &ServicesRoute{
						RouteId:        service.TripData.RouteID,
						RouteShortName: service.RouteShortName,
					}
					if service.RouteColor != "" {
						response.Route.RouteColor = service.RouteColor
					} else {
						response.Route.RouteColor = "000000"
					}
					response.Stop = &ServicesStop{
						Id:   service.StopId,
						Lat:  service.StopData.StopLat,
						Lon:  service.StopData.StopLon,
						Name: stop.StopName + " " + stop.StopCode,
					}
					response.Tracking = 2
					response.TripId = service.TripID
					response.Time = time.Now().In(localTimeZone).Unix()
					defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
					if err == nil {
						// Combine today's date with the parsed time
						defaultArrivalTime = time.Date(
							now.Year(), now.Month(), now.Day(),
							defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(),
							0, localTimeZone,
						)

						timeTillArrival := int(math.Round(defaultArrivalTime.Sub(now).Minutes()))

						if timeTillArrival <= -1 {
							departed := true
							response.Departed = &departed
						}
						response.TimeTillArrival = &timeTillArrival
					}

					jsonData, _ := json.Marshal(response)

					select {
					case <-ctx.Done():
						return
					default:
						mu.Lock()
						if ctx.Err() != nil { // Check if the context is canceled
							log.Printf("Client disconnected")
							mu.Unlock()
							return
						}

						if _, err := fmt.Fprintf(w, "data: %s\n\n", jsonData); err != nil {
							log.Printf("Error writing service updates: %v", err)
							mu.Unlock()
							return
						}
						flusher.Flush()
						mu.Unlock()
					}
				}

				tripUpdatesData, _ := realtime.GetTripUpdates()
				vehicleLocations, _ := realtime.GetVehicles()
				for _, service := range services {
					var ResponseData ServicesResponse2
					ResponseData.Type = "realtime"
					if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
						ResponseData.Occupancy = int8(foundVehicle.GetOccupancyStatus())
						ResponseData.Tracking = 1
						if foundVehicle.GetTrip().GetScheduleRelationship() == 3 {
							canceled := true
							ResponseData.Canceled = &canceled
						}
					} else {
						ResponseData.Tracking = 0
					}
					if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
						defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
						if err == nil {

							defaultArrivalTime = time.Date(
								now.Year(), now.Month(), now.Day(),
								defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(),
								0, localTimeZone,
							)

							// Add delay
							newTime := defaultArrivalTime.Add(time.Duration(tripUpdate.GetDelay()) * time.Second)

							// Correct time formatting
							formattedTime := newTime.Format("15:04:05")

							ResponseData.ArrivalTime = formattedTime
							timeTillArrival := int(math.Round(newTime.Sub(now).Minutes()))

							if newTime.Add(1*time.Minute).Before(now) || timeTillArrival <= -1 {
								departed := true
								ResponseData.Departed = &departed
							} else {
								departed := false
								ResponseData.Departed = &departed
							}
							ResponseData.TimeTillArrival = &timeTillArrival

							stopUpdates := tripUpdate.GetStopTimeUpdate()

							_, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
							if err == nil {
								nextStopSequence, _, _ := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)
								stopsAway := int16(service.StopData.Sequence) - int16(lowestSequence) - int16(nextStopSequence)
								ResponseData.StopsAway = stopsAway
								if stopsAway <= -1 {
									departed := true
									ResponseData.Departed = &departed
								}
							}

							if tripUpdate.GetTrip().GetScheduleRelationship() == 3 {
								canceled := true
								ResponseData.Canceled = &canceled
							}
						}

					}

					ResponseData.TripId = service.TripID
					ResponseData.Time = time.Now().In(localTimeZone).Unix()
					jsonData, _ := json.Marshal(ResponseData)

					select {
					case <-ctx.Done():
						return
					default:
						mu.Lock()
						if ctx.Err() != nil { // Check if the context is canceled
							log.Printf("Client disconnected")
							mu.Unlock()
							return
						}

						if _, err := fmt.Fprintf(w, "data: %s\n\n", jsonData); err != nil {
							log.Printf("Error writing trip updates: %v", err)
							mu.Unlock()
							return
						}
						flusher.Flush()
						mu.Unlock()
					}

				}
			}()

		}

		ctx, cancel := context.WithCancel(c.Request().Context())
		defer cancel()

		go func() {
			<-ctx.Done() // Wait for the client to disconnect
			//log.Printf("The client is disconnected: %v\n", c.RealIP())
		}()

		sendTripUpdates(ctx, w, flusher)

		ticker := time.NewTicker(15 * time.Second) //How often gtfs realtime updates
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				//log.Printf("SSE client disconnected, ip: %v", c.RealIP())
				return nil
			case <-ticker.C:
				sendTripUpdates(ctx, w, flusher)
			}
		}
	})

	servicesRoute.GET("/:stationName/schedule", func(c echo.Context) error {
		stopNameEncoded := c.PathParam("stationName")
		stopName, err := url.PathUnescape(stopNameEncoded)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop",
				Data:    nil,
			})
		}

		// Fetch stop data
		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.String(http.StatusNotFound, "No stop found with name")
		}

		date := c.QueryParam("date")

		dateInt, err := strconv.ParseInt(date, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid date",
				Data:    nil,
			})
		}
		now := time.Unix(dateInt, 0).In(localTimeZone)

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, "", now, 1000)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no services found",
				Data:    nil,
			})
		}

		// Sort services by arrival time
		sort.Slice(services, func(i, j int) bool {
			return services[i].ArrivalTime < services[j].ArrivalTime
		})

		var result []ServicesResponse2

		for _, service := range services {
			var response ServicesResponse2
			response.Type = "service"
			response.ArrivalTime = service.ArrivalTime
			if service.StopHeadsign != "" {
				response.Headsign = service.StopHeadsign
			} else {
				response.Headsign = service.TripData.TripHeadsign
			}
			response.Platform = service.Platform
			response.Route = &ServicesRoute{
				RouteId:        service.TripData.RouteID,
				RouteShortName: service.RouteShortName,
				RouteColor:     service.RouteColor,
			}
			response.Stop = &ServicesStop{
				Id:   service.StopId,
				Lat:  service.StopData.StopLat,
				Lon:  service.StopData.StopLon,
				Name: stop.StopName,
			}
			response.Tracking = 2
			response.TripId = service.TripID
			response.Time = time.Now().In(localTimeZone).Unix()

			result = append(result, response)
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    result,
		})
	})
}

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
	Canceled    *bool  `json:"canceled,omitempty"`

	Route *ServicesRoute `json:"route,omitempty"`

	Stop *ServicesStop `json:"stop,omitempty"`

	Tracking        int8  `json:"tracking"` //0: no, 1: yes, 2: loading
	Departed        *bool `json:"departed,omitempty"`
	TimeTillArrival *int  `json:"time_till_arrival,omitempty"`
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
