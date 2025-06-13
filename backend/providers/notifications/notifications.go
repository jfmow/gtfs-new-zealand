package notifications

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"slices"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
	"github.com/jmoiron/sqlx"
)

func (v Database) NotifyTripUpdates(tripUpdates realtime.TripUpdatesMap, gtfsDB gtfs.Database, parentStopsCache caches.ParentStopsByChildCache) {
	var (
		cachedParentStops = parentStopsCache()
		now               = time.Now().In(v.timeZone)
		currentTime       = now.Format("15:04:05")
	)

	for updateUID, update := range tripUpdates {
		if update.GetTrip().GetScheduleRelationship().Number() == 3 {
			tripId := update.GetTrip().GetTripId()

			if stopsForTrip, _, err := gtfsDB.GetStopsForTripID(tripId); err == nil {
				for _, stop := range stopsForTrip {
					if parentStop, found := cachedParentStops[stop.StopId]; found {
						offset := 0
						limit := 500
						for {
							clients, err := v.GetNotificationClientsByStop(parentStop.StopId, updateUID, limit, offset)
							if err != nil || len(clients) == 0 {
								break
							}
							offset += limit

							// Prepare notification data
							data := map[string]string{
								"url": fmt.Sprintf("/?s=%s", stop.StopName+" "+parentStop.StopCode),
							}
							title := stop.StopName + " " + stop.StopCode

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

							if serviceTime.Before(now) {
								continue
							}

							formattedTime := parsedTime.Format("3:04pm")

							body := fmt.Sprintf("The %s to %s from %s has been canceled. (%s)",
								formattedTime, service.StopHeadsign, parentStop.StopName, service.TripData.RouteID)

							// Send notifications in batches
							v.SendNotificationsInBatches(clients, body, title, data, updateUID, "normal")
						}

					}
				}
			}
		}
	}
}

func (v Database) NotifyAlerts(alerts realtime.AlertMap, gtfsDB gtfs.Database, parentStopsCache func() map[string]gtfs.Stop) {
	cachedStops := parentStopsCache()
	// Process alerts
	for alertId, alert := range alerts {
		for _, period := range alert.GetActivePeriod() {
			startTime := time.Unix(int64(period.GetStart()), 0)
			// Only notify for alerts that start today or tomorrow (in local time)
			alertDay := startTime.In(v.timeZone).YearDay()
			nowDay := time.Now().In(v.timeZone).YearDay()
			if alertDay == nowDay || alertDay == nowDay+3 {
				stopsToInform := getStopsForAlert(alert, cachedStops, gtfsDB)
				for _, stop := range stopsToInform {
					offset := 0
					limit := 500
					for {
						clients, err := v.GetNotificationClientsByStop(stop.StopId, alertId, limit, offset)
						if err != nil || len(clients) == 0 {
							break
						}
						offset += limit

						// Prepare notification data
						data := map[string]string{
							"url": fmt.Sprintf("/alerts?s=%s", stop.StopName+" "+stop.StopCode),
						}
						title := stop.StopName + " " + stop.StopCode
						body := fmt.Sprintf("%s\n%s", alert.GetHeaderText().GetTranslation()[0].GetText(), alert.GetDescriptionText().GetTranslation()[0].GetText())

						// Send notifications in batches
						v.SendNotificationsInBatches(clients, body, title, data, alertId, "normal")
					}
				}
			}
		}
	}
}

/*
Create a new notification database
*/
func newDatabase(tz *time.Location, mailToEmail string) (Database, error) {

	os.Mkdir(filepath.Join(getWorkDir(), "_providers"), os.ModePerm)
	os.Mkdir(filepath.Join(getWorkDir(), "_providers", "at"), os.ModePerm)

	db, err := sqlx.Open("sqlite", filepath.Join(getWorkDir(), "_providers", "at", "notifications.db"))
	if err != nil {
		fmt.Println(err)
		panic("Failed to open the database")
	}

	// Enable WAL mode
	_, err = db.Exec("PRAGMA journal_mode = WAL;")
	if err != nil {
		panic("Failed to set WAL mode")
	}

	// Initialize the Database struct
	database := Database{db: db, timeZone: tz, mailToEmail: mailToEmail}
	database.createNotificationsTable()
	return database, nil
}

/*
Create the default tables for notifications
*/
func (v Database) createNotificationsTable() {
	query := `
		-- Table: notifications
		CREATE TABLE IF NOT EXISTS notifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Auto-incrementing primary key
			endpoint TEXT NOT NULL,                  -- Make endpoint NOT NULL if required
			p256dh TEXT NOT NULL DEFAULT '',
			auth TEXT NOT NULL DEFAULT '',
			recent_notifications TEXT DEFAULT '[]',
			created INTEGER NOT NULL DEFAULT '[]',
			expiry_warning_sent BOOLEAN NOT NULL DEFAULT 0,
			CONSTRAINT unique_notification UNIQUE (endpoint, p256dh, auth)  -- Composite unique constraint
		);

		CREATE TABLE IF NOT EXISTS stops (
			id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Auto-incrementing primary key
			clientId INTEGER NOT NULL,               -- Foreign key referencing notifications.id
			parent_stop TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (clientId) REFERENCES notifications(id) ON DELETE CASCADE
			CONSTRAINT unique_stops UNIQUE (parent_stop, clientId)  -- Composite unique constraint
		);

	`

	_, err := v.db.Exec(query)
	if err != nil {
		log.Panicf("%s", err.Error())
	}

}

/*
Create a new notification client, MUST be unique.

stops can be parents or child's
*/
func (v Database) CreateNotificationClient(endpoint, p256dh, auth string, parentStopId string, gtfsDB gtfs.Database) (Notification, error) {
	// Validate input parameters
	if len(endpoint) < 2 || !isValidURL(endpoint) {
		return Notification{}, errors.New("invalid endpoint url")
	}
	if len(p256dh) < 10 || !isBase64Url(p256dh) {
		return Notification{}, errors.New("invalid p256dh")
	}
	if len(auth) < 8 || !isBase64Url(auth) {
		return Notification{}, errors.New("invalid auth")
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
			return Notification{}, errors.New("failed to create new client")
		}

		// Get the ID of the newly created notification
		newRecordId, err := result.LastInsertId()
		if err != nil {
			return Notification{}, errors.New("failed to retrieve client ID")
		}
		notificationClient.Id = int(newRecordId)
	}

	// Insert each stop into the `stops` table
	stopQuery := `
		INSERT INTO stops (clientId, parent_stop)
		VALUES (?, ?);
	`

	if _, err := v.db.Exec(stopQuery, notificationClient.Id, parentStopId); err != nil {
		return Notification{}, errors.New("failed to create stop entry")
	}

	return notificationClient, nil
}

/*
Delete a notification client

stop can be parent or child or "" (to delete all)
*/
func (v Database) DeleteNotificationClient(endpoint, p256dh, auth, parentStopId string) error {
	// Validate input parameters
	if len(endpoint) < 2 || !isValidURL(endpoint) {
		return errors.New("invalid endpoint url")
	}
	if len(p256dh) < 10 || !isBase64Url(p256dh) {
		return errors.New("invalid p256dh")
	}
	if len(auth) < 8 || !isBase64Url(auth) {
		return errors.New("invalid auth")
	}

	if parentStopId == "" {
		query := `
				DELETE FROM notifications
				WHERE endpoint = ? AND p256dh = ? AND auth = ?
			`

		_, err := v.db.Exec(query, endpoint, p256dh, auth)
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

		_, err := v.db.Exec(query, endpoint, p256dh, auth, parentStopId)
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
func (v Database) GetNotificationClientsByStop(parentStopId string, hasSeenId string, limit int, offset int) ([]NotificationClient, error) {
	// Query to find notification clients by stop
	query := `
		SELECT 
			n.id AS notification_id,
			n.endpoint,
			n.p256dh,
			n.auth,
			n.recent_notifications,
			n.created,
			n.expiry_warning_sent
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

	// Prepare the query
	rows, err := v.db.Query(query, parentStopId, limit, offset)
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

		// Check if recent_notifications contains any tripAlertIds
		excludeClient := slices.Contains(notification.RecentNotifications, hasSeenId)

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
		}

		if time.Unix(int64(notification.Created), 0).Add(30 * 24 * time.Hour).Before(time.Now().In(v.timeZone)) {
			//The notification is > 30 days old
			//remove it
			v.DeleteNotificationClient(notification.Endpoint, notification.P256dh, notification.Auth, "")
			continue //skip
		}

		// If the client contains any of the tripAlertIds, skip adding it to the result
		if !excludeClient {
			clients = append(clients, client)
		}
	}

	// Check for errors after iteration
	if err = rows.Err(); err != nil {
		return nil, errors.New("error iterating over notification clients")
	}

	return clients, nil
}

/*
Get notification clients

# DO NOT USE A CHECK OF LESS THAN LIMIT TO SEE IF THERES NONE LEFT. SOME MAY BE REMOVED AFTER BECAUSE THEY ARE EXPIRED

USE A CHECK OF found clients == 0 TO CHECK IF THERE ARE NO MORE FOUND
*/
func (v Database) GetNotificationClients(limit int, offset int) ([]NotificationClient, error) {
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
		}

		if time.Unix(int64(notification.Created), 0).Add(30 * 24 * time.Hour).Before(time.Now().In(v.timeZone)) {
			//The notification is > 30 days old
			//remove it
			v.DeleteNotificationClient(notification.Endpoint, notification.P256dh, notification.Auth, "")
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
				err := v.SendNotification(client, body, title, data, urgency)
				if err != nil {
					log.Printf("Failed to send notification to %s: %v", client.Notification.Endpoint, err)
				} else {
					v.AppendToRecentNotifications(client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth, alertId)
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
func (v Database) SendNotification(client NotificationClient, body, title string, data map[string]string, urgency webpush.Urgency) error {
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
		Subscriber:      v.mailToEmail,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             30,
		Urgency:         urgency,
	}

	resp, err := webpush.SendNotification(payloadBytes, &client.Notification, clientOptions)
	if err != nil {
		if resp != nil && resp.StatusCode == 410 {
			v.DeleteNotificationClient(client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth, "")
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
func (v Database) AppendToRecentNotifications(endpoint, p256dh, auth string, newNotification string) error {
	// Validate input parameters
	if len(endpoint) < 2 || !isValidURL(endpoint) {
		return errors.New("invalid endpoint url")
	}
	if len(p256dh) < 10 || !isBase64Url(p256dh) {
		return errors.New("invalid p256dh")
	}
	if len(auth) < 8 || !isBase64Url(auth) {
		return errors.New("invalid auth")
	}

	// Query to fetch the current `recent_notifications` array
	var recentNotifications string
	query := `
		SELECT recent_notifications
		FROM notifications
		WHERE endpoint = ? AND p256dh = ? AND auth = ?
	`
	err := v.db.QueryRow(query, endpoint, p256dh, auth).Scan(&recentNotifications)
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
	_, err = v.db.Exec(updateQuery, updatedNotifications, endpoint, p256dh, auth)
	if err != nil {
		return errors.New("failed to update recent notifications")
	}

	return nil
}

/*
Send a notification to all the clients in the database
*/
func (v Database) SendNotificationToAllClients(body string, title string, url string) error {
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

stopId MUST be a PARENT stop
*/
func (v Database) FindNotificationClient(endpoint, p256dh, auth string, parentStopId string) (*NotificationClient, error) {
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
			n.created
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
	}

	return &client, nil
}

/*
Update a already existing subscription to a new one

Basically just retains the client (is the point of this)
*/
func (v Database) RefreshSubscription(oldClient Notification, newClient Notification) (*NotificationClient, error) {
	if oldClient.Endpoint == newClient.Endpoint && oldClient.Auth == newClient.Auth && oldClient.P256dh == newClient.P256dh {
		return nil, errors.New("can't update subscription to same thing")
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

	_, err := v.db.Exec(query, oldClient.Endpoint, oldClient.P256dh, oldClient.Auth, newClient.Endpoint, newClient.P256dh, newClient.Auth)
	if err != nil {
		return nil, errors.New("problem updating client")
	}

	newRecord, err := v.FindNotificationClient(newClient.Endpoint, newClient.P256dh, newClient.Auth, "")
	if err != nil {
		return nil, errors.New("problem retrieving new client")
	}

	return newRecord, nil
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

// Notification database
type Database struct {
	db          *sqlx.DB
	timeZone    *time.Location
	mailToEmail string
}

type Notification struct {
	Id                  int      `json:"id"`
	Endpoint            string   `json:"endpoint"`
	P256dh              string   `json:"p256dh"`
	Auth                string   `json:"auth"`
	RecentNotifications []string `json:"recent"`
	Created             int      `json:"created"`
	ExpiryWarningSent   int      `json:"expiry_warning_sent"`
}

type NotificationClient struct {
	Id                  int
	Notification        webpush.Subscription
	RecentNotifications []string
	Created             int
	ExpiryWarningSent   int
}

func getWorkDir() string {
	ex, err := os.Executable()
	if err != nil {
		panic(err)
	}

	dir := filepath.Dir(ex)

	if strings.Contains(dir, "go-build") {
		return "."
	}
	return filepath.Dir(ex)
}

func isValidURL(url string) bool {
	pattern := `^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$`
	re := regexp.MustCompile(pattern)
	return re.MatchString(url)
}

func isBase64Url(s string) bool {
	// Checks if a string is a valid base64url encoded string
	// base64url is similar to base64, but uses URL-safe characters: "-" and "_"
	// Instead of "+" and "/"
	// Base64url strings may end with 0, 1, or 2 `=` characters
	_, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil
}

func getStopsForAlert(alert *proto.Alert, parentStops map[string]gtfs.Stop, gtfsData gtfs.Database) []gtfs.Stop {
	stopsSet := make(map[string]struct{})
	var stopsToInform []gtfs.Stop

	// Extract unique stop IDs from InformedEntity
	for _, entity := range alert.InformedEntity {
		if stopId := entity.GetStopId(); stopId != "" {
			if parentStop, found := parentStops[stopId]; found {
				if _, exists := stopsSet[parentStop.StopId]; !exists {
					stopsSet[parentStop.StopId] = struct{}{}
					stopsToInform = append(stopsToInform, parentStop)
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
						stopsToInform = append(stopsToInform, parentStop)
					}
				}
			}
		}
	}

	return stopsToInform
}
