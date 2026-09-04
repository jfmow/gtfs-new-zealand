package notifications

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
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

func SetupNotificationsRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database, realtime realtime.Realtime, localTimeZone *time.Location, parentStopsCache caches.ParentStopsByChildCache, stopsForTripCache caches.StopsForTripCache, gtfsName string) {
	var tripUpdatesCronMutex sync.Mutex
	var remindersCronMutex sync.Mutex
	var alertsCronMutex sync.Mutex
	var journeyRemindersCronMutex sync.Mutex
	notificationRoute := primaryRoute.Group("/notifications")

	// Region tag for journey_reminders rows - every region process shares one
	// notifications.db, so the journey-reminders cron must only act on its own.
	region := gtfsName
	osrmURL := os.Getenv("OSRM_URL")

	notificationDB, err := sharedDatabase(localTimeZone, "hi@suddsy.dev", "at")
	if err != nil {
		fmt.Println(err)
	}

	// notifications.db is shared across regions; the client-expiry scan and the
	// one-shot reminders check both operate on the whole (unscoped) table, so
	// only one region needs to run them.
	primaryRegion := region == "at"

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

	//Check notification expiry - shared table, one region only. Also prunes
	//stale one-shot reminders, and runs a daily VACUUM.
	var lastNotifDBMaintenance time.Time
	if primaryRegion {
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

			// One-shot reminders for trips that never appeared in the feed.
			notificationDB.PruneStaleReminders(now.Add(-36 * time.Hour).Unix())

			// Once daily at ~2am - before the 3am journey-reminders cron and the
			// 4am alerts/trip-updates crons wake - reclaim free pages + checkpoint.
			if now.Hour() == 2 && time.Since(lastNotifDBMaintenance) > 12*time.Hour {
				notificationDB.Maintain()
				lastNotifDBMaintenance = now
			}
		})
	}

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

						if client.SendNotification(body, title, data, "high") == nil {
							client.AppendToRecentNotifications(
								fmt.Sprintf("reminder-%d-%s-%s", reminder.ClientId, reminder.TripId, reminder.Type),
								title, body, data["url"],
							)
						}
						notificationDB.DeleteReminder(reminder.ClientId, reminder.Type)
					}

				}
			}
		}
	})

	// Planned journey "leave-by" reminders - resolve boarding trips, watch
	// their realtime delay, push "leave in 30/15/5 min" then "leave now",
	// re-notify on a shift, roll recurring rows to their next occurrence.
	c.AddFunc("@every 00h00m30s", func() {
		now := time.Now().In(localTimeZone)
		if now.Hour() < 3 { // "leave in 30" can precede the 4am service window
			return
		}
		if !journeyRemindersCronMutex.TryLock() {
			return
		}
		defer journeyRemindersCronMutex.Unlock()
		runJourneyRemindersCron(notificationDB, gtfsData, realtime, localTimeZone, region, osrmURL, now)
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

	// ─────────────── planned journey "leave-by" reminders ───────────────

	// Create or update (upsert on the template identity) a leave-by reminder.
	notificationRoute.POST("/journey-reminder", func(c echo.Context) error {
		endpoint := c.FormValue("endpoint")
		p256dh := c.FormValue("p256dh")
		auth := c.FormValue("auth")

		client, err := notificationDB.FindNotificationClient(endpoint, p256dh, auth, "")
		if err != nil {
			newClient, cErr := notificationDB.CreateNotificationClient(endpoint, p256dh, auth, gtfsData)
			if cErr != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid subscription data"})
			}
			client = newClient
		}

		if count, cErr := notificationDB.CountActiveJourneyReminders(client.Id); cErr == nil && count >= jrMaxActivePerClient {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "you already have the maximum number of journey reminders"})
		}

		startLat, e1 := strconv.ParseFloat(c.FormValue("startLat"), 64)
		startLon, e2 := strconv.ParseFloat(c.FormValue("startLon"), 64)
		endLat, e3 := strconv.ParseFloat(c.FormValue("endLat"), 64)
		endLon, e4 := strconv.ParseFloat(c.FormValue("endLon"), 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid start/end coordinates"})
		}

		timeType := c.FormValue("timeType")
		if timeType != "departat" {
			timeType = "arriveat"
		}

		recurrence := strings.TrimSpace(c.FormValue("recurrence"))
		if recurrence != "" {
			if !regexp.MustCompile(`^[01]{7}$`).MatchString(recurrence) || !strings.Contains(recurrence, "1") {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid recurrence mask"})
			}
		}

		kind := c.FormValue("kind")
		if recurrence != "" || kind != "fixed_trip" {
			kind = "journey_request"
		}

		// offsets
		offsets := []int{30, 15, 5, 0}
		if raw := c.FormValue("offsets"); raw != "" {
			var parsed []int
			if json.Unmarshal([]byte(raw), &parsed) != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid offsets"})
			}
			seen := map[int]bool{}
			offsets = offsets[:0]
			for _, o := range parsed {
				if o < 0 || o > 180 || seen[o] {
					continue
				}
				seen[o] = true
				offsets = append(offsets, o)
			}
			if len(offsets) == 0 {
				offsets = []int{0}
			}
			if len(offsets) > 6 {
				offsets = offsets[:6]
			}
		}
		offsets = sortedDescInts(offsets)

		now := time.Now().In(localTimeZone)

		// target time-of-day
		targetHHMM := c.FormValue("targetHHMM")
		if targetHHMM == "" {
			if u, uErr := strconv.ParseInt(c.FormValue("targetUnix"), 10, 64); uErr == nil {
				targetHHMM = time.Unix(u, 0).In(localTimeZone).Format("15:04")
			}
		}
		if _, tErr := time.Parse("15:04", targetHHMM); tErr != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid target time"})
		}

		// first occurrence
		var serviceDate string
		var targetUnix int64
		if recurrence == "" {
			if u, uErr := strconv.ParseInt(c.FormValue("targetUnix"), 10, 64); uErr == nil {
				serviceDate = time.Unix(u, 0).In(localTimeZone).Format("20060102")
				targetUnix = u
			} else if sd := c.FormValue("serviceDate"); sd != "" {
				tu, hErr := hhmmToUnix(sd, targetHHMM, localTimeZone)
				if hErr != nil {
					return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid service date"})
				}
				serviceDate, targetUnix = sd, tu
			}
		}
		if serviceDate == "" {
			sd, tu, oErr := firstJourneyReminderOccurrence(recurrence, targetHHMM, now, localTimeZone)
			if oErr != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: oErr.Error()})
			}
			serviceDate, targetUnix = sd, tu
		}

		recurrenceUntil := strings.TrimSpace(c.FormValue("recurrenceUntil"))
		if recurrence != "" {
			if recurrenceUntil == "" {
				recurrenceUntil = now.AddDate(0, 0, jrRecurrenceMaxDays).Format("20060102")
			} else if _, rErr := time.ParseInLocation("20060102", recurrenceUntil, localTimeZone); rErr != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid recurrence end date"})
			}
		} else {
			recurrenceUntil = ""
		}

		deeplink := c.FormValue("deeplink")
		if !strings.HasPrefix(deeplink, "/") {
			deeplink = "/plan"
		}

		maxWalkKm, _ := strconv.ParseFloat(c.FormValue("maxWalkKm"), 64)
		if maxWalkKm <= 0 {
			maxWalkKm = 1.0
		}
		walkSpeed, _ := strconv.ParseFloat(c.FormValue("walkSpeed"), 64)
		if walkSpeed <= 0 {
			walkSpeed = 4.8
		}
		maxTransfers, mtErr := strconv.Atoi(c.FormValue("maxTransfers"))
		if mtErr != nil || maxTransfers < 0 {
			maxTransfers = 5
		}

		reminder := JourneyReminder{
			ClientId:          client.Id,
			Region:            region,
			Kind:              kind,
			Status:            "scheduled",
			StartLat:          startLat,
			StartLon:          startLon,
			StartLabel:        c.FormValue("startLabel"),
			EndLat:            endLat,
			EndLon:            endLon,
			EndLabel:          c.FormValue("endLabel"),
			TimeType:          timeType,
			TargetHHMM:        targetHHMM,
			MaxWalkKm:         maxWalkKm,
			WalkSpeed:         walkSpeed,
			MaxTransfers:      maxTransfers,
			Offsets:           offsets,
			Recurrence:        recurrence,
			RecurrenceUntil:   recurrenceUntil,
			Deeplink:          deeplink,
			ServiceDate:       serviceDate,
			TargetUnix:        targetUnix,
		}

		if kind == "fixed_trip" {
			boardTripId := c.FormValue("boardTripId")
			boardStopId := c.FormValue("boardStopId")
			if boardTripId == "" || boardStopId == "" {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "missing boarding trip or stop"})
			}

			stopsForTrip, _, sErr := gtfsData.GetStopsForTripID(boardTripId)
			if sErr != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid trip id"})
			}
			var childStopId string
			var rawSeq int
			for _, s := range stopsForTrip {
				if s.StopId == boardStopId || s.ParentStation == boardStopId {
					childStopId = s.StopId
					rawSeq = s.Sequence
					break
				}
			}
			if childStopId == "" {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "boarding stop is not on that trip"})
			}

			// The client already holds the plan it picked - it sends the
			// boarding leg's scheduled departure (RFC3339, on the right service
			// day). We validate the stop/trip above and take the time from here.
			schedT, tpErr := time.Parse(time.RFC3339, c.FormValue("scheduledDepartureIso"))
			if tpErr != nil {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid boarding time"})
			}
			schedT = schedT.In(localTimeZone)
			schedUnix := schedT.Unix()
			boardServiceDate := schedT.Format("20060102")

			// access = leading walk/wait from the rider's start to the boarding
			// stop; the leave anchor is schedUnix - access (the real walk-out
			// time). No prep padding - the offset ladder is the only lead.
			access := 0
			if v, aErr := strconv.Atoi(c.FormValue("accessSeconds")); aErr == nil && v >= 0 {
				access = v
			}
			if access > 14400 {
				access = 14400
			}

			leaveUnix := schedUnix - int64(access)
			if leaveUnix < now.Unix()-60 {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "this journey has already departed"})
			}
			if schedUnix > now.Add(8*24*time.Hour).Unix() {
				return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "that journey is too far ahead"})
			}

			reminder.Status = "armed"
			reminder.BoardTripID = nullString(boardTripId)
			reminder.BoardStopID = nullString(childStopId)
			reminder.BoardStopSequence = nullInt64(int64(rawSeq))
			reminder.ScheduledDepartureUnix = nullInt64(schedUnix)
			reminder.AccessSeconds = nullInt64(int64(access))
			reminder.BaselineLeaveUnix = nullInt64(leaveUnix)
			reminder.RouteShortName = c.FormValue("routeShortName")
			reminder.BoardStopName = c.FormValue("boardStopName")
			reminder.ServiceDate = boardServiceDate
			reminder.TargetUnix = schedUnix
		}

		reminder.DedupKey = journeyReminderDedupKey(
			client.Id, startLat, startLon, endLat, endLon, timeType, targetHHMM, recurrence, reminder.ServiceDate,
		)

		id, uErr := notificationDB.UpsertJourneyReminder(reminder)
		if uErr != nil {
			fmt.Println(uErr)
			return c.JSON(http.StatusInternalServerError, Response{Code: http.StatusInternalServerError, Message: "failed to save reminder"})
		}

		out := map[string]any{
			"id":           id,
			"status":       reminder.Status,
			"kind":         reminder.Kind,
			"service_date": reminder.ServiceDate,
		}
		if reminder.BaselineLeaveUnix.Valid {
			out["next_leave_unix"] = reminder.BaselineLeaveUnix.Int64
			out["next_leave_local"] = time.Unix(reminder.BaselineLeaveUnix.Int64, 0).In(localTimeZone).Format("15:04")
		}
		return c.JSON(http.StatusOK, Response{Code: http.StatusOK, Message: "journey reminder set", Data: out})
	})

	// List the current device's active leave-by reminders.
	notificationRoute.POST("/journey-reminders", func(c echo.Context) error {
		client, err := notificationDB.FindNotificationClient(c.FormValue("endpoint"), c.FormValue("p256dh"), c.FormValue("auth"), "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "no subscription found"})
		}
		rows, lErr := notificationDB.GetJourneyRemindersForClient(client.Id)
		if lErr != nil {
			return c.JSON(http.StatusInternalServerError, Response{Code: http.StatusInternalServerError, Message: "failed to load reminders"})
		}
		out := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			out = append(out, journeyReminderDTO(r, localTimeZone))
		}
		return c.JSON(http.StatusOK, Response{Code: http.StatusOK, Message: "ok", Data: out})
	})

	notificationRoute.POST("/journey-reminder/remove", func(c echo.Context) error {
		client, err := notificationDB.FindNotificationClient(c.FormValue("endpoint"), c.FormValue("p256dh"), c.FormValue("auth"), "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "no subscription found"})
		}
		id, idErr := strconv.Atoi(c.FormValue("id"))
		if idErr != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "invalid id"})
		}
		if dErr := notificationDB.DeleteJourneyReminderForClient(id, client.Id); dErr != nil {
			return c.JSON(http.StatusInternalServerError, Response{Code: http.StatusInternalServerError, Message: "failed to remove reminder"})
		}
		return c.JSON(http.StatusOK, Response{Code: http.StatusOK, Message: "journey reminder removed"})
	})

	// ─────────────── in-app notification history ───────────────

	// Soft-hide one history entry from the in-app list (the row stays so the
	// push de-dup keeps working).
	notificationRoute.POST("/history/dismiss", func(c echo.Context) error {
		client, err := notificationDB.FindNotificationClient(c.FormValue("endpoint"), c.FormValue("p256dh"), c.FormValue("auth"), "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "no subscription found"})
		}
		id := c.FormValue("id")
		if id == "" {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "missing id"})
		}
		if dErr := client.DismissRecentNotification(id); dErr != nil {
			return c.JSON(http.StatusInternalServerError, Response{Code: http.StatusInternalServerError, Message: "failed to dismiss"})
		}
		return c.JSON(http.StatusOK, Response{Code: http.StatusOK, Message: "dismissed"})
	})

	// Soft-hide every history entry for this device.
	notificationRoute.POST("/history/clear", func(c echo.Context) error {
		client, err := notificationDB.FindNotificationClient(c.FormValue("endpoint"), c.FormValue("p256dh"), c.FormValue("auth"), "")
		if err != nil {
			return c.JSON(http.StatusBadRequest, Response{Code: http.StatusBadRequest, Message: "no subscription found"})
		}
		if cErr := client.ClearRecentNotifications(); cErr != nil {
			return c.JSON(http.StatusInternalServerError, Response{Code: http.StatusInternalServerError, Message: "failed to clear"})
		}
		return c.JSON(http.StatusOK, Response{Code: http.StatusOK, Message: "cleared"})
	})
}

