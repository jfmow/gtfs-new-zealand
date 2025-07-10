package notifications

import (
	"fmt"
	"net/http"
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

func SetupNotificationsRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime realtime.Realtime, localTimeZone *time.Location, parentStopsCache caches.ParentStopsByChildCache, stopsForTripCache caches.StopsForTripCache) {
	var tripUpdatesCronMutex sync.Mutex
	var alertsCronMutex sync.Mutex
	notificationRoute := primaryRoute.Group("/notifications")

	notificationDB, err := newDatabase(localTimeZone, "hi@suddsy.dev", "at")
	if err != nil {
		fmt.Println(err)
	}

	c := cron.New(cron.WithLocation(localTimeZone))

	//Check trip updates, for cancellations
	c.AddFunc("@every 00h01m00s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if tripUpdatesCronMutex.TryLock() {
				defer tripUpdatesCronMutex.Unlock()
				updates, err := realtime.GetTripUpdates()
				if err == nil {
					notificationDB.NotifyTripUpdates(updates, gtfsData, parentStopsCache)
				}
			}
		}
	})

	//Check realtime alerts
	c.AddFunc("@every 00h02m15s", func() {
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
						notificationDB.SendNotification(client, "It's about to be 30 days since you enabled notifications, please open the app to refresh your notifications to continue to receive alerts.", "Your notifications are going to expire!", map[string]string{"url": "/notifications"}, "high")
					}
				}
			}
		}
	})

	//check reminders
	c.AddFunc("@every 00h00m10s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() >= 4 && now.Hour() < 24 { // Runs only between 4:00 AM and 11:59 PM
			if tripUpdatesCronMutex.TryLock() {
				defer tripUpdatesCronMutex.Unlock()
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
							body = "The vehicle is approaching your selected stop. Please prepare."
						case "get_off":
							title = "Your stop is next!"
							body = "Get ready to get off. Make sure to take everything with you."
						default:
							continue // unknown type
						}

						data := map[string]string{
							"url": fmt.Sprintf("/vehicles?tripId=%s", reminder.TripId),
						}

						client, err := notificationDB.FindNotificationClientById(reminder.ClientId)
						if err != nil {
							continue
						}

						notificationDB.SendNotification(*client, body, title, data, "high")
						notificationDB.DeleteReminder(reminder.ClientId, reminder.Type)
					}

				}
			}
		}
	})

	c.Start()

	notificationRoute.POST("/add", func(c echo.Context) error {
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

		cachedStops := parentStopsCache()
		parentStop, found := cachedStops[stop.StopId]
		if !found {
			return c.String(http.StatusBadRequest, "invalid stop")
		}

		newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, parentStop.StopId, gtfsData)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		notificationDB.SendNotification(*newClient, "This is a test notification to confirm notifications are enabled", fmt.Sprintf("Notifications Enabled for %s", parentStop.StopName), nil, "normal")

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
			newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, "", gtfsData)
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
