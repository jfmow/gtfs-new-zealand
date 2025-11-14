package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var ErrClientNotFound = errors.New("notification client not found")

const (
	defaultDBFileName   = "notifications.db"
	defaultQueryTimeout = 5 * time.Second
)

type Database struct {
	db          *sql.DB
	timeZone    *time.Location
	mailToEmail string
	mailToName  string
}

func newDatabase(timeZone *time.Location, mailToEmail, mailToName string) (*Database, error) {
	if timeZone == nil {
		return nil, errors.New("time zone is required")
	}

	dbPath := os.Getenv("NOTIFICATIONS_DATABASE")
	if dbPath == "" {
		dbPath = defaultDBFileName
	}

	if !filepath.IsAbs(dbPath) {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("get cwd: %w", err)
		}
		dbPath = filepath.Join(cwd, dbPath)
	}

	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("%s?_foreign_keys=on", dbPath))
	if err != nil {
		return nil, fmt.Errorf("open notifications database: %w", err)
	}

	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("ping notifications database: %w", err)
	}

	database := &Database{
		db:          sqlDB,
		timeZone:    timeZone,
		mailToEmail: mailToEmail,
		mailToName:  mailToName,
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultQueryTimeout)
	defer cancel()

	if err := database.ensureSchema(ctx); err != nil {
		sqlDB.Close()
		return nil, err
	}

	return database, nil
}

func (d *Database) Close() error {
	if d == nil || d.db == nil {
		return nil
	}
	return d.db.Close()
}

func (d *Database) ensureSchema(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            recent_notifications TEXT NOT NULL DEFAULT '[]',
            created INTEGER NOT NULL,
            expiry_warning_sent INTEGER NOT NULL DEFAULT 0,
            UNIQUE(endpoint, p256dh, auth)
        );`,
		`CREATE TABLE IF NOT EXISTS stops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER NOT NULL,
            parent_stop TEXT NOT NULL,
            routes TEXT,
            UNIQUE(clientId, parent_stop),
            FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
        );`,
		`CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER NOT NULL,
            trip_id TEXT NOT NULL,
            stop_sequence INTEGER NOT NULL,
            type TEXT NOT NULL,
            created INTEGER NOT NULL,
            UNIQUE(clientId, type),
            FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
        );`,
	}

	for _, stmt := range stmts {
		if _, err := d.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("ensure schema: %w", err)
		}
	}

	return nil
}

type Notification struct {
	Id                  int
	Endpoint            string
	P256dh              string
	Auth                string
	RecentNotifications []string
	Created             int
	ExpiryWarningSent   int
}

type Reminder struct {
	Id           int
	ClientId     int
	TripId       string
	StopSequence int
	Type         string
	Created      time.Time
}

func decodeRecentNotifications(raw sql.NullString) ([]string, error) {
	if !raw.Valid || raw.String == "" || raw.String == "[]" {
		return nil, nil
	}

	var notifications []string
	if err := json.Unmarshal([]byte(raw.String), &notifications); err != nil {
		return nil, err
	}
	return notifications, nil
}

func encodeRoutes(routes []string) ([]byte, error) {
	if len(routes) == 0 {
		return nil, nil
	}
	return json.Marshal(routes)
}

func decodeRoutes(raw sql.NullString) ([]string, error) {
	if !raw.Valid || raw.String == "" || raw.String == "[]" {
		return nil, nil
	}
	var routes []string
	if err := json.Unmarshal([]byte(raw.String), &routes); err != nil {
		return nil, err
	}
	return routes, nil
}

func (d *Database) queryContext(query string, args ...any) (*sql.Rows, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultQueryTimeout)
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return rows, cancel, nil
}

func (d *Database) queryRowContext(query string, args ...any) (*sql.Row, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultQueryTimeout)
	return d.db.QueryRowContext(ctx, query, args...), cancel
}

func (d *Database) execContext(query string, args ...any) (sql.Result, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultQueryTimeout)
	defer cancel()
	return d.db.ExecContext(ctx, query, args...)
}
