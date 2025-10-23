package notifications

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	"github.com/labstack/echo/v5"
	"github.com/robfig/cron/v3"
)

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

var routeRegex = regexp.MustCompile("^[a-zA-Z0-9-]+$")

/*
returns nil on success or empty array
*/
func validateRoutes(routes []string) error {
	if len(routes) == 0 {
		return nil
	}

	for _, route := range routes {
		if !routeRegex.MatchString(route) {
			return fmt.Errorf("invalid route format: %q", route)
		}
	}

	return nil
}

func SetupNotificationsRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime realtime.Realtime, localTimeZone *time.Location, parentStopsCache caches.ParentStopsByChildCache, stopsForTripCache caches.StopsForTripCache) {
	var tripUpdatesCronMutex sync.Mutex
	var remindersCronMutex sync.Mutex
	var alertsCronMutex sync.Mutex
	notificationRoute := primaryRoute.Group("/notifications")

	notificationDB, err := newDatabase(localTimeZone, "hi@suddsy.dev", "at")
	if err != nil {
		fmt.Println(err)
	}

	c := cron.New(cron.WithLocation(localTimeZone))

	//Check trip updates, for cancellations
	c.AddFunc("@every 00h0m30s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if tripUpdatesCronMutex.TryLock() {
				defer tripUpdatesCronMutex.Unlock()
				updates, err := realtime.GetTripUpdates()
				if err == nil {
					notificationDB.NotifyTripUpdates(updates, gtfsData, parentStopsCache, stopsForTripCache)
				}
			}
		}
	})

	//Check realtime alerts
	c.AddFunc("@every 00h00m30s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if alertsCronMutex.TryLock() {
				defer alertsCronMutex.Unlock()
				alerts, err := realtime.GetAlerts()
				if err == nil {
					notificationDB.NotifyAlerts(alerts, gtfsData, parentStopsCache)
				}
			}
		}
	})

	//Check notification expiry
	c.AddFunc("@every 01h00m00s", func() {
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
						client.SendNotification("It's about to be 30 days since you enabled notifications, please open the app to refresh your notifications to continue to receive alerts.", "Your notifications are going to expire!", map[string]string{"url": "/notifications"}, "high")
					}
				}
			}
		}
	})

	//check reminders
	c.AddFunc("@every 00h00m30s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if remindersCronMutex.TryLock() {
				defer remindersCronMutex.Unlock()
				if hasReminders, err := notificationDB.HasAnyReminders(); err != nil || !hasReminders {
					return
				}
				updates, err := realtime.GetTripUpdates()
				if err != nil {
					return
				}
				reminders, err := notificationDB.GetAllReminders()
				if err != nil {
					return
				}
				for _, reminder := range reminders {
					tripUpdate, err := updates.ByTripID(reminder.TripId)
					if err != nil {
						continue
					}
					_, lowestSequence, err := gtfsData.GetStopsForTripID(reminder.TripId)
					if err != nil {
						continue
					}
					nextStopSequenceNumber, _, _, _ := getNextStopSequence(tripUpdate.StopTimeUpdate, lowestSequence, localTimeZone)

					if nextStopSequenceNumber == reminder.StopSequence {
						var title, body string
						switch reminder.Type {
						case "arrival":
							title = "Your service is arriving soon!"
							body = "The vehicle is approaching your selected stop."
						case "get_off":
							title = "Your stop is next!"
							body = "Get ready to get off. Make sure to take everything with you."
						default:
							notificationDB.DeleteReminder(reminder.ClientId, reminder.Type)
							continue // unknown type
						}

						data := map[string]string{
							"url": fmt.Sprintf("/vehicles?tripId=%s", reminder.TripId),
						}

						client, err := notificationDB.FindNotificationClientById(reminder.ClientId)
						if err != nil {
							continue
						}

						client.SendNotification(body, title, data, "high")
						notificationDB.DeleteReminder(reminder.ClientId, reminder.Type)
					}

				}
			}
		}
	})

	c.Start()

	notificationRoute.POST("/add", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		unParsedroutes := c.FormValue("routes")
		var routes []string

		if unParsedroutes != "" {
			if err := json.Unmarshal([]byte(unParsedroutes), &routes); err != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid routes array",
					Data:    nil,
				})
			}

			if validateRoutes(routes) != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid routes format",
					Data:    nil,
				})
			}
		}

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

		cachedStops := parentStopsCache()
		parentStop, found := cachedStops[stop.StopId]
		if !found {
			return c.String(http.StatusBadRequest, "invalid stop")
		}

		newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, gtfsData)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		if err := newClient.SubscribeToStop(parentStop.StopId, routes); err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "failed to subscribe to stop",
				Data:    nil,
			})
		}

		newClient.SendNotification("This is a test notification to confirm notifications are enabled", fmt.Sprintf("Notifications Enabled for %s", parentStop.StopName), nil, "normal")

		return c.JSON(200, Response{
			Code:    200,
			Message: "added",
			Data:    nil,
		})
	})

	notificationRoute.POST("/refresh", func(c echo.Context) error {
		old_endpoint := c.FormValue("old_endpoint")
		old_p256dh := c.FormValue("old_p256dh")
		old_auth := c.FormValue("old_auth")

		new_endpoint := c.FormValue("new_endpoint")
		new_p256dh := c.FormValue("new_p256dh")
		new_auth := c.FormValue("new_auth")

		oldClient, err := notificationDB.FindNotificationClient(old_endpoint, old_p256dh, old_auth, "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		if _, err := oldClient.RefreshSubscription(Notification{
			Endpoint: new_endpoint,
			P256dh:   new_p256dh,
			Auth:     new_auth,
		}); err != nil {
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

	notificationRoute.POST("/find-client", func(c echo.Context) error {
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
			cachedStops := parentStopsCache()
			parentStop, found := cachedStops[stop.StopId]
			if !found {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = parentStop.StopId
		}

		notification, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, stopId)
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

	notificationRoute.POST("/remove", func(c echo.Context) error {
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
			cachedStops := parentStopsCache()
			parentStop, found := cachedStops[stop.StopId]
			if !found {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = parentStop.StopId
		}

		foundClient, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no subscription found",
				Data:    nil,
			})
		}

		if err := foundClient.DeleteNotificationClient(stopId); err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "failed to delete subscription",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "subscription removed",
			Data:    nil,
		})
	})

	notificationRoute.POST("/edit", func(c echo.Context) error {
		stopIdOrName := c.FormValue("stopIdOrName")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		unParsedroutes := c.FormValue("routes")
		var routes []string

		if unParsedroutes != "" {
			if err := json.Unmarshal([]byte(unParsedroutes), &routes); err != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid routes array",
					Data:    nil,
				})
			}

			if validateRoutes(routes) != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid routes format",
					Data:    nil,
				})
			}
		}

		var stopId string = ""

		if stopIdOrName != "" {
			stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName)
			if err != nil {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			cachedStops := parentStopsCache()
			parentStop, found := cachedStops[stop.StopId]
			if !found {
				return c.String(http.StatusBadRequest, "invalid stop")
			}
			stopId = parentStop.StopId
		}

		foundClient, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, stopId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no subscription found",
				Data:    nil,
			})
		}

		if err := foundClient.DeleteNotificationClient(stopId); err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "failed to delete subscription",
				Data:    nil,
			})
		}

		if err := foundClient.SubscribeToStop(stopId, routes); err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "failed to update subscription",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "subscription updated",
			Data:    nil,
		})
	})

	notificationRoute.POST("/reminder", func(c echo.Context) error {
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		tripId := c.FormValue("tripId")
		stopIdOrName := c.FormValue("stopIdOrName")
		typeOfReminder := c.FormValue("type")

		if typeOfReminder != "get_off" && typeOfReminder != "arrival" {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid type of reminder",
				Data:    nil,
			})
		}

		client, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, "")
		if err != nil {
			newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, gtfsData)
			if err != nil {
				return c.JSON(http.StatusBadRequest, Response{
					Code:    http.StatusBadRequest,
					Message: "invalid subscription data",
					Data:    nil,
				})
			}
			client = newClient
		}

		stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		cachedStops := parentStopsCache()
		parentStop, found := cachedStops[stop.StopId]
		if !found {
			return c.String(http.StatusBadRequest, "invalid stop")
		}

		stopsForTrip, lowestSequence, err := gtfsData.GetStopsForTripID(tripId)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid trip id",
				Data:    nil,
			})
		}

		var sequenceNumber int = 0
		for _, tripStop := range stopsForTrip {
			if tripStop.ParentStation == parentStop.StopId {
				sequenceNumber = tripStop.Sequence
			} else if parentStop.StopId == tripStop.StopId {
				sequenceNumber = tripStop.Sequence
			}
		}

		if err := notificationDB.AddReminder(client.Id, tripId, sequenceNumber-lowestSequence, typeOfReminder); err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "",
				Data:    nil,
			})
		}

		return c.JSON(http.StatusOK, Response{
			Code:    http.StatusOK,
			Message: "reminder set",
			Data:    nil,
		})
	})
}

func getNextStopSequence(stopUpdates []*proto.TripUpdate_StopTimeUpdate, lowestSequence int, localTimeZone *time.Location) (int, *time.Time, string, string) {
	if len(stopUpdates) == 0 {
		return 0, nil, "Unknown", ""
	}

	now := time.Now().In(localTimeZone)

	update := stopUpdates[0] //Latest one
	arrivalTimestamp := update.GetArrival().GetTime()
	departureTimestamp := update.GetDeparture().GetTime()
	sequence := int(update.GetStopSequence())

	arrivalTimeLocal := time.Unix(arrivalTimestamp, 0).In(localTimeZone)
	departureTimeLocal := time.Unix(departureTimestamp, 0).In(localTimeZone)
	var nextStopSequenceNumber int = sequence

	var state = "Unknown"
	var simpleState = "Unknown"
	if arrivalTimestamp != 0 && departureTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching the stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival pending): " + arrivalTimeLocal.String()
			simpleState = "Arriving"
		} else if now.Before(departureTimeLocal) {
			// At the stop, not yet departed
			nextStopSequenceNumber = sequence
			state = "At stop (awaiting departure): " + departureTimeLocal.String()
			simpleState = "Arrived"
		} else {
			// Already departed → next stop is the next one
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop: " + departureTimeLocal.String()
			simpleState = "Departed"
		}
	} else if arrivalTimestamp != 0 {
		if now.Before(arrivalTimeLocal) {
			// Approaching stop
			nextStopSequenceNumber = sequence
			state = "Approaching stop (arrival only): " + arrivalTimeLocal.String()
			simpleState = "Arriving"
		} else {
			// Already arrived → next stop must be next
			nextStopSequenceNumber = sequence + 1
			state = "Arrived at stop (arrival only): " + arrivalTimeLocal.String()
			simpleState = "Arrived"
		}
	} else if departureTimestamp != 0 {
		if now.Before(departureTimeLocal) {
			// Still at stop → haven't left yet
			nextStopSequenceNumber = sequence
			state = "Waiting to depart (departure only): " + departureTimeLocal.String()
			simpleState = "Boarding"
		} else {
			// Already departed
			nextStopSequenceNumber = sequence + 1
			state = "Departed stop (departure only): " + departureTimeLocal.String()
			simpleState = "Departed"
		}
	}

	nextStopSequenceNumber = nextStopSequenceNumber - lowestSequence

	return nextStopSequenceNumber, &arrivalTimeLocal, state, simpleState
}
