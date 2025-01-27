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
	"strings"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/api/geojson"
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

type ServicesResponseData struct {
	ServiceData gtfs.StopTimes `json:"service_data"`
	TripUpdate  rt.TripUpdate  `json:"trip_update"`
	Vehicle     rt.Vehicle     `json:"vehicle"`
	Has         struct {
		TripUpdate bool `json:"trip_update"`
		Vehicle    bool `json:"vehicle"`
	} `json:"has"`
	Done struct {
		Vehicle    bool `json:"vehicle"`
		TripUpdate bool `json:"trip_update"`
		Service    bool `json:"service_data"`
	} `json:"done"`
	TripId string `json:"trip_id"`
}

type ServicesResponse struct {
	Type string               `json:"type"` // trip_update, vehicle, service_data
	Data ServicesResponseData `json:"data"`
	Time int64                `json:"time"`
}

func SetupAucklandTransportAPI(router *echo.Group) {

	//Looks for the at api key from the loaded env vars or sys env if docker
	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://gtfs.at.govt.nz/gtfs.zip", "atfgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	realtimeData, err := rt.New(atApiKey, "Ocp-Apim-Subscription-Key", "atrt")
	if err != nil {
		panic(err)
	}

	vehicles, _ := realtimeData.Vehicles("https://api.at.govt.nz/realtime/legacy/vehiclelocations")
	tripUpdates, _ := realtimeData.TripUpdates("https://api.at.govt.nz/realtime/legacy/tripupdates")
	alerts, _ := realtimeData.Alerts("https://api.at.govt.nz/realtime/legacy/servicealerts")

	servicesRouter := router.Group("/services")
	stopsRouter := router.Group("/stops")
	routesRouter := router.Group("/routes")
	vehiclesRouter := router.Group("/vehicles")
	navigationRouter := router.Group("/map")
	notificationRouter := router.Group("/notifications")

	stopsRouter.Use(middleware.GzipWithConfig(gzipConfig))
	routesRouter.Use(middleware.GzipWithConfig(gzipConfig))
	vehiclesRouter.Use(middleware.GzipWithConfig(gzipConfig))
	navigationRouter.Use(middleware.GzipWithConfig(gzipConfig))

	notificationDB, err := newDatabase(localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println(err)
	}

	c := cron.New(cron.WithLocation(localTimeZone))
	var notificationMutex sync.Mutex
	var notificationMutex2 sync.Mutex

	c.AddFunc("@every 00h00m10s", func() {
		if notificationMutex.TryLock() {
			defer notificationMutex.Unlock()
			//fmt.Println("Checking canceled trips")
			updates, err := tripUpdates.GetTripUpdates()
			if err == nil {
				if err := notificationDB.NotifyTripUpdates(updates, AucklandTransportGTFSData); err != nil {
					fmt.Println(err)
				}
			} else {
				fmt.Println(err)
			}
		} else {
			fmt.Println("notification mutex locked")
		}

	})

	c.AddFunc("@every 00h00m15s", func() {
		if notificationMutex2.TryLock() {
			defer notificationMutex2.Unlock()
			//fmt.Println("Checking canceled trips")
			alerts, err := alerts.GetAlerts()
			if err == nil {
				if err := notificationDB.NotifyAlerts(alerts, AucklandTransportGTFSData); err != nil {
					fmt.Println(err)
				}
			} else {
				fmt.Println(err)
			}
		} else {
			fmt.Println("notification mutex locked")
		}

	})

	c.AddFunc("@every 00h00m10s", func() {
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

	c.Start()

	notificationRouter.POST("/add", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")

		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopIdOrName)
		if err != nil {
			return c.String(http.StatusBadRequest, "invalid stop")
		}

		err = notificationDB.CreateNotificationClient(endpoint, p256dh, auth, stop.StopId, AucklandTransportGTFSData)
		if err != nil {
			fmt.Println(err)
			return c.String(http.StatusBadRequest, "Invalid subscription")
		}

		return c.String(http.StatusOK, "added")
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
			return c.String(http.StatusBadRequest, "Invalid subscription")
		}

		return c.String(http.StatusOK, "refreshed")
	})

	notificationRouter.POST("/find-client", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		var stopId string = ""

		if stopIdOrName != "" {
			stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopIdOrName)
			if err != nil {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = stop.StopId
		}

		notification, err := notificationDB.FindNotificationClientByParentStop(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.String(http.StatusBadRequest, "Invalid subscription")
		}

		return c.JSON(http.StatusOK, notification)
	})

	notificationRouter.POST("/remove", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		var stopId string = ""

		if stopIdOrName != "" {
			stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopIdOrName)
			if err != nil {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = stop.StopId
		}

		err = notificationDB.DeleteNotificationClient(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.String(http.StatusBadRequest, "Invalid subscription")
		}

		return c.JSON(http.StatusOK, "removed")
	})

	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	servicesRouter.GET("/:stationName", func(c echo.Context) error {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Recovered from panic: %v", r)
			}
		}()

		stopName := c.PathParam("stationName")

		// Fetch stop data
		stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.String(http.StatusNotFound, "No stop found with name")
		}

		now := time.Now().In(localTimeZone)
		currentTime := now.Format("15:04:05")

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := AucklandTransportGTFSData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := AucklandTransportGTFSData.GetActiveTrips(a.StopId, currentTime, "", 12)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.String(http.StatusInternalServerError, "No services found for stop")
		}

		// Sort services by arrival time
		sort.Slice(services, func(i, j int) bool {
			return services[i].ArrivalTime < services[j].ArrivalTime
		})

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
					var response ServicesResponse
					response.Type = "service_data"
					response.Data.ServiceData = service
					response.Data.TripId = service.TripID
					response.Data.Done.Service = true

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
					var ResponseData ServicesResponseData
					if tripUpdate, err := tripUpdatesData.ByTripID(service.TripID); err == nil {
						ResponseData.Has.TripUpdate = true
						ResponseData.TripUpdate = tripUpdate
					}
					ResponseData.TripId = service.TripID
					ResponseData.Done.TripUpdate = true
					response := ServicesResponse{Type: "trip_update", Data: ResponseData, Time: time.Now().In(localTimeZone).Unix()}
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
							log.Printf("Error writing trip updates: %v", err)
							mu.Unlock()
							return
						}
						flusher.Flush()
						mu.Unlock()
					}
				}
			}()

			go func() {
				vehicleLocations, _ := vehicles.GetVehicles()

				for _, service := range services {
					var ResponseData ServicesResponseData
					if foundVehicle, err := vehicleLocations.GetVehicleByTripID(service.TripID); err == nil {
						ResponseData.Has.Vehicle = true
						route, err := AucklandTransportGTFSData.GetRouteByID((string)(foundVehicle.Trip.RouteID))
						if err == nil {
							foundVehicle.Trip.RouteID = rt.RouteID(route.RouteId)
							foundVehicle.Vehicle.Type = route.VehicleType
						}
						ResponseData.Vehicle = foundVehicle
					}
					ResponseData.TripId = service.TripID
					ResponseData.Done.Vehicle = true
					response := ServicesResponse{Type: "vehicle", Data: ResponseData, Time: time.Now().In(localTimeZone).Unix()}
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
		stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.String(http.StatusNotFound, "No stop found with name")
		}

		date := c.QueryParam("date")

		dateInt, err := strconv.ParseInt(date, 10, 64)
		if err != nil {
			return c.String(400, "Invalid date format")
		}
		now := time.Unix(dateInt, 0).In(localTimeZone)
		//currentTime := now.Format("15:04:05")
		dateString := now.Format("20060102")

		// Collect services
		var services []gtfs.StopTimes
		childStops, _ := AucklandTransportGTFSData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := AucklandTransportGTFSData.GetActiveTrips(a.StopId, "", dateString, 400)
			if err == nil {
				services = append(services, servicesAtStop...)
			}
		}

		if len(services) == 0 {
			return c.String(http.StatusInternalServerError, "No services found for stop")
		}

		// Sort services by arrival time
		sort.Slice(services, func(i, j int) bool {
			return services[i].ArrivalTime < services[j].ArrivalTime
		})

		var result []ServicesResponse

		for _, service := range services {
			var response ServicesResponse

			response.Type = "service_data"
			response.Data.ServiceData = service
			response.Data.TripId = service.TripID
			response.Data.Done.Service = true
			response.Data.Done.TripUpdate = true
			response.Data.Done.Vehicle = true
			response.Time = now.Unix()

			result = append(result, response)
		}

		return c.JSON(http.StatusOK, result)
	})

	//Returns all the stops matching the name, is a search function. e.g bald returns [Baldwin Ave Train Station, ymca...etc] stop data
	stopsRouter.GET("/find-stop/:stopName", func(c echo.Context) error {

		stopName := c.PathParam("stopName")
		children := c.QueryParam("children")

		stops, err := AucklandTransportGTFSData.SearchForStopsByName(stopName, children == "true")
		if err != nil {
			return c.String(404, "Unable to find stops for search")
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns a route by routeId
	routesRouter.GET("/find-route/:routeId", func(c echo.Context) error {

		stopName := c.PathParam("routeId")

		stops, err := AucklandTransportGTFSData.SearchForRouteByID(stopName)
		if err != nil {
			return c.String(404, "Unable to find routes for search")
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns a list of all stops from the AT api
	router.GET("/stops", func(c echo.Context) error {
		stops, err := AucklandTransportGTFSData.GetStops(true)
		if len(stops) == 0 || err != nil {
			return c.String(404, "No stops found")
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
			return c.JSON(http.StatusOK, stops)
		} else {
			return c.JSON(http.StatusOK, filteredStops)
		}

	})

	//Returns a list of stops by type, bus, train, ferry, etc...
	stopsRouter.GET("/typeof/:type", func(c echo.Context) error {
		stopType := c.PathParam("type")
		stops, err := AucklandTransportGTFSData.GetStops(true)
		if len(stops) == 0 || err != nil {
			fmt.Println(err)
			return c.String(404, "No stops found")
		}
		var filteredStops gtfs.Stops

		for _, i := range stops {
			if (i.LocationType == 0 && i.ParentStation == "") || i.LocationType == 1 {
				switch stopType {
				case "train":
					if strings.Contains(i.StopName, "Train Station") {
						filteredStops = append(filteredStops, i)
					}
				case "ferry":
					if strings.Contains(i.StopName, "Terminal") {
						filteredStops = append(filteredStops, i)
					}
				case "bus":
					if !strings.Contains(i.StopName, "Terminal") && !strings.Contains(i.StopName, "Train Station") {
						filteredStops = append(filteredStops, i)
					}

				}
			}
		}

		return c.JSON(http.StatusOK, filteredStops)
	})

	//Returns a list of routes from the AT api
	router.GET("/routes", func(c echo.Context) error {
		routes2, err := AucklandTransportGTFSData.GetRoutes()

		if len(routes2) == 0 || err != nil {
			return c.String(404, "No routes found")
		}

		return c.JSON(http.StatusOK, routes2)
	})

	//Return a route by routeId
	routesRouter.GET("/:routeID", func(c echo.Context) error {
		routeID := c.PathParam("routeID")
		routes2, err := AucklandTransportGTFSData.SearchForRouteByID(routeID)

		if len(routes2) == 0 || err != nil {
			return c.String(404, "No routes found")
		}

		return c.JSON(http.StatusOK, routes2)
	})

	//Returns stops for a trip by tripId
	stopsRouter.GET("/:tripId", func(c echo.Context) error {
		tripId := c.PathParam("tripId")

		stops, err := AucklandTransportGTFSData.GetStopsForTripID(tripId)
		if len(stops) == 0 || err != nil {
			return c.String(400, "No stops found for trip")
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns alerts from AT for a stop
	stopsRouter.GET("/alerts/:stopName", func(c echo.Context) error {
		stopName := c.PathParam("stopName")

		stop, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopName)
		if err != nil {
			return c.String(http.StatusNotFound, "No stop found with name")
		}
		childStops, _ := AucklandTransportGTFSData.GetChildStopsByParentStopID(stop.StopId)

		alerts, err := alerts.GetAlerts()
		if err != nil {
			return c.String(500, "No alerts found")
		}

		var foundRoutes []gtfs.Route

		for _, child := range childStops {
			routes, err := AucklandTransportGTFSData.GetRoutesByStopId(child.StopId)
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
			return c.String(404, "No routes found for stop")
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
					stop, err := AucklandTransportGTFSData.GetStopByStopID(a.InformedEntity[i].StopID)
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
				return c.String(400, "Invalid date format")
			}

			// Try to parse the date as an integer
			dateNumber, err := strconv.ParseInt(date, 10, 64)
			if err != nil {
				return c.String(500, "Failed to parse date")
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
				return c.JSON(http.StatusOK, filteredAlerts)
			} else {
				return c.String(404, "No alerts found for route")
			}
		} else {
			return c.JSON(http.StatusOK, foundAlerts)
		}

	})

	//Returns the route of a route as geo json
	navigationRouter.GET("/geojson/:routeId/:typeOfVehicle", func(c echo.Context) error {
		typeOfVehicle := c.PathParam("typeOfVehicle")
		routeId := c.PathParam("routeId")
		tripId := c.QueryParam("tripId")

		stops, err := geojson.GetGeoJsonDataForRoute(routeId, typeOfVehicle)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "An error occurred getting geojson",
			})
		}

		if tripId != "" {
			tripName, err := AucklandTransportGTFSData.GetTripByID(tripId)
			if err != nil {
				return c.String(404, "No trip found for trip id")
			}
			if tripName.TripHeadsign != "" {
				stops = stops.FilterByTripName(tripName.TripHeadsign)
			}
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns all the locations of vehicles from the AT api
	vehiclesRouter.GET("/locations", func(c echo.Context) error {
		vehicleType := c.QueryParam("type")

		vehicles, err := vehicles.GetVehicles()
		if err != nil {
			return c.String(500, "An error occurred getting vehicles")
		}
		tripupdates, err := tripUpdates.GetTripUpdates()
		if err != nil {
			return c.String(500, "An error occurred getting trip updates")
		}

		type res struct {
			Vehicle    rt.Vehicle    `json:"vehicle"`
			TripUpdate rt.TripUpdate `json:"trip_update"`
		}

		var result []res
		for _, i := range vehicles {
			var item res
			route, err := AucklandTransportGTFSData.GetRouteByID((string)(i.Trip.RouteID))
			if err == nil && (route.VehicleType == vehicleType || vehicleType == "") {
				i.Trip.RouteID = rt.RouteID(route.RouteId)
				i.Vehicle.Type = route.VehicleType
				item.Vehicle = i
				item.TripUpdate, _ = tripupdates.ByTripID(i.Trip.TripID)
				result = append(result, item)
			}
		}

		return c.JSON(http.StatusOK, result)
	})

	//Returns the location of a vehicle by tripId
	vehiclesRouter.GET("/locations/:tripid", func(c echo.Context) error {
		tripID := c.PathParam("tripid")

		vehicles, err := vehicles.GetVehicles()
		if err != nil {
			return c.String(500, "An error occurred getting vehicles")
		}
		tripupdates, err := tripUpdates.GetTripUpdates()
		if err != nil {
			return c.String(500, "An error occurred getting trip updates")
		}

		type res struct {
			Vehicle    rt.Vehicle    `json:"vehicle"`
			TripUpdate rt.TripUpdate `json:"trip_update"`
		}

		var result res
		for _, i := range vehicles {
			var item res
			if i.Trip.TripID == tripID {
				route, err := AucklandTransportGTFSData.GetRouteByID((string)(i.Trip.RouteID))
				if err == nil {
					i.Trip.RouteID = rt.RouteID(route.RouteId)
					i.Vehicle.Type = route.VehicleType

				}
				item.Vehicle = i
				item.TripUpdate, _ = tripupdates.ByTripID(i.Trip.TripID)
				result = item
				break
			}
		}

		return c.JSON(http.StatusOK, result)
	})

	//Returns the closest stop to a given lat,lon
	stopsRouter.POST("/closest-stop", func(c echo.Context) error {
		latStr := c.FormValue("lat")
		lonStr := c.FormValue("lon")

		// Convert lat and lon to float64
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			log.Printf("Error parsing latitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		lon, err := strconv.ParseFloat(lonStr, 64)
		if err != nil {
			log.Printf("Error parsing longitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		stops, err := AucklandTransportGTFSData.GetStops(true)
		if err != nil {
			return c.JSON(500, "An error occurred retrieving stops")
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

		return c.JSON(http.StatusOK, closetStop)
	})

	//Finds a walking route from lat,lon to lat,lon using osrm
	navigationRouter.POST("/nav", func(c echo.Context) error {
		slatStr := c.FormValue("startLat")
		slonStr := c.FormValue("startLon")
		elatStr := c.FormValue("endLat")
		elonStr := c.FormValue("endLon")

		method := c.FormValue("method")

		if method == "" {
			return c.String(400, "Missing method")
		}

		// Convert lat and lon to float64
		slat, err := strconv.ParseFloat(slatStr, 64)
		if err != nil {
			log.Printf("Error parsing latitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		slon, err := strconv.ParseFloat(slonStr, 64)
		if err != nil {
			log.Printf("Error parsing longitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		elat, err := strconv.ParseFloat(elatStr, 64)
		if err != nil {
			log.Printf("Error parsing longitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		elon, err := strconv.ParseFloat(elonStr, 64)
		if err != nil {
			log.Printf("Error parsing longitude: %v\n", err)
			return c.String(400, "Invalid location data")
		}

		if slat == 0 || slon == 0 {
			return c.String(400, "Invalid start location data")
		}
		if elat == 0 || elon == 0 {
			return c.String(400, "Invalid end location data")
		}

		start := routing.Coordinates{Lat: slat, Lon: slon} // Start point
		end := routing.Coordinates{Lat: elat, Lon: elon}   // End point

		var result routing.GeoJSONResponse

		switch method {
		case "walking":
			result = routing.GetWalkingDirections(start, end)
		case "driving":
			result = routing.GetDrivingDirections(start, end)
		default:
			return c.String(400, "Invalid method")
		}

		if len(result.Features) == 0 {
			return c.JSON(http.StatusBadRequest, "No route found")
		}

		return c.JSON(http.StatusOK, result)
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
