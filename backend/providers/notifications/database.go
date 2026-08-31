package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
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

	dbPath := path.Join(getWorkDir(), "notifications", defaultDBFileName)

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
            causes TEXT,
            min_severity TEXT NOT NULL DEFAULT '',
            notify_cancellations INTEGER NOT NULL DEFAULT 1,
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
		`CREATE TABLE IF NOT EXISTS route_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER NOT NULL,
            route_id TEXT NOT NULL,
            causes TEXT,
            min_severity TEXT NOT NULL DEFAULT '',
            notify_cancellations INTEGER NOT NULL DEFAULT 1,
            UNIQUE(clientId, route_id),
            FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
        );`,
	}

	for _, stmt := range stmts {
		if _, err := d.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("ensure schema: %w", err)
		}
	}

	// stops predates causes/min_severity/notify_cancellations - CREATE TABLE IF
	// NOT EXISTS above is a no-op for anyone with an existing DB file, so those
	// three columns are added here instead. ALTER TABLE ADD COLUMN has no
	// "IF NOT EXISTS" form in SQLite, so each is guarded by checking
	// PRAGMA table_info first rather than by ignoring a "duplicate column" error.
	existingColumns, err := d.columnNames(ctx, "stops")
	if err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}
	migrations := []struct {
		column string
		ddl    string
	}{
		{"causes", `ALTER TABLE stops ADD COLUMN causes TEXT;`},
		{"min_severity", `ALTER TABLE stops ADD COLUMN min_severity TEXT NOT NULL DEFAULT '';`},
		{"notify_cancellations", `ALTER TABLE stops ADD COLUMN notify_cancellations INTEGER NOT NULL DEFAULT 1;`},
	}
	for _, m := range migrations {
		if existingColumns[m.column] {
			continue
		}
		if _, err := d.db.ExecContext(ctx, m.ddl); err != nil {
			return fmt.Errorf("ensure schema: migrate stops.%s: %w", m.column, err)
		}
	}

	return nil
}

func (d *Database) columnNames(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := d.db.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return nil, fmt.Errorf("read schema for %s: %w", table, err)
	}
	defer rows.Close()

	columns := make(map[string]bool)
	for rows.Next() {
		var (
			cid        int
			name       string
			ctype      string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &defaultVal, &pk); err != nil {
			return nil, fmt.Errorf("read schema for %s: %w", table, err)
		}
		columns[name] = true
	}
	return columns, rows.Err()
}

type Notification struct {
	Id                  int
	Endpoint            string
	P256dh              string
	Auth                string
	RecentNotifications []RecentNotificationEntry
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

type RecentNotificationEntry struct {
	ID     string `json:"id"`
	SeenAt int64  `json:"seen_at,omitempty"`
	// Title/Body are the actual push content, kept alongside the dedup id so
	// the in-app notification history has something readable to show -
	// omitted for legacy entries written before these fields existed.
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
}

func decodeRecentNotifications(raw sql.NullString) ([]RecentNotificationEntry, error) {
	if !raw.Valid || raw.String == "" || raw.String == "[]" {
		return nil, nil
	}

	var entries []RecentNotificationEntry
	if err := json.Unmarshal([]byte(raw.String), &entries); err == nil {
		var cleaned []RecentNotificationEntry
		for _, entry := range entries {
			if entry.ID == "" {
				continue
			}
			cleaned = append(cleaned, entry)
		}
		return cleaned, nil
	}

	var legacy []string
	if err := json.Unmarshal([]byte(raw.String), &legacy); err != nil {
		return nil, err
	}

	entries = make([]RecentNotificationEntry, 0, len(legacy))
	for _, id := range legacy {
		if id == "" {
			continue
		}
		entries = append(entries, RecentNotificationEntry{ID: id})
	}

	return entries, nil
}

func encodeRecentNotifications(entries []RecentNotificationEntry) ([]byte, error) {
	if len(entries) == 0 {
		return []byte("[]"), nil
	}
	return json.Marshal(entries)
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
