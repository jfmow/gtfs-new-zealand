package apis

import (
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
)

func SetupAucklandTransportAPI(router *echo.Group) {
	e := router

	//Looks for the at api key from the loaded env vars or sys env if docker
	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://gtfs.at.govt.nz/gtfs.zip", "atfgtfs")
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

	//Services stopping at a given stop, by name. e.g Baldwin Ave Train Station
	e.GET("/services/:stationName", func(c echo.Context) error {
		stopName := c.PathParam("stationName")

		stops, err := AucklandTransportGTFSData.GetStopByNameOrCode(stopName)
		if err != nil || len(stops) == 0 {
			fmt.Println(err)
			return c.String(404, "No stop found with name")
		}
		stop := stops[0]

		now := time.Now().In(time.FixedZone("NZST", 13*60*60))
		currentWeekDay := now.Weekday().String()
		currentTime := now.Format("15:04:05")

		// Format the date as YYYYMMDD string
		dateString := now.Format("20060102")

		var services []gtfs.StopTimes

		childStops, _ := AucklandTransportGTFSData.GetChildStopsByParentStopID(stop.StopId)
		for _, a := range childStops {
			servicesAtStop, err := AucklandTransportGTFSData.GetActiveTrips(dateString, currentWeekDay, a.StopId, currentTime, 30)
			if err != nil {
				fmt.Println(err)
			}

			services = append(services, servicesAtStop...)
		}

		if len(services) == 0 {
			return c.String(500, "No services found for stop")
		}

		sort.Slice(services, func(i, j int) bool {
			return services[i].ArrivalTime < services[j].ArrivalTime
		})

		type Response struct {
			ServiceData gtfs.StopTimes `json:"service_data"`
			TripUpdate  rt.TripUpdate  `json:"trip_update"`
			Vehicle     rt.Vehicle     `json:"vehicle"`
			Has         struct {
				TripUpdate bool `json:"trip_update"`
				Vehicle    bool `json:"vehicle"`
			} `json:"has"`
		}

		//TODO: put in wg

		var wg sync.WaitGroup
		var tripUpdatesData rt.TripUpdatesMap
		var vehicleLocations rt.VehiclesMap

		wg.Add(2)
		go func() {
			defer wg.Done()
			tripUpdatesData, _ = tripUpdates.GetTripUpdates()
		}()
		go func() {
			defer wg.Done()
			vehicleLocations, _ = vehicles.GetVehicles()
		}()

		wg.Wait()

		var result []Response

		for _, i := range services {
			var item Response
			vehicleloc, err := vehicleLocations.GetVehicleByTripID(i.TripID)
			if err == nil {
				item.Has.Vehicle = true
				route, err := AucklandTransportGTFSData.GetRouteByID((string)(vehicleloc.Trip.RouteID))
				if err == nil {
					vehicleloc.Trip.RouteID = rt.RouteID(route.RouteId)
					vehicleloc.Vehicle.Type = route.VehicleType
				}
				item.Vehicle = vehicleloc

			}
			tripUpdate, err := tripUpdatesData.ByTripID(i.TripID)
			if err == nil {
				item.Has.TripUpdate = true
				item.TripUpdate = tripUpdate
			}

			item.ServiceData = i
			result = append(result, item)
		}

		return c.JSON(http.StatusOK, result)
	})

	//Returns all the stops matching the name, is a search function. e.g bald returns [Baldwin Ave Train Station, ymca...etc] stop data
	e.GET("/stops/find-stop/:stopName", func(c echo.Context) error {

		stopName := c.PathParam("stopName")

		stops, err := AucklandTransportGTFSData.SearchForStopsByName(stopName, false)
		if err != nil {
			return c.String(404, "Unable to find stops for search")
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns a list of all stops from the AT api
	e.GET("/stops", func(c echo.Context) error {
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
	e.GET("/stops/typeof/:type", func(c echo.Context) error {
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
	e.GET("/routes", func(c echo.Context) error {
		routes2, err := AucklandTransportGTFSData.GetRoutes()

		if len(routes2) == 0 || err != nil {
			return c.String(404, "No routes found")
		}

		return c.JSON(http.StatusOK, routes2)
	})

	//Return a route by routeId
	e.GET("/routes/:routeID", func(c echo.Context) error {
		routeID := c.PathParam("routeID")
		routes2, err := AucklandTransportGTFSData.SearchForRouteByID(routeID)

		if len(routes2) == 0 || err != nil {
			return c.String(404, "No routes found")
		}

		return c.JSON(http.StatusOK, routes2)
	})

	//Returns stops for a trip by tripId
	e.GET("/stops/:tripId", func(c echo.Context) error {
		tripId := c.PathParam("tripId")

		stops, err := AucklandTransportGTFSData.GetStopsForTripID(tripId)
		if len(stops) == 0 || err != nil {
			return c.String(400, "No stops found for trip")
		}

		return c.JSON(http.StatusOK, stops)
	})

	//Returns alerts from AT for a route
	e.GET("/routes/alerts/:routeId", func(c echo.Context) error {
		routeId := c.PathParam("routeId")

		alerts, err := alerts.GetAlerts()
		if err != nil {
			return c.String(500, "No alerts found")
		}

		alertsForRoute, err := alerts.FindAlertsByRouteId(routeId)
		if err != nil {
			return c.String(404, "No alerts found for route")
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
			for _, alert := range alertsForRoute {
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
			return c.JSON(http.StatusOK, alertsForRoute)
		}

	})

	//Returns the route of a route as geo json
	e.GET("/map/geojson/:routeId/:typeOfVehicle", func(c echo.Context) error {
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
	e.GET("/vehicles/locations", func(c echo.Context) error {
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
	e.GET("/vehicles/locations/:tripid", func(c echo.Context) error {
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
	e.POST("/stops/closest-stop", func(c echo.Context) error {
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
	e.POST("/journey/nav", func(c echo.Context) error {
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
