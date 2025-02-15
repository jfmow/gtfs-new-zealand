package at

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/api/routing"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	"github.com/robfig/cron/v3"
)

var gzipConfig = middleware.GzipConfig{
	Level: 5,
}

var localTimeZone = time.FixedZone("NZST", 13*60*60)

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Time    int64  `json:"time"`
}

var notificationMutex sync.Mutex
var notificationMutex2 sync.Mutex

func SetupProvider(primaryRouter *echo.Group, gtfsData gtfs.Database, realtime rt.RealtimeS, realtimeVehicles, realtimeTripUpdates, realtimeAlerts string) {

	vehicles, _ := realtime.Vehicles(realtimeVehicles, 20*time.Second)
	tripUpdates, _ := realtime.TripUpdates(realtimeTripUpdates, 20*time.Second)
	alerts, _ := realtime.Alerts(realtimeAlerts, 30*time.Second)

	servicesRouter := primaryRouter.Group("/services")
	stopsRouter := primaryRouter.Group("/stops")
	routesRouter := primaryRouter.Group("/routes")
	realtimeRouter := primaryRouter.Group("/realtime")
	navigationRouter := primaryRouter.Group("/map")
	notificationRouter := primaryRouter.Group("/notifications")

	stopsRouter.Use(middleware.GzipWithConfig(gzipConfig))
	routesRouter.Use(middleware.GzipWithConfig(gzipConfig))
	realtimeRouter.Use(middleware.GzipWithConfig(gzipConfig))
	navigationRouter.Use(middleware.GzipWithConfig(gzipConfig))

	notificationDB, err := newDatabase(localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println(err)
	}

	c := cron.New(cron.WithLocation(localTimeZone))

	c.AddFunc("@every 00h00m20s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if notificationMutex.TryLock() {
				defer notificationMutex.Unlock()
				// fmt.Println("Checking canceled trips")
				updates, err := tripUpdates.GetTripUpdates()
				if err == nil {
					if err := notificationDB.NotifyTripUpdates(updates, gtfsData); err != nil {
						fmt.Println(err)
					}
				} else {
					fmt.Println(err)
				}
			} else {
				fmt.Println("cancellation notification mutex locked")
			}
		}
	})

	c.AddFunc("@every 00h00m30s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if notificationMutex2.TryLock() {
				defer notificationMutex2.Unlock()
				fmt.Println("Checking alerts")
				alerts, err := alerts.GetAlerts()
				if err == nil {
					if err := notificationDB.NotifyAlerts(alerts, gtfsData); err != nil {
						fmt.Println(err)
					}
				} else {
					fmt.Println(err)
				}
			} else {
				fmt.Println("alert notification mutex locked")
			}
		}
	})

	c.AddFunc("@every 00h05m00s", func() {
		var limit = 500
		var offset = 0
		now := time.Now().In(localTimeZone)
		for {
			clients, err := notificationDB.GetNotificationClients(limit, offset)
			if err != nil {
				fmt.Println(err)
				break
			}
			if len(clients) == 0 {
				break
			}

			offset += limit

			for _, client := range clients {
				if client.ExpiryWarningSent == 1 {
					continue //already warned
				}
				created := time.Unix(int64(client.Created), 0)
				durationSinceCreation := now.Sub(created)

				// Define the 29-day and 30-day thresholds
				twentyNineDays := 29 * 24 * time.Hour
				thirtyDays := 30 * 24 * time.Hour

				// Check if it has been more than 29 days but less than 30 days
				if durationSinceCreation > twentyNineDays && durationSinceCreation < thirtyDays {
					//fmt.Println("It has been more than 29 days but less than 30 days since creation.")
					if err := notificationDB.SetClientExpiryWarningSent(client); err == nil {
						notificationDB.SendNotification(client, "It's about to be 30 days since you enabled notifications, please open the app to refresh your notifications to continue to receive alerts.", "Your notifications are going to expire!", map[string]string{"url": "/notifications"})
					}
				}
			}
		}
	})

	if val := os.Getenv("PRODUCTION"); val != "false" {
		c.Start()
	}

	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	servicesRouter.GET("/:stationName", func(c echo.Context) error {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Recovered from panic: %v", r)
			}
		}()

		stopName := c.PathParam("stationName")

		// Fetch stop data
		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		now := time.Now().In(localTimeZone)
		currentTime := now.Format("15:04:05")

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, currentTime, "", 12)
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
						Name: stop.StopName,
					}
					response.Tracking = 2
					response.TripId = service.TripID
					response.Time = time.Now().In(localTimeZone).Unix()

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
			}()

			go func() {
				tripUpdatesData, _ := tripUpdates.GetTripUpdates()

				for _, service := range services {
					var ResponseData ServicesResponse2
					ResponseData.Type = "trip update"
					if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {

						defaultArrivalTime, err := time.ParseInLocation("15:04:05", service.ArrivalTime, localTimeZone)
						if err != nil {
							continue
						}

						// Add delay
						newTime := defaultArrivalTime.Add(time.Duration(tripUpdate.Delay) * time.Second)

						// Correct time formatting
						formattedTime := newTime.Format("15:04:05")

						ResponseData.ArrivalTime = formattedTime

						ResponseData.StopsAway = int16(service.StopSequence - int(tripUpdate.StopTimeUpdate.StopSequence))
						if tripUpdate.StopTimeUpdate.ScheduleRelationship == 3 {
							ResponseData.Canceled = true
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

				}
			}()

			go func() {
				vehicleLocations, _ := vehicles.GetVehicles()

				for _, service := range services {
					var ResponseData ServicesResponse2
					ResponseData.Type = "vehicle"
					if foundVehicle, err := vehicleLocations.GetVehicleByTripID(service.TripID); err == nil {
						ResponseData.Occupancy = int8(foundVehicle.OccupancyStatus)
						ResponseData.Tracking = 1
					} else {
						ResponseData.Tracking = 0
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
							log.Printf("Error writing vehicles updates: %v", err)
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
			log.Printf("The client is disconnected: %v\n", c.RealIP())
		}()

		sendTripUpdates(ctx, w, flusher)

		ticker := time.NewTicker(15 * time.Second) //How often gtfs realtime updates
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("SSE client disconnected, ip: %v", c.RealIP())
				return nil
			case <-ticker.C:
				sendTripUpdates(ctx, w, flusher)
			}
		}
	})

	servicesRouter.GET("/:stationName/schedule", func(c echo.Context) error {
		stopName := c.PathParam("stationName")

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
		//currentTime := now.Format("15:04:05")
		dateString := now.Format("20060102")

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := gtfsData.GetActiveTrips(a.StopId, "", dateString, 400)
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

	//Returns a route by routeId
	routesRouter.GET("/find-route/:routeId", func(c echo.Context) error {

		stopName := c.PathParam("routeId")

		routes, err := gtfsData.SearchForRouteByID(stopName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no matching routes found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    routes,
		})
	})

	//Returns a list of all stops from the AT api
	primaryRouter.GET("/stops", func(c echo.Context) error {
		stops, err := gtfsData.GetStops(true)
		if len(stops) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no stops found",
				Data:    nil,
			})
		}

		noChildren := c.QueryParam("noChildren")

		var filteredStops gtfs.Stops

		if noChildren == "1" {
			for _, i := range stops {
				if i.LocationType == 1 {
					filteredStops = append(filteredStops, i)
				} else if i.LocationType == 0 && i.ParentStation == "" {
					filteredStops = append(filteredStops, i)
				}
			}
		}

		if len(filteredStops) == 0 {
			return c.JSON(http.StatusOK, Response{
				Code:    http.StatusOK,
				Message: "",
				Data:    stops,
			})
		} else {
			return c.JSON(http.StatusOK, Response{
				Code:    http.StatusOK,
				Message: "",
				Data:    filteredStops,
			})
		}

	})

	//Returns a list of routes from the AT api
	primaryRouter.GET("/routes", func(c echo.Context) error {
		routes, err := gtfsData.GetRoutes()

		if len(routes) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no routes found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    routes,
		})
	})

	//Return a route by routeId
	routesRouter.GET("/:routeID", func(c echo.Context) error {
		routeID := c.PathParam("routeID")
		routes, err := gtfsData.SearchForRouteByID(routeID)

		if len(routes) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no route found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    routes,
		})
	})

	//Returns stops for a trip by tripId
	stopsRouter.GET("/:tripId", func(c echo.Context) error {
		tripId := c.PathParam("tripId")

		stops, err := gtfsData.GetStopsForTripID(tripId)
		if len(stops) == 0 || err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no stops found for trip",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    stops,
		})
	})

	//Returns alerts from AT for a stop
	stopsRouter.GET("/alerts/:stopName", func(c echo.Context) error {
		stopName := c.PathParam("stopName")

		stop, err := gtfsData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop name/code",
				Data:    nil,
			})
		}
		childStops, _ := gtfsData.GetChildStopsByParentStopID(stop.StopId)

		alerts, err := alerts.GetAlerts()
		if err != nil {
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no alerts found",
				Data:    nil,
			})
		}

		var foundRoutes []gtfs.Route

		for _, child := range childStops {
			routes, err := gtfsData.GetRoutesByStopId(child.StopId)
			if err != nil {
				continue
			}
			for _, v := range routes {
				if containsRoute(foundRoutes, v.RouteId) {
					continue
				}
				foundRoutes = append(foundRoutes, v)
			}

		}

		if len(foundRoutes) == 0 {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no routes found for stop",
				Data:    nil,
			})
		}

		var foundAlerts rt.AlertMap

		for _, route := range foundRoutes {
			alertsForRoute, err := alerts.FindAlertsByRouteId(route.RouteId)
			if err != nil {
				return c.String(404, "No alerts found for route")
			}
			foundAlerts = append(foundAlerts, alertsForRoute...)
		}

		for _, a := range foundAlerts {
			for i := range a.InformedEntity {
				if a.InformedEntity[i].StopID != "" {
					stop, err := gtfsData.GetStopByStopID(a.InformedEntity[i].StopID)
					if err != nil {
						continue
					}
					a.InformedEntity[i].StopID = stop.StopName
				}
			}
		}

		date := c.QueryParam("date")

		// Validate that the date is a 13-digit millisecond timestamp
		dateRegex := regexp.MustCompile(`^\d{13}$`)

		if date != "" {
			// If the date format is invalid, return an error
			if !dateRegex.MatchString(date) {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid date format",
					Data:    nil,
				})
			}

			// Try to parse the date as an integer
			dateNumber, err := strconv.ParseInt(date, 10, 64)
			if err != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid date",
					Data:    nil,
				})
			}

			// Convert the timestamp to a date, truncating to the day
			dateTime := time.UnixMilli(dateNumber)
			roundedDate := time.Date(dateTime.Year(), dateTime.Month(), dateTime.Day(), 0, 0, 0, 0, dateTime.Location())

			var filteredAlerts []rt.Alert
			// Iterate through alerts and compare dates
			for _, alert := range foundAlerts {
				// Convert alert active period times from milliseconds to time.Time
				startTime := time.Unix(int64(alert.ActivePeriod[0].Start), 0)
				endTime := time.Unix(int64(alert.ActivePeriod[0].End), 0)

				// Create dates set to midnight of the start and end days
				startDate := time.Date(startTime.Year(), startTime.Month(), startTime.Day(), 0, 0, 0, 0, startTime.Location()) // Midnight of start time
				endDate := time.Date(endTime.Year(), endTime.Month(), endTime.Day(), 0, 0, 0, 0, endTime.Location())           // Midnight of end time

				// Check if roundedDate is within the range of startDate and endDate
				if roundedDate.After(startDate) && roundedDate.Before(endDate.AddDate(0, 0, 1)) {
					filteredAlerts = append(filteredAlerts, alert) // Inside the period
				} else if roundedDate.Equal(startDate) || roundedDate.Equal(endDate) {
					filteredAlerts = append(filteredAlerts, alert) // Exact start or end day
				} else if roundedDate.Equal(endDate) {
					filteredAlerts = append(filteredAlerts, alert) // The day after the end day
				}
			}

			if len(filteredAlerts) >= 1 {
				return c.JSON(http.StatusOK, Response{
					Code:    http.StatusOK,
					Message: "",
					Data:    filteredAlerts,
				})
			} else {
				return c.JSON(http.StatusNotFound, Response{
					Code:    http.StatusNotFound,
					Message: "no alerts found for stop",
					Data:    nil,
				})
			}
		} else {
			return c.JSON(http.StatusOK, Response{
				Code:    http.StatusOK,
				Message: "",
				Data:    foundAlerts,
			})
		}

	})

	//Returns the closest stop to a given lat,lon
	stopsRouter.POST("/closest-stop", func(c echo.Context) error {
		latStr := c.FormValue("lat")
		lonStr := c.FormValue("lon")

		// Convert lat and lon to float64
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid lat",
				Data:    nil,
			})
		}

		lon, err := strconv.ParseFloat(lonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid lon",
				Data:    nil,
			})
		}

		stops, err := gtfsData.GetStops(true)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no stops found",
				Data:    nil,
			})
		}

		var sortedArray gtfs.Stops
		for _, i := range stops {
			if i.LocationType == 1 {
				sortedArray = append(sortedArray, i)
			} else if i.LocationType == 0 && i.ParentStation == "" {
				sortedArray = append(sortedArray, i)
			}
		}

		closetStop := sortedArray.FindClosestStops(lat, lon)

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    closetStop,
		})
	})

	//Returns all the stops matching the name, is a search function. e.g bald returns [Baldwin Ave Train Station, ymca...etc] stop data
	stopsRouter.GET("/find-stop/:stopName", func(c echo.Context) error {

		stopName := c.PathParam("stopName")
		children := c.QueryParam("children")

		stops, err := gtfsData.SearchForStopsByNameOrCode(stopName, children == "true")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no stops matching found",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    stops,
		})
	})

	//Returns the route of a route as geo json
	navigationRouter.POST("/geojson/shapes", func(c echo.Context) error {
		tripId := c.FormValue("tripId")
		routeId := c.FormValue("routeId")

		shapes, err := gtfsData.GetShapeByTripID(tripId)
		if err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusNotFound, Response{
				Code:    http.StatusNotFound,
				Message: "no route line found",
				Data:    nil,
			})
		}
		geoJson, err := shapes.ToGeoJSON()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "problem generating route line",
				Data:    nil,
			})
		}

		route, err := gtfsData.GetRouteByID(routeId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid route id",
				Data:    nil,
			})
		}

		type MapResponse struct {
			Color   string `json:"color"`
			GeoJson any    `json:"geojson"`
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data: MapResponse{
				GeoJson: geoJson,
				Color:   route.RouteColor,
			},
		})
	})

	//Returns all the locations of vehicles from the AT api
	realtimeRouter.POST("/live", func(c echo.Context) error {
		vehicleType := c.FormValue("vehicle_type")
		tripId := c.FormValue("tripId")

		vehicles, err := vehicles.GetVehicles()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no vehicles found",
				Data:    nil,
			})
		}
		tripupdates, err := tripUpdates.GetTripUpdates()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "no trip updates found",
				Data:    nil,
			})
		}

		type res struct {
			Vehicle    rt.Vehicle    `json:"vehicle"`
			TripUpdate rt.TripUpdate `json:"trip_update"`
		}

		var result []res
		for _, i := range vehicles {
			var item res
			if tripId != "" && i.Trip.TripID != tripId {
				//skip
				continue
			}
			route, err := gtfsData.GetRouteByID((string)(i.Trip.RouteID))
			if err == nil && (route.VehicleType == vehicleType || vehicleType == "" || vehicleType == "all") {
				i.Trip.RouteID = rt.RouteID(route.RouteId)
				i.Vehicle.Type = route.VehicleType
				item.Vehicle = i
				item.TripUpdate, _ = tripupdates.ByTripID(i.Trip.TripID)
				result = append(result, item)
			}
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "",
			Data:    result,
		})
	})

	//Finds a walking route from lat,lon to lat,lon using osrm
	navigationRouter.POST("/nav", func(c echo.Context) error {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
		defer cancel()

		slatStr := c.FormValue("startLat")
		slonStr := c.FormValue("startLon")
		elatStr := c.FormValue("endLat")
		elonStr := c.FormValue("endLon")
		method := c.FormValue("method")

		if method == "" {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "missing method (walking/driving)",
				Data:    nil,
			})
		}

		// Convert lat and lon to float64
		slat, err := strconv.ParseFloat(slatStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lat",
				Data:    nil,
			})
		}

		slon, err := strconv.ParseFloat(slonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lon",
				Data:    nil,
			})
		}

		elat, err := strconv.ParseFloat(elatStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lat",
				Data:    nil,
			})
		}

		elon, err := strconv.ParseFloat(elonStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lon",
				Data:    nil,
			})
		}

		if slat == 0 || slon == 0 {
			return c.JSON(http.StatusTeapot, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid start lat & lon",
				Data:    nil,
			})
		}
		if elat == 0 || elon == 0 {
			return c.JSON(http.StatusTeapot, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid end lat & lon",
				Data:    nil,
			})
		}

		start := routing.Coordinates{Lat: slat, Lon: slon} // Start point
		end := routing.Coordinates{Lat: elat, Lon: elon}   // End point

		var result routing.GeoJSONResponse
		done := make(chan struct{})

		go func() {
			defer close(done)
			switch method {
			case "walking":
				result = routing.GetWalkingDirections(start, end)
			case "driving":
				result = routing.GetDrivingDirections(start, end)
			default:
				c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid method",
					Data:    nil,
				})
				return
			}
		}()

		select {
		case <-ctx.Done():
			log.Println("Request timed out")
			return c.JSON(http.StatusRequestTimeout, Response{
				Code:    http.StatusRequestTimeout,
				Message: "request took too long",
				Data:    nil,
			})
		case <-done:
			if len(result.Features) == 0 {
				return c.JSON(http.StatusNotFound, Response{
					Code:    http.StatusNotFound,
					Message: "no route found",
					Data:    nil,
				})
			}
			return c.JSON(http.StatusOK, Response{
				Code:    http.StatusOK,
				Message: "",
				Data:    result,
			})
		}
	})

	notificationRouter.POST("/add", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")

		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		err = notificationDB.CreateNotificationClient(endpoint, p256dh, auth, stop.StopId, gtfsData)
		if err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "added",
			Data:    nil,
		})
	})

	notificationRouter.POST("/refresh", func(c echo.Context) error {
		old_endpoint := c.FormValue("old_endpoint")
		old_p256dh := c.FormValue("old_p256dh")
		old_auth := c.FormValue("old_auth")

		new_endpoint := c.FormValue("new_endpoint")
		new_p256dh := c.FormValue("new_p256dh")
		new_auth := c.FormValue("new_auth")

		_, err := notificationDB.RefreshSubscription(Notification{
			Endpoint: old_endpoint,
			P256dh:   old_p256dh,
			Auth:     old_auth,
		}, Notification{
			Endpoint: new_endpoint,
			P256dh:   new_p256dh,
			Auth:     new_auth,
		})
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "refreshed subscription",
			Data:    nil,
		})
	})

	notificationRouter.POST("/find-client", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		var stopId string = ""

		if stopIdOrName != "" {
			stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName)
			if err != nil {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = stop.StopId
		}

		notification, err := notificationDB.FindNotificationClientByParentStop(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "subscription found",
			Data:    notification,
		})
	})

	notificationRouter.POST("/remove", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		var stopId string = ""

		if stopIdOrName != "" {
			stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName)
			if err != nil {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = stop.StopId
		}

		err = notificationDB.DeleteNotificationClient(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "subscription removed",
			Data:    nil,
		})
	})

}

func containsRoute(routes []gtfs.Route, routeID string) bool {
	for _, r := range routes {
		if r.RouteId == routeID {
			return true
		}
	}
	return false
}
