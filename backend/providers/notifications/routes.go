package notifications

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/at-trains-api/providers/vehiclestate"
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

func validateCauses(causes []string) error {
	for _, cause := range causes {
		if _, ok := proto.Alert_Cause_value[cause]; !ok {
			return fmt.Errorf("invalid cause: %q", cause)
		}
	}
	return nil
}

// resolveParentStop accepts either a human search string (name/code, as typed
// into a stop search box) or an already-canonical parent stop id (as handed
// back by GetMySubscriptions, which only ever has the id, not a searchable
// name) - tried in that order. Every stop-scoped endpoint below goes through
// this so a manage-subscriptions UI working purely off ids doesn't need a
// separate lookup path from a human typing a stop name.
func resolveParentStop(gtfsData gtfs.Database, cachedStops map[string]gtfs.Stop, stopIdOrName string) (gtfs.Stop, bool) {
	if stop, err := gtfsData.GetStopByNameOrCode(stopIdOrName); err == nil {
		if parentStop, found := cachedStops[stop.StopId]; found {
			return parentStop, true
		}
	}
	if parentStop, found := cachedStops[stopIdOrName]; found {
		return parentStop, true
	}
	return gtfs.Stop{}, false
}

func validateSeverity(severity string) error {
	if severity == "" {
		return nil
	}
	if _, ok := proto.Alert_SeverityLevel_value[severity]; !ok {
		return fmt.Errorf("invalid severity: %q", severity)
	}
	return nil
}

// parseSubscriptionFilters reads the alert-type fields shared by the stop and
// route subscribe/edit endpoints. notifyCancellations defaults to true
// (unfiltered) when the field is omitted, so requests from an app version
// that predates this field keep behaving exactly as they do today.
func parseSubscriptionFilters(c echo.Context) (SubscriptionFilters, error) {
	var causes []string
	if raw := c.FormValue("causes"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &causes); err != nil {
			return SubscriptionFilters{}, fmt.Errorf("invalid causes array")
		}
		if err := validateCauses(causes); err != nil {
			return SubscriptionFilters{}, err
		}
	}

	minSeverity := c.FormValue("minSeverity")
	if err := validateSeverity(minSeverity); err != nil {
		return SubscriptionFilters{}, err
	}

	notifyCancellations := true
	if raw := c.FormValue("notifyCancellations"); raw != "" {
		notifyCancellations = raw != "false" && raw != "0"
	}

	return SubscriptionFilters{
		Causes:              causes,
		MinSeverity:         minSeverity,
		NotifyCancellations: notifyCancellations,
	}, nil
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
	c.AddFunc("@every 00h00m14s", func() {
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
				// Best-effort - a live position sharpens the state derivation
				// (matching the map/tracker's accuracy) but isn't required; the
				// timestamp heuristic in vehiclestate.GetNextStopSequence still
				// works without it.
				vehicles, _ := realtime.GetVehicles()
				reminders, err := notificationDB.GetAllReminders()
				if err != nil {
					return
				}
				// GetAllReminders has no ORDER BY - sort by stop position so that
				// when a poll gap crosses multiple thresholds at once, an earlier
				// stop's reminder is always sent before a later stop's, on the
				// same trip, instead of firing in incidental DB/iteration order.
				sort.Slice(reminders, func(i, j int) bool {
					return reminders[i].StopSequence < reminders[j].StopSequence
				})
				for _, reminder := range reminders {
					tripUpdate, err := updates.ByTripID(reminder.TripId)
					if err != nil {
						continue
					}
					stopsForTrip, lowestSequence, err := gtfsData.GetStopsForTripID(reminder.TripId)
					if err != nil {
						continue
					}
					var vehiclePos *proto.VehiclePosition
					var vehicleLat, vehicleLon float64
					if v, err := vehicles.ByTripID(reminder.TripId); err == nil {
						vehiclePos = v
						if pos := v.GetPosition(); pos != nil {
							vehicleLat, vehicleLon = float64(pos.GetLatitude()), float64(pos.GetLongitude())
						}
					}
					nextStopSequenceNumber, _, _ := vehiclestate.GetNextStopSequence(
						tripUpdate.StopTimeUpdate, lowestSequence, localTimeZone, stopsForTrip, vehicleLat, vehicleLon, vehiclePos,
					)

					// Use >= instead of == to avoid missing reminders when realtime updates
					// skip over a sequence between polling intervals.
					if nextStopSequenceNumber >= reminder.StopSequence {
						var title, body string
						switch reminder.Type {
						case "arrival":
							title = "Your stop is coming up!"
							if nextStopSequenceNumber == reminder.StopSequence {
								body = "The vehicle is approaching your selected stop."
							} else {
								body = "The vehicle is very close to (or has just passed) your selected stop."
							}
						case "get_off":
							title = "Your stop is now!"
							if nextStopSequenceNumber == reminder.StopSequence {
								body = "Get ready to get off. Make sure to take everything with you."
							} else {
								body = "Your selected stop is now (or has just passed)."
							}
						case "n_stops_away":
							title = "Your stop is coming up!"
							body = "The vehicle is getting close to your selected stop."
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

		filters, err := parseSubscriptionFilters(c)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: err.Error(),
				Data:    nil,
			})
		}

		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		parentStop, found := resolveParentStop(gtfsData, parentStopsCache(), stopIdOrName)
		if !found {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid stop id",
				Data:    nil,
			})
		}

		newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, gtfsData)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		if err := newClient.SubscribeToStop(parentStop.StopId, routes, filters); err != nil {
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

		if err := oldClient.RefreshSubscription(Notification{
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
			parentStop, found := resolveParentStop(gtfsData, parentStopsCache(), stopIdOrName)
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
			parentStop, found := resolveParentStop(gtfsData, parentStopsCache(), stopIdOrName)
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

		filters, err := parseSubscriptionFilters(c)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: err.Error(),
				Data:    nil,
			})
		}

		var stopId string = ""

		if stopIdOrName != "" {
			parentStop, found := resolveParentStop(gtfsData, parentStopsCache(), stopIdOrName)
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

		if err := foundClient.SubscribeToStop(stopId, routes, filters); err != nil {
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
		stopId := c.FormValue("stopId")
		typeOfReminder := c.FormValue("type")

		if typeOfReminder != "get_off" && typeOfReminder != "arrival" && typeOfReminder != "n_stops_away" {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid type of reminder",
				Data:    nil,
			})
		}

		// Only meaningful for n_stops_away: how many stops before the target stop to fire the reminder.
		// Missing/invalid/negative values fall back to 1 stop early.
		var stopsAwayOffset int
		if typeOfReminder == "n_stops_away" {
			stopsAwayOffset = 1
			if parsed, err := strconv.Atoi(c.FormValue("offset")); err == nil && parsed >= 0 {
				stopsAwayOffset = parsed
			}
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

		stop, err := gtfsData.GetStopByStopID(stopId)
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

		var (
			sequenceNumber int
			stopFound      bool
		)
		for _, tripStop := range stopsForTrip {
			if tripStop.ParentStation == parentStop.StopId {
				sequenceNumber = tripStop.Sequence
				stopFound = true
			} else if parentStop.StopId == tripStop.StopId {
				sequenceNumber = tripStop.Sequence
				stopFound = true
			}
		}
		if !stopFound {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "selected stop is not in trip",
				Data:    nil,
			})
		}

		targetStopSequence := sequenceNumber - lowestSequence - stopsAwayOffset
		if targetStopSequence < 0 {
			targetStopSequence = 0
		}

		if err := notificationDB.AddReminder(client.Id, tripId, targetStopSequence, typeOfReminder); err != nil {
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

	notificationRoute.POST("/route/add", func(c echo.Context) error {
		routeId := c.FormValue("routeId")
		if validateRoutes([]string{routeId}) != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid route id",
				Data:    nil,
			})
		}

		filters, err := parseSubscriptionFilters(c)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: err.Error(),
				Data:    nil,
			})
		}

		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		newClient, err := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, gtfsData)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid subscription data",
				Data:    nil,
			})
		}

		if err := newClient.SubscribeToRoute(routeId, filters); err != nil {
			fmt.Println(err)
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "failed to subscribe to route",
				Data:    nil,
			})
		}

		newClient.SendNotification("This is a test notification to confirm notifications are enabled", fmt.Sprintf("Notifications enabled for route %s", routeId), nil, "normal")

		return c.JSON(200, Response{
			Code:    200,
			Message: "added",
			Data:    nil,
		})
	})

	notificationRoute.POST("/route/edit", func(c echo.Context) error {
		routeId := c.FormValue("routeId")
		if validateRoutes([]string{routeId}) != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "invalid route id",
				Data:    nil,
			})
		}

		filters, err := parseSubscriptionFilters(c)
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: err.Error(),
				Data:    nil,
			})
		}

		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		foundClient, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no subscription found",
				Data:    nil,
			})
		}

		if err := foundClient.SubscribeToRoute(routeId, filters); err != nil {
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

	notificationRoute.POST("/route/remove", func(c echo.Context) error {
		routeId := c.FormValue("routeId")
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		foundClient, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no subscription found",
				Data:    nil,
			})
		}

		if err := foundClient.DeleteRouteSubscription(routeId); err != nil {
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

	// Every stop + route subscription for a client, plus their recent
	// notification history - powers the manage-subscriptions UI and the
	// in-app bell/badge, neither of which existed before this endpoint
	// (find-client only ever checked one stop at a time).
	notificationRoute.POST("/mine", func(c echo.Context) error {
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		foundClient, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{
				Code:    http.StatusBadRequest,
				Message: "no subscription found",
				Data:    nil,
			})
		}

		subscriptions, err := foundClient.GetMySubscriptions()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, Response{
				Code:    http.StatusInternalServerError,
				Message: "failed to load subscriptions",
				Data:    nil,
			})
		}

		return c.JSON(200, Response{
			Code:    200,
			Message: "ok",
			Data:    subscriptions,
		})
	})
}

