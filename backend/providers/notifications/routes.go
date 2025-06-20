package notifications

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
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

		notificationDB.SendNotification(NotificationClient{
			Id: newClient.Id,
			Notification: webpush.Subscription{
				Endpoint: newClient.Endpoint,
				Keys: webpush.Keys{
					Auth:   newClient.Auth,
					P256dh: newClient.P256dh,
				},
			},
			RecentNotifications: newClient.RecentNotifications,
			Created:             newClient.Created,
			ExpiryWarningSent:   newClient.ExpiryWarningSent,
		}, "This is a test notification to confirm notifications are enabled", fmt.Sprintf("Notifications Enabled for %s", parentStop.StopName), nil, "normal")

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
}
