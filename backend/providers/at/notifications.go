package at

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
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime"
	"github.com/jmoiron/sqlx"
)

func (v Database) NotifyTripUpdates(tripUpdates realtime.TripUpdatesMap, gtfsDB gtfs.Database) error {
	if len(tripUpdates) == 0 {
		return errors.New("no trip updates provided")
	}

	now := time.Now().In(v.timeZone)
	currentTime := now.Format("15:04:05")

	var canceledTrips []string

	for _, trip := range tripUpdates {
		if trip.Trip.ScheduleRelationship == 3 {
			parsedTime, err := time.Parse("15:04:05", trip.Trip.StartTime)
			if err != nil {
				//fmt.Println("Error parsing time:", err)
				continue
			}
			if parsedTime.After(now) {
				canceledTrips = append(canceledTrips, trip.Trip.TripID)
			}
		}
	}

	for _, trip := range canceledTrips {
		foundStops, err := gtfsDB.GetStopsForTripID(trip)
		if err != nil {
			return errors.New("unable to find stops for trip")
		}
		for _, stop := range foundStops {
			clients, err := v.GetNotificationClientsByStop(stop.StopId, canceledTrips)
			if err != nil {
				// errors.New("no clients for stopId")
				continue
			}

			if len(clients) == 0 {
				continue
			}

			service, err := gtfsDB.GetServiceByTripAndStop(trip, stop.StopId, currentTime)
			if err != nil {
				//log.Println("no service found with trip id")
				continue
			}
			parsedTime, err := time.Parse("15:04:05", service.ArrivalTime)
			if err != nil {
				//fmt.Println("Error parsing time:", err)
				continue
			}

			// Format the time in 12-hour format with AM/PM
			formattedTime := parsedTime.Format("3:04pm")

			payload := map[string]string{
				"title": fmt.Sprintf("%s to %s canceled!", service.StopData.StopName, service.StopHeadsign),
				"body":  fmt.Sprintf("The %s to %s from %s has been canceled.\n\nClick for alternate services departing %s", formattedTime, service.StopHeadsign, service.StopData.StopName, service.StopData.StopName),
			}
			for _, client := range clients {
				v.AppendToRecentNotifications(client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth, trip)
				go v.SendNotification(client, payload["title"], payload["body"], stop.StopId)
			}
		}

	}
	return nil
}

/*
create a new notification database
*/
func newDatabase(tz *time.Location, mailToEmail string) (Database, error) {

	os.Mkdir(filepath.Join(GetWorkDir(), "_providers"), os.ModePerm)
	os.Mkdir(filepath.Join(GetWorkDir(), "_providers", "at"), os.ModePerm)

	db, err := sqlx.Open("sqlite", filepath.Join(GetWorkDir(), "_providers", "at", "notifications.db"))
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
			CONSTRAINT unique_notification UNIQUE (endpoint, p256dh, auth)  -- Composite unique constraint
		);

		CREATE TABLE IF NOT EXISTS stops (
			id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Auto-incrementing primary key
			clientId INTEGER NOT NULL,               -- Foreign key referencing notifications.id
			stop TEXT NOT NULL DEFAULT '',
			parent_stop TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (clientId) REFERENCES notifications(id) ON DELETE CASCADE
			CONSTRAINT unique_stops UNIQUE (stop, clientId)  -- Composite unique constraint
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
func (v Database) CreateNotificationClient(endpoint, p256dh, auth string, stopId string, gtfsDB gtfs.Database) error {
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

	foundStops, err := gtfsDB.GetChildStopsByParentStopID(stopId)
	if err != nil || len(foundStops) == 0 {
		return errors.New("invalid parent stop id")
	}

	var childStopsIds []string

	for _, stop := range foundStops {
		if stop.ParentStation == "" && stop.LocationType == 1 || (stop.ParentStation != "") {
			childStopsIds = append(childStopsIds, stop.StopId)
		}
	}

	if len(childStopsIds) == 0 {
		return errors.New("no stops found?")
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

	var clientID int

	existingClient, err := v.FindNotificationClientByParentStop(notificationClient.Endpoint, notificationClient.P256dh, notificationClient.Auth, "")
	if err == nil {
		clientID = existingClient.Id
	} else {
		// Execute the query and get the last inserted ID
		result, err := v.db.Exec(query, notificationClient.Endpoint, notificationClient.P256dh, notificationClient.Auth, notificationClient.Created)
		if err != nil {
			fmt.Println(err)
			return errors.New("failed to create new client")
		}

		// Get the ID of the newly created notification
		newRecordId, err := result.LastInsertId()
		if err != nil {
			return errors.New("failed to retrieve client ID")
		}
		clientID = int(newRecordId)
	}

	// Insert each stop into the `stops` table
	stopQuery := `
		INSERT INTO stops (clientId, stop, parent_stop)
		VALUES (?, ?, ?);
	`

	for _, stop := range childStopsIds {
		_, err := v.db.Exec(stopQuery, clientID, stop, stopId)
		if err != nil {
			return errors.New("failed to create stop entry")
		}
	}

	return nil
}

/*
Delete a notification client

stop can be parent or child
*/
func (v Database) DeleteNotificationClient(endpoint, p256dh, auth, stopId string) error {
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

	if stopId == "" {
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
				) AND parent_stop = ? OR stop = ?
			`

		_, err := v.db.Exec(query, endpoint, p256dh, auth, stopId, stopId)
		if err != nil {
			return errors.New("failed to delete stop entry")
		}
	}

	return nil
}

/*
Get the notification clients for a given stopId (!!child!! stopId)
*/
func (v Database) GetNotificationClientsByStop(stopId string, tripAlertIds []string) ([]NotificationClient, error) {
	// Query to find notification clients by stop
	query := `
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
		WHERE 
			s.stop = ?

	`

	// Prepare the query
	rows, err := v.db.Query(query, stopId)
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
		excludeClient := false
		for _, notification := range notification.RecentNotifications {
			for _, tripAlertId := range tripAlertIds {
				if notification == tripAlertId {
					excludeClient = true
					break
				}
			}
			if excludeClient {
				break
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
Send a notification
*/
func (v Database) SendNotification(client NotificationClient, body, title string, stopId string) error {
	publicKey, found := os.LookupEnv("WP_PUB")
	if !found {
		panic("missing public VAPID key (env:WP_PUB)")
	}
	privateKey, found := os.LookupEnv("WP_PRIV")
	if !found {
		panic("missing private VAPID key (env:WP_PRIV)")
	}
	if stopId == "" {
		return errors.New("missing stopId")
	}

	payload := map[string]string{
		"title": title,
		"body":  body,
	}
	payloadBytes, _ := json.Marshal(payload)

	// Send Notification
	resp, err := webpush.SendNotification(payloadBytes, &client.Notification, &webpush.Options{
		Subscriber:      v.mailToEmail,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             30,
	})
	if err != nil || (resp != nil && resp.StatusCode == 410) {
		v.DeleteNotificationClient(client.Notification.Endpoint, client.Notification.Keys.P256dh, client.Notification.Keys.Auth, stopId)
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
Find a notification client by its subscription

stopId MUST be a PARENT stop
*/
func (v Database) FindNotificationClientByParentStop(endpoint, p256dh, auth string, stopId string) (*NotificationClient, error) {
	// Query to find notification clients by stop
	var query string
	if stopId == "" {
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
	rows := v.db.QueryRow(query, endpoint, p256dh, auth, stopId)

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
	}

	return &client, nil
}

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
}

type NotificationClient struct {
	Id                  int
	Notification        webpush.Subscription
	RecentNotifications []string
}

func GetWorkDir() string {
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

func contains(slice []string, item string) bool {
	for _, v := range slice {
		if v == item {
			return true
		}
	}
	return false
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
