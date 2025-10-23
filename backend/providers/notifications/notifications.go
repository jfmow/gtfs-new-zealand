package notifications

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"slices"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

func (v *Database) NotifyTripUpdates(tripUpdates realtime.TripUpdatesMap, gtfsDB gtfs.Database, parentStopsCache caches.ParentStopsByChildCache, stopsForTripCache caches.StopsForTripCache) {
	var (
		cachedParentStops = parentStopsCache()
		now               = time.Now().In(v.timeZone)
		currentTime       = now.Format("15:04:05")
		cachedTripStops   = stopsForTripCache()
	)

	for updateUID, update := range tripUpdates {
		if update.GetTrip().GetScheduleRelationship().Number() == 3 {
			tripId := update.GetTrip().GetTripId()

			stopsForTrip, found := cachedTripStops[tripId]
			if !found {
				continue
			}

			routesForTrip, err := gtfsDB.GetRouteByTripID(tripId)
			if err != nil {
				continue
			}

			var routesArray []string
			for _, route := range routesForTrip {
				routesArray = append(routesArray, route.RouteId)
			}

			for _, stop := range stopsForTrip.Stops {
				if parentStop, found := cachedParentStops[stop.StopId]; found {
					offset := 0
					limit := 500
					for {
						clients, err := v.GetNotificationClientsByStopAndRoute(parentStop.StopId, routesArray, updateUID, limit, offset)
						if err != nil || len(clients) == 0 {
							break
						}
						offset += limit

						// Prepare notification data
						data := map[string]string{
							"url": fmt.Sprintf("/?s=%s", parentStop.StopName+" "+parentStop.StopCode),
						}
						title := parentStop.StopName + " " + parentStop.StopCode

						service, err := gtfsDB.GetServiceByTripAndStop(tripId, stop.StopId, currentTime)
						if err != nil {
							continue
						}
						parsedTime, err := time.Parse("15:04:05", service.ArrivalTime)
						if err != nil {
							continue
						}

						serviceTime := time.Date(now.Year(), now.Month(), now.Day(),
							parsedTime.Hour(), parsedTime.Minute(), parsedTime.Second(), 0, v.timeZone)

						//its would have already passed this stop
						if serviceTime.Before(now) {
							continue
						}

						formattedTime := parsedTime.Format("3:04pm")

						body := fmt.Sprintf("The %s to %s from %s has been canceled. (%s)",
							formattedTime, service.StopHeadsign, parentStop.StopName, service.TripData.RouteID)

						v.SendNotificationsInBatches(clients, body, title, data, updateUID, "normal")
					}

				}
			}
		}
	}
}

func (v *Database) NotifyAlerts(alerts realtime.AlertMap, gtfsDB gtfs.Database, parentStopsCache func() map[string]gtfs.Stop) {
	cachedStops := parentStopsCache()
	// Process alerts
	for alertId, alert := range alerts {
		for _, period := range alert.GetActivePeriod() {
			startTime := time.Unix(int64(period.GetStart()), 0)
			// Only notify for alerts that start today or tomorrow (in local time)
			alertDay := startTime.In(v.timeZone).YearDay()
			nowDay := time.Now().In(v.timeZone).YearDay()
			if alertDay == nowDay || alertDay <= nowDay+3 {
				stopsToInform := getStopsForAlert(alert, cachedStops, gtfsDB)
				for _, ae := range stopsToInform {
					offset := 0
					limit := 500
					for {
						clients, err := v.GetNotificationClientsByStop(ae.Stop.StopId, alertId, limit, offset)
						if err != nil || len(clients) == 0 {
							break
						}
						offset += limit

						var enabledClients []NotificationClient
						for _, c := range clients {
							if len(c.Routes) == 0 || slices.Contains(c.Routes, ae.RouteId) {
								enabledClients = append(enabledClients, c)
							}
						}

						// Skip if no enabled clients
						if len(enabledClients) == 0 {
							continue
						}

						// Prepare notification data
						data := map[string]string{
							"url": fmt.Sprintf("/alerts?s=%s", ae.Stop.StopName+" "+ae.Stop.StopCode),
						}
						title := ae.Stop.StopName + " " + ae.Stop.StopCode
						body := fmt.Sprintf("%s\n%s",
							alert.GetHeaderText().GetTranslation()[0].GetText(),
							alert.GetDescriptionText().GetTranslation()[0].GetText(),
						)

						// Send notifications in batches only to enabled clients
						v.SendNotificationsInBatches(enabledClients, body, title, data, alertId, "normal")
					}

				}
			}
		}
	}
}

/*
Create a new notification client, MUST be unique.

stops can be parents or child's

parentStopId can be blank to just create a client
*/
func (v *Database) CreateNotificationClient(endpoint, p256dh, auth string, gtfsDB gtfs.Database) (*NotificationClient, error) {
	// Validate input parameters
	if len(endpoint) < 2 || !isValidURL(endpoint) {
		return nil, errors.New("invalid endpoint url")
	}
	if len(p256dh) < 10 || !isBase64Url(p256dh) {
		return nil, errors.New("invalid p256dh")
	}
	if len(auth) < 8 || !isBase64Url(auth) {
		return nil, errors.New("invalid auth")
	}

	// Insert the new notification client into the `notifications` table
	query := `
		INSERT INTO notifications (endpoint, p256dh, auth, created)
		VALUES (?, ?, ?, ?);
	`

	notificationClient := Notification{
		Endpoint: endpoint,
		P256dh:   p256dh,
		Auth:     auth,
		Created:  int(time.Now().In(v.timeZone).Unix()),
	}

	existingClient, err := v.FindNotificationClient(notificationClient.Endpoint, notificationClient.P256dh, notificationClient.Auth, "")
	if err == nil {
		notificationClient.Id = existingClient.Id
	} else {
		// Execute the query and get the last inserted ID
		result, err := v.db.Exec(query, notificationClient.Endpoint, notificationClient.P256dh, notificationClient.Auth, notificationClient.Created)
		if err != nil {
			fmt.Println(err)
			return nil, errors.New("failed to create new client")
		}

		// Get the ID of the newly created notification
		newRecordId, err := result.LastInsertId()
		if err != nil {
			return nil, errors.New("failed to retrieve client ID")
		}
		notificationClient.Id = int(newRecordId)
	}

	return &NotificationClient{
		Id: notificationClient.Id,
		Notification: webpush.Subscription{
			Endpoint: notificationClient.Endpoint,
			Keys: webpush.Keys{
				P256dh: notificationClient.P256dh,
				Auth:   notificationClient.Auth,
			},
		},
		Created: notificationClient.Created,
		db:      v,
	}, nil
}

/*
Subscribe a client to stops

Routes must contain all routes they want, it will fully replace what is currently set.

If not routes are set, the client will be notified for every route.
*/
func (client NotificationClient) SubscribeToStop(parentStopId string, routes []string) error {
	if parentStopId == "" {
		return errors.New("missing parent stop id")
	}
	// Insert each stop into the `stops` table
	stopQuery := `
		INSERT INTO stops (clientId, parent_stop, routes)
		VALUES (?, ?, ?);
	`

	var marshledRoutes []byte = nil
	if len(routes) > 0 {
		mr, err := json.Marshal(routes)
		if err != nil {
			return errors.New("failed to marshal updated notifications")
		}
		marshledRoutes = mr
	}

	if _, err := client.db.db.Exec(stopQuery, client.Id, parentStopId, marshledRoutes); err != nil {
		return err
	}

	return nil
}

/*
Delete a notification client

stop can be parent or child or "" (to delete all)
*/
func (client NotificationClient) DeleteNotificationClient(parentStopId string) error {
	if parentStopId == "" {
		query := `
				DELETE FROM notifications
				WHERE endpoint = ? AND p256dh = ? AND auth = ?
			`

		_, err := client.db.db.Exec(query, client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth)
		if err != nil {
			return errors.New("failed to delete client")
		}
	} else {
		// If a stop is provided, check if it exists for the given client
		query := `
				DELETE FROM stops
				WHERE clientId IN (
					SELECT n.id
					FROM notifications n
					WHERE n.endpoint = ? AND n.p256dh = ? AND n.auth = ? 
				) AND parent_stop = ?
			`

		_, err := client.db.db.Exec(query, client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth, parentStopId)
		if err != nil {
			return errors.New("failed to delete stop entry")
		}
	}

	return nil
}

/*
Get notification clients for a given stopId

stopId must be the id of a child stop

hasSeenId is a unique id given to check if that notification has already been served

# DO NOT USE A CHECK OF LESS THAN LIMIT TO SEE IF THERES NONE LEFT. SOME MAY BE REMOVED AFTER BECAUSE THEY ARE EXPIRED

USE A CHECK OF found clients == 0 TO CHECK IF THERE ARE NO MORE FOUND
*/
func (v *Database) GetNotificationClientsByStop(parentStopId string, hasSeenId string, limit int, offset int) ([]NotificationClient, error) {
	query := `
		SELECT 
			n.id AS notification_id,
			n.endpoint,
			n.p256dh,
			n.auth,
			n.recent_notifications,
			n.created,
			n.expiry_warning_sent,
			s.routes
		FROM 
			notifications n
		JOIN 
			stops s
		ON 
			n.id = s.clientId  -- Adjust this to the actual column for the join
		WHERE 
			s.parent_stop = ?
		LIMIT ?
		OFFSET ?
	`

	rows, err := v.db.Query(query, parentStopId, limit, offset)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("no clients found")
		}
		return nil, fmt.Errorf("failed to query notification clients: %w", err)
	}
	defer rows.Close()

	var clients []NotificationClient

	for rows.Next() {
		var notification Notification
		var recent string
		var routesStr sql.NullString // to handle possible NULL routes value

		err := rows.Scan(
			&notification.Id,
			&notification.Endpoint,
			&notification.P256dh,
			&notification.Auth,
			&recent,
			&notification.Created,
			&notification.ExpiryWarningSent,
			&routesStr, // <- routes column
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan notification client: %w", err)
		}

		// Parse recent notifications
		if recent != "[]" && recent != "" {
			if err := json.Unmarshal([]byte(recent), &notification.RecentNotifications); err != nil {
				return nil, fmt.Errorf("failed to parse recent notifications: %w", err)
			}
		}

		// Parse routes
		var routes []string
		if routesStr.Valid && routesStr.String != "" && routesStr.String != "[]" {
			if err := json.Unmarshal([]byte(routesStr.String), &routes); err != nil {
				return nil, fmt.Errorf("failed to parse routes JSON: %w", err)
			}
		}

		// Skip old or seen clients
		excludeClient := slices.Contains(notification.RecentNotifications, hasSeenId)
		if time.Unix(int64(notification.Created), 0).Add(30 * 24 * time.Hour).Before(time.Now().In(v.timeZone)) {
			client := NotificationClient{Id: notification.Id, db: v}
			client.DeleteNotificationClient("")
			continue
		}
		if excludeClient {
			continue
		}

		client := NotificationClient{
			Id: notification.Id,
			Notification: webpush.Subscription{
				Endpoint: notification.Endpoint,
				Keys: webpush.Keys{
					Auth:   notification.Auth,
					P256dh: notification.P256dh,
				},
			},
			RecentNotifications: notification.RecentNotifications,
			Created:             notification.Created,
			ExpiryWarningSent:   notification.ExpiryWarningSent,
			Routes:              routes, // ✅ append routes here
			db:                  v,
		}

		clients = append(clients, client)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating over notification clients: %w", err)
	}

	return clients, nil
}

/*
Get notification clients for a given stopId and routeIds

stopId must be the id of a parent stop
routeIds must be an array of route IDs

hasSeenId is a unique id given to check if that notification has already been served
*/
func (v *Database) GetNotificationClientsByStopAndRoute(parentStopId string, routeIds []string, updateUID string, limit int, offset int) ([]NotificationClient, error) {
	if len(routeIds) == 0 {
		return nil, errors.New("must provide at least 1 route id")
	}
	// Build the query for checking any route ID matches
	routeChecks := make([]string, len(routeIds))
	args := make([]interface{}, 0, len(routeIds)+3) // +3 for parentStopId, limit, offset
	args = append(args, parentStopId)

	for i, routeId := range routeIds {
		routeChecks[i] = "EXISTS(SELECT 1 FROM json_each(s.routes) WHERE value = ?)"
		args = append(args, routeId)
	}

	query := `
		SELECT 
			n.id AS notification_id,
			n.endpoint,
			n.p256dh,
			n.auth,
			n.recent_notifications,
			n.created,
			n.expiry_warning_sent,
			s.routes
		FROM 
			notifications n
		JOIN 
			stops s
		ON 
			n.id = s.clientId
		WHERE 
			s.parent_stop = ?
			AND (
				s.routes IS NULL
				OR s.routes = '[]'
				OR ` + strings.Join(routeChecks, " OR ") + `
			)
		LIMIT ?
		OFFSET ?
	`

	args = append(args, limit, offset)

	rows, err := v.db.Query(query, args...)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("no clients found")
		}
		return nil, fmt.Errorf("failed to query notification clients by stop+route: %w", err)
	}
	defer rows.Close()

	var clients []NotificationClient

	for rows.Next() {
		var notification Notification
		var recent string
		var routesStr sql.NullString

		if err := rows.Scan(
			&notification.Id,
			&notification.Endpoint,
			&notification.P256dh,
			&notification.Auth,
			&recent,
			&notification.Created,
			&notification.ExpiryWarningSent,
			&routesStr,
		); err != nil {
			return nil, fmt.Errorf("failed to scan notification client: %w", err)
		}

		// Parse recent notifications
		if recent != "" && recent != "[]" {
			if err := json.Unmarshal([]byte(recent), &notification.RecentNotifications); err != nil {
				return nil, fmt.Errorf("failed to parse recent notifications: %w", err)
			}
		}

		// Parse routes JSON
		var routes []string
		if routesStr.Valid && routesStr.String != "" && routesStr.String != "[]" {
			if err := json.Unmarshal([]byte(routesStr.String), &routes); err != nil {
				return nil, fmt.Errorf("failed to parse routes JSON: %w", err)
			}
		}

		// Skip old or seen clients
		excludeClient := len(notification.RecentNotifications) > 0 && slices.Contains(notification.RecentNotifications, routeIds[0])
		if time.Unix(int64(notification.Created), 0).Add(30 * 24 * time.Hour).Before(time.Now().In(v.timeZone)) {
			// stale - remove
			client := NotificationClient{Id: notification.Id, db: v}
			client.DeleteNotificationClient("")
			continue
		}
		if excludeClient {
			continue
		}

		client := NotificationClient{
			Id:                  notification.Id,
			Notification:        webpush.Subscription{Endpoint: notification.Endpoint, Keys: webpush.Keys{Auth: notification.Auth, P256dh: notification.P256dh}},
			RecentNotifications: notification.RecentNotifications,
			Created:             notification.Created,
			ExpiryWarningSent:   notification.ExpiryWarningSent,
			Routes:              routes,
			db:                  v,
		}

		clients = append(clients, client)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating over notification clients: %w", err)
	}

	return clients, nil
}

/*
Get notification clients

# DO NOT USE A CHECK OF LESS THAN LIMIT TO SEE IF THERES NONE LEFT. SOME MAY BE REMOVED AFTER BECAUSE THEY ARE EXPIRED

USE A CHECK OF found clients == 0 TO CHECK IF THERE ARE NO MORE FOUND
*/
func (v *Database) GetNotificationClients(limit int, offset int) ([]NotificationClient, error) {
	if limit > 1000 {
		fmt.Println("Don't you think that this limit is a bit high? (Func: GetNotificationClients)")
	}

	// Query to find notification clients by stop
	query := `
		SELECT 
			id,
			endpoint,
			p256dh,
			auth,
			recent_notifications,
			created,
			expiry_warning_sent
		FROM 
			notifications
		LIMIT ?
		OFFSET ?
	`

	// Prepare the query
	rows, err := v.db.Query(query, limit, offset)
	if err != nil {
		if err == sql.ErrNoRows {
			// If no client found, return an error
			return nil, errors.New("no clients found")
		}
		return nil, errors.New("failed to query notification clients")
	}
	defer rows.Close()

	// Slice to store results
	var clients []NotificationClient

	// Iterate over the rows
	for rows.Next() {
		var notification Notification
		var recent string
		err := rows.Scan(
			&notification.Id,
			&notification.Endpoint,
			&notification.P256dh,
			&notification.Auth,
			&recent,
			&notification.Created,
			&notification.ExpiryWarningSent,
		)
		if err != nil {
			return nil, errors.New("failed to scan notification client")
		}

		if recent != "[]" {
			err = json.Unmarshal([]byte(recent), &notification.RecentNotifications)
			if err != nil {
				return nil, errors.New("failed to parse recent notifications")
			}
		}

		client := NotificationClient{
			Id: notification.Id,
			Notification: webpush.Subscription{
				Endpoint: notification.Endpoint,
				Keys: webpush.Keys{
					Auth:   notification.Auth,
					P256dh: notification.P256dh,
				},
			},
			RecentNotifications: notification.RecentNotifications,
			Created:             notification.Created,
			ExpiryWarningSent:   notification.ExpiryWarningSent,
			db:                  v,
		}

		if time.Unix(int64(notification.Created), 0).Add(30 * 24 * time.Hour).Before(time.Now().In(v.timeZone)) {
			//The notification is > 30 days old
			//remove it
			client.DeleteNotificationClient("")
			continue //skip
		}

		// If the client contains any of the tripAlertIds, skip adding it to the result
		clients = append(clients, client)
	}

	// Check for errors after iteration
	if err = rows.Err(); err != nil {
		return nil, errors.New("error iterating over notification clients")
	}

	return clients, nil
}

/*
Send notifications in batches
*/
func (v Database) SendNotificationsInBatches(clients []NotificationClient, body, title string, data map[string]string, alertId string, urgency webpush.Urgency) {
	const maxWorkers = 10 // Limit the number of concurrent workers
	jobs := make(chan NotificationClient, len(clients))
	var wg sync.WaitGroup

	// Start worker pool
	for i := 0; i < maxWorkers; i++ {
		wg.Add(1) // Track each worker
		go func() {
			defer wg.Done()
			for client := range jobs {
				err := client.SendNotification(body, title, data, urgency)
				if err != nil {
					log.Printf("Failed to send notification to %s: %v", client.Notification.Endpoint, err)
				} else {
					client.AppendToRecentNotifications(alertId)
				}
			}
		}()
	}

	// Add jobs to the queue
	for _, client := range clients {
		jobs <- client
	}
	close(jobs) // Close the channel after all jobs are added

	// Wait for all workers to finish
	wg.Wait()
}

/*
Send a notification
*/
func (client NotificationClient) SendNotification(body, title string, data map[string]string, urgency webpush.Urgency) error {
	publicKey, found := os.LookupEnv("WP_PUB")
	if !found {
		panic("missing public VAPID key (env:WP_PUB)")
	}
	privateKey, found := os.LookupEnv("WP_PRIV")
	if !found {
		panic("missing private VAPID key (env:WP_PRIV)")
	}

	payload := map[string]any{
		"title": title,
		"body":  body,
		"data":  data,
	}
	payloadBytes, _ := json.Marshal(payload)

	// Reuse HTTP/2 connection
	clientOptions := &webpush.Options{
		Subscriber:      client.db.mailToEmail,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             30,
		Urgency:         urgency,
	}

	resp, err := webpush.SendNotification(payloadBytes, &client.Notification, clientOptions)
	if err != nil {
		if resp != nil && resp.StatusCode == 410 {
			client.DeleteNotificationClient("")
		}
		return err
	}
	if resp != nil {
		defer resp.Body.Close()
	}
	return nil
}

/*
Update the trip_id's we've already seen
*/
func (client *NotificationClient) AppendToRecentNotifications(newNotification string) error {

	// Query to fetch the current `recent_notifications` array
	var recentNotifications string
	query := `
		SELECT recent_notifications
		FROM notifications
		WHERE endpoint = ? AND p256dh = ? AND auth = ?
	`
	err := client.db.db.QueryRow(query, client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth).Scan(&recentNotifications)
	if err != nil {
		if err == sql.ErrNoRows {
			// If no client found, return an error
			return errors.New("client not found")
		}
		return errors.New("failed to fetch recent notifications")
	}

	// If the `recent_notifications` is empty, initialize it to an empty array
	if recentNotifications == "" {
		recentNotifications = "[]"
	}

	// Parse the current `recent_notifications` array into a Go slice
	var notifications []string
	err = json.Unmarshal([]byte(recentNotifications), &notifications)
	if err != nil {
		return errors.New("failed to unmarshal recent notifications")
	}

	// Append the new notifications to the slice
	notifications = append(notifications, newNotification)

	// Convert the updated slice back to a JSON string
	updatedNotifications, err := json.Marshal(notifications)
	if err != nil {
		return errors.New("failed to marshal updated notifications")
	}

	// Update the `recent_notifications` field in the database
	updateQuery := `
		UPDATE notifications
		SET recent_notifications = ?
		WHERE endpoint = ? AND p256dh = ? AND auth = ?
	`
	_, err = client.db.db.Exec(updateQuery, updatedNotifications, client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth)
	if err != nil {
		return errors.New("failed to update recent notifications")
	}

	client.RecentNotifications = notifications

	return nil
}

/*
Send a notification to all the clients in the database
*/
func (v *Database) SendNotificationToAllClients(body string, title string, url string) error {
	var limit = 500
	var offset = 0

	for {
		clients, err := v.GetNotificationClients(limit, offset)
		if err != nil {
			return err
		}

		if len(clients) == 0 {
			break
		}

		offset += limit

		data := map[string]string{
			"url": url,
		}

		v.SendNotificationsInBatches(clients, body, title, data, "", "high")
	}
	return nil
}

/*
Find a notification client by its subscription

stopId MUST be a PARENT stop (can be "" for broad query)
*/
func (v *Database) FindNotificationClient(endpoint, p256dh, auth string, parentStopId string) (*NotificationClient, error) {
	// Query to find notification clients by stop
	var query string
	if parentStopId == "" {
		query = `
			SELECT 
				id,
				endpoint,
				p256dh,
				auth,
				recent_notifications,
				created
			FROM 
				notifications
			WHERE endpoint = ?
			AND p256dh = ?
			AND auth = ?
		`
	} else {
		query = `
		SELECT 
			n.id AS notification_id,
			n.endpoint,
			n.p256dh,
			n.auth,
			n.recent_notifications,
			n.created,
			s.routes
		FROM 
			notifications n
		JOIN 
			stops s
		ON 
			n.id = s.clientId  -- Adjust this to the actual column for the join
		WHERE n.endpoint = ?
		AND n.p256dh = ?
		AND n.auth = ?
		AND s.parent_stop = ?
	`
	}

	// Prepare the query
	rows := v.db.QueryRow(query, endpoint, p256dh, auth, parentStopId)

	// Iterate over the rows
	var notification Notification
	var recent string
	var routesStr sql.NullString

	if parentStopId == "" {
		err := rows.Scan(
			&notification.Id,
			&notification.Endpoint,
			&notification.P256dh,
			&notification.Auth,
			&recent,
			&notification.Created,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				// If no client found, return an error
				return nil, errors.New("no clients found")
			}
			return nil, errors.New("failed to query/scan notification client")
		}
	} else {
		err := rows.Scan(
			&notification.Id,
			&notification.Endpoint,
			&notification.P256dh,
			&notification.Auth,
			&recent,
			&notification.Created,
			&routesStr,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				// If no client found, return an error
				return nil, errors.New("no clients found")
			}
			return nil, errors.New("failed to query/scan notification client")
		}
	}

	if recent != "[]" {
		err := json.Unmarshal([]byte(recent), &notification.RecentNotifications)
		if err != nil {
			return nil, errors.New("failed to parse recent notifications")
		}
	}

	// Parse routes JSON
	var routes []string
	if routesStr.Valid && routesStr.String != "" && routesStr.String != "[]" {
		if err := json.Unmarshal([]byte(routesStr.String), &routes); err != nil {
			return nil, fmt.Errorf("failed to parse routes JSON: %w", err)
		}
	}

	client := NotificationClient{
		Id: notification.Id,
		Notification: webpush.Subscription{
			Endpoint: notification.Endpoint,
			Keys: webpush.Keys{
				Auth:   notification.Auth,
				P256dh: notification.P256dh,
			},
		},
		RecentNotifications: notification.RecentNotifications,
		Created:             notification.Created,
		db:                  v,
		Routes:              routes,
	}

	return &client, nil
}

/*
Find a client by their id (only found in the db)
*/
func (v *Database) FindNotificationClientById(id int) (*NotificationClient, error) {
	query := `
		SELECT 
			endpoint,
			p256dh,
			auth,
			recent_notifications,
			created,
			expiry_warning_sent
		FROM 
			notifications
		WHERE 
			id = ?
	`

	var notification Notification
	var recent string

	err := v.db.QueryRow(query, id).Scan(
		&notification.Endpoint,
		&notification.P256dh,
		&notification.Auth,
		&recent,
		&notification.Created,
		&notification.ExpiryWarningSent,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("client not found")
		}
		return nil, errors.New("failed to query notification client by ID")
	}

	if recent != "[]" {
		err = json.Unmarshal([]byte(recent), &notification.RecentNotifications)
		if err != nil {
			return nil, errors.New("failed to parse recent notifications")
		}
	}

	client := &NotificationClient{
		Id: id,
		Notification: webpush.Subscription{
			Endpoint: notification.Endpoint,
			Keys: webpush.Keys{
				Auth:   notification.Auth,
				P256dh: notification.P256dh,
			},
		},
		RecentNotifications: notification.RecentNotifications,
		Created:             notification.Created,
		ExpiryWarningSent:   notification.ExpiryWarningSent,
		db:                  v,
	}

	return client, nil
}

/*
Update a already existing subscription to a new one

Basically just retains the client (is the point of this)
*/
func (oldClient *NotificationClient) RefreshSubscription(newClient Notification) error {
	if oldClient.Notification.Endpoint == newClient.Endpoint && oldClient.Notification.Keys.Auth == newClient.Auth && oldClient.Notification.Keys.P256dh == newClient.P256dh {
		return errors.New("can't update subscription to same thing")
	}

	query := `
		UPDATE notifications
		SET
			endpoint = ?,
			p256dh = ?,
			auth = ?,
			expiry_warning_sent = 0
		WHERE
			endpoint = ?
			AND p256dh = ?
			AND auth = ?;
	`

	_, err := oldClient.db.db.Exec(query, oldClient.Notification.Endpoint, oldClient.Notification.Keys.P256dh, oldClient.Notification.Keys.Auth, newClient.Endpoint, newClient.P256dh, newClient.Auth)
	if err != nil {
		return errors.New("problem updating client")
	}

	newRecord, err := oldClient.db.FindNotificationClient(newClient.Endpoint, newClient.P256dh, newClient.Auth, "")
	if err != nil {
		return errors.New("problem retrieving new client")
	}

	oldClient = newRecord

	return nil
}

func (v Database) SetClientExpiryWarningSent(client NotificationClient) error {
	query := `
		UPDATE notifications
		SET
			expiry_warning_sent = 1
		WHERE
			endpoint = ?
			AND p256dh = ?
			AND auth = ?;
	`

	_, err := v.db.Exec(query, client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth)
	if err != nil {
		return errors.New("problem updating client")
	}
	return nil
}

type NotificationClient struct {
	Id                  int
	Notification        webpush.Subscription
	RecentNotifications []string
	Created             int
	ExpiryWarningSent   int
	db                  *Database
	Routes              []string // Routes this client is subscribed to
}

type AlertEntities struct {
	Stop    gtfs.Stop
	RouteId string
}

func getStopsForAlert(alert *proto.Alert, parentStops map[string]gtfs.Stop, gtfsData gtfs.Database) []AlertEntities {
	stopsSet := make(map[string]struct{})
	var stopsToInform []AlertEntities

	// Extract unique stop IDs from InformedEntity
	for _, entity := range alert.InformedEntity {
		if stopId := entity.GetStopId(); stopId != "" {
			if parentStop, found := parentStops[stopId]; found {
				if _, exists := stopsSet[parentStop.StopId]; !exists {
					stopsSet[parentStop.StopId] = struct{}{}

					routes, err := gtfsData.GetRoutesByStopId(stopId)
					if err != nil {
						continue
					}

					for _, route := range routes {
						stopsToInform = append(stopsToInform, AlertEntities{RouteId: route.RouteId, Stop: parentStop})
					}
				}
			}
		} else if routeId := entity.GetRouteId(); routeId != "" {
			stops, err := gtfsData.GetStopsByRouteId(routeId)
			if err != nil {
				continue
			}
			for _, stop := range stops {
				if parentStop, found := parentStops[stop.StopId]; found {
					if _, exists := stopsSet[parentStop.StopId]; !exists {
						stopsSet[parentStop.StopId] = struct{}{}
						stopsToInform = append(stopsToInform, AlertEntities{RouteId: routeId, Stop: parentStop})
					}
				}
			}
		}

	}

	return stopsToInform
}
