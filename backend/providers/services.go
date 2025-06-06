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

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

// TODO: rewrite the services sse
func setupServicesRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime rt.Realtime, localTimeZone *time.Location, getStopsForTripCache caches.StopsForTripCache, getParentStopCache caches.ParentStopsCache) {
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
				if service.TripData.TripHeadsign == "" && len(stopsForService.Stops) > 0 {
					service.TripData.TripHeadsign = stopsForService.Stops[0].StopHeadsign
				}
				if stopsForService.LowestSequence == 1 {
					service.StopSequence -= 1
				}
				if service.StopSequence != len(stopsForService.Stops)-1 {
					filteredServices = append(filteredServices, service)
				}
			}
		}

		services = filteredServices

		w := c.Response()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.Writer.(http.Flusher)
		if !ok {
			return fmt.Errorf("streaming unsupported by ResponseWriter")
		}

		var mu sync.Mutex
		ctx, cancel := context.WithCancel(c.Request().Context())
		defer cancel()

		go func() {
			<-ctx.Done()
			log.Printf("Client disconnected: %s", c.RealIP())
		}()

		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		sendUpdates := func() {
			mu.Lock()
			defer mu.Unlock()

			now := time.Now().In(localTimeZone)
			tripUpdatesData, _ := realtime.GetTripUpdates()
			vehicleLocations, _ := realtime.GetVehicles()

			for _, service := range services {
				sendService := func(data ServicesResponse2) {
					jsonData, err := json.Marshal(data)
					if err != nil {
						log.Printf("JSON marshal error: %v", err)
						return
					}

					if _, err := fmt.Fprintf(w, "data: %s\n\n", jsonData); err != nil {
						log.Printf("Write error: %v", err)
						cancel()
						return
					}
					flusher.Flush()
				}

				// Static service info
				resp := ServicesResponse2{
					Type:               "service",
					StopsAway:          int16(service.StopSequence),
					ArrivalTime:        service.ArrivalTime,
					Headsign:           service.StopHeadsign,
					Platform:           service.Platform,
					Route:              &ServicesRoute{RouteId: service.TripData.RouteID, RouteShortName: service.RouteShortName},
					Stop:               &ServicesStop{Id: service.StopId, Lat: service.StopData.StopLat, Lon: service.StopData.StopLon, Name: stop.StopName + " " + stop.StopCode},
					Tracking:           2,
					TripId:             service.TripID,
					Time:               now.Unix(),
					WheelchairsAllowed: &service.StopData.WheelChairBoarding,
					BikesAllowed:       &service.TripData.BikesAllowed,
				}

				if service.RouteColor != "" {
					resp.Route.RouteColor = service.RouteColor
				} else {
					resp.Route.RouteColor = "000000"
				}

				defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
				if err == nil {
					defaultArrivalTime = time.Date(now.Year(), now.Month(), now.Day(), defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(), 0, localTimeZone)
					timeTillArrival := int(math.Round(defaultArrivalTime.Sub(now).Minutes()))
					resp.TimeTillArrival = &timeTillArrival

					if timeTillArrival <= -1 {
						departed := true
						resp.Departed = &departed
					}
				}

				sendService(resp)

				// Realtime info
				rtResp := ServicesResponse2{
					Type:   "realtime",
					TripId: service.TripID,
					Time:   now.Unix(),
				}

				if foundVehicle, err := vehicleLocations.ByTripID(service.TripID); err == nil {
					rtResp.Occupancy = int8(foundVehicle.GetOccupancyStatus())
					rtResp.Tracking = 1
					if foundVehicle.GetTrip().GetScheduleRelationship() == 3 {
						cancelled := true
						rtResp.Canceled = &cancelled
					}
				} else {
					rtResp.Tracking = 0
				}

				if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
					defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
					if err == nil {
						defaultArrivalTime = time.Date(now.Year(), now.Month(), now.Day(), defaultArrivalTime.Hour(), defaultArrivalTime.Minute(), defaultArrivalTime.Second(), 0, localTimeZone)
						newTime := defaultArrivalTime.Add(time.Duration(tripUpdate.GetDelay()) * time.Second)

						formattedTime := newTime.Format("15:04:05")
						rtResp.ArrivalTime = formattedTime

						timeTillArrival := int(math.Round(newTime.Sub(now).Minutes()))
						rtResp.TimeTillArrival = &timeTillArrival

						if timeTillArrival <= -1 {
							departed := true
							rtResp.Departed = &departed
						} else {
							departed := false
							rtResp.Departed = &departed
						}

						stopUpdates := tripUpdate.GetStopTimeUpdate()
						_, lowestSequence, err := gtfsData.GetStopsForTripID(service.TripID)
						if err == nil {
							nextStopSeq, _, _ := getNextStopSequence(stopUpdates, lowestSequence, localTimeZone)
							stopsAway := int16(service.StopData.Sequence) - int16(lowestSequence) - int16(nextStopSeq)
							rtResp.StopsAway = stopsAway
						}

						if tripUpdate.GetTrip().GetScheduleRelationship() == 3 {
							cancelled := true
							rtResp.Canceled = &cancelled
						}
					}
				}

				sendService(rtResp)
			}
		}

		// initial push
		sendUpdates()

		for {
			select {
			case <-ctx.Done():
				return nil
			case <-ticker.C:
				sendUpdates()
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

	TripId             string `json:"trip_id,omitempty"`
	Headsign           string `json:"headsign,omitempty"`
	ArrivalTime        string `json:"arrival_time,omitempty"`
	Platform           string `json:"platform,omitempty"`
	StopsAway          int16  `json:"stops_away"`
	Occupancy          int8   `json:"occupancy,omitempty"`
	Canceled           *bool  `json:"canceled,omitempty"`
	BikesAllowed       *int   `json:"bikes_allowed,omitempty"`
	WheelchairsAllowed *int   `json:"wheelchairs_allowed,omitempty"`

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
