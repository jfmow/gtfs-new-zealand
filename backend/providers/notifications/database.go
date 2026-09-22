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
	"sync"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jfmow/gtfs"
	_ "github.com/mattn/go-sqlite3"
)

var ErrClientNotFound = errors.New("notification client not found")

// notifications.db is a single shared file, but SetupNotificationsRoutes runs
// once per region - without this every region would open its own connection pool
// (each with its own page cache) against the same file. Share one handle.
var (
	sharedDBOnce sync.Once
	sharedDB     *Database
	sharedDBErr  error
)

func sharedDatabase(timeZone *time.Location, mailToEmail, mailToName string) (*Database, error) {
	sharedDBOnce.Do(func() {
		sharedDB, sharedDBErr = newDatabase(timeZone, mailToEmail, mailToName)
	})
	return sharedDB, sharedDBErr
}

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
	dbPath := path.Join(getWorkDir(), "notifications", defaultDBFileName)

	if !filepath.IsAbs(dbPath) {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("get cwd: %w", err)
		}
		dbPath = filepath.Join(cwd, dbPath)
	}

	return newDatabaseAtPath(dbPath, timeZone, mailToEmail, mailToName)
}

// newDatabaseAtPath is newDatabase with an explicit file path - split out so
// tests can point it at a throwaway file instead of the real
// notifications/notifications.db.
func newDatabaseAtPath(dbPath string, timeZone *time.Location, mailToEmail, mailToName string) (*Database, error) {
	if timeZone == nil {
		return nil, errors.New("time zone is required")
	}

	sqlDB, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL&_txlock=immediate&_cache_size=-4000")
	if err != nil {
		return nil, fmt.Errorf("open notifications database: %w", err)
	}

	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("ping notifications database: %w", err)
	}

	// Small file, low write rate - a tiny pool avoids idle connections and lock
	// contention (WAL + immediate-txn locking + a busy timeout handle the rest).
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(1)

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

// Maintain reclaims free pages left by 30-day client GC / reminder churn and
// folds the WAL back into the main file. Cheap - the DB is tiny - but run it at
// most daily, off-peak.
func (d *Database) Maintain() {
	if d == nil || d.db == nil {
		return
	}
	if _, err := d.db.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		fmt.Println("notifications: wal_checkpoint:", err)
	}
	if _, err := d.db.Exec("VACUUM;"); err != nil {
		fmt.Println("notifications: VACUUM:", err)
	}
}

// PruneStaleReminders removes one-shot reminders whose trip never fired (created
// before cutoff). Nothing else deletes these until the owning client's 30-day
// cascade.
func (d *Database) PruneStaleReminders(cutoffUnix int64) {
	if d == nil || d.db == nil {
		return
	}
	if _, err := d.execContext(`DELETE FROM reminders WHERE created < ?`, cutoffUnix); err != nil {
		fmt.Println("notifications: PruneStaleReminders:", err)
	}
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
		// "Leave-by" planned journey reminders. Unlike `reminders` (one-shot,
		// bound to a live trip_id, UNIQUE(clientId, type)) a device may hold
		// several of these, for different journeys/days, and a recurring row's
		// service_date changes over its life - so dedup is on `dedup_key`
		// (a hash of the template identity) instead of a fixed type.
		`CREATE TABLE IF NOT EXISTS journey_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clientId INTEGER NOT NULL,
            region TEXT NOT NULL DEFAULT '',
            dedup_key TEXT NOT NULL DEFAULT '',

            kind TEXT NOT NULL DEFAULT 'fixed_trip',
            status TEXT NOT NULL DEFAULT 'armed',

            start_lat REAL NOT NULL DEFAULT 0, start_lon REAL NOT NULL DEFAULT 0, start_label TEXT NOT NULL DEFAULT '',
            end_lat REAL NOT NULL DEFAULT 0, end_lon REAL NOT NULL DEFAULT 0, end_label TEXT NOT NULL DEFAULT '',
            time_type TEXT NOT NULL DEFAULT 'arriveat',
            target_hhmm TEXT NOT NULL DEFAULT '',
            max_walk_km REAL NOT NULL DEFAULT 1.0,
            walk_speed REAL NOT NULL DEFAULT 4.8,
            max_transfers INTEGER NOT NULL DEFAULT 5,
            only_route_ids TEXT NOT NULL DEFAULT '[]',
            -- prep_buffer_seconds: removed. The leave anchor is now the journey's
            -- real walk-out time; older DBs keep the (ignored) column.
            offsets TEXT NOT NULL DEFAULT '[30,15,5,0]',
            recurrence TEXT NOT NULL DEFAULT '',
            recurrence_until TEXT NOT NULL DEFAULT '',
            deeplink TEXT NOT NULL DEFAULT '/plan',

            service_date TEXT NOT NULL,
            target_unix INTEGER NOT NULL,
            board_trip_id TEXT, board_stop_id TEXT, board_stop_sequence INTEGER,
            scheduled_departure_unix INTEGER,
            access_seconds INTEGER,
            route_short_name TEXT NOT NULL DEFAULT '',
            board_stop_name TEXT NOT NULL DEFAULT '',
            sent_offsets TEXT NOT NULL DEFAULT '[]',
            baseline_leave_unix INTEGER,
            resolve_attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT '',

            created INTEGER NOT NULL,
            updated INTEGER NOT NULL,

            UNIQUE(clientId, dedup_key),
            FOREIGN KEY(clientId) REFERENCES notifications(id) ON DELETE CASCADE
        );`,
		`CREATE INDEX IF NOT EXISTS idx_jr_region_status ON journey_reminders(region, status);`,
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

	// journey_reminders predates only_route_ids - same ADD COLUMN-if-missing
	// treatment as the stops migration above.
	jrExistingColumns, err := d.columnNames(ctx, "journey_reminders")
	if err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}
	jrMigrations := []struct {
		column string
		ddl    string
	}{
		{"only_route_ids", `ALTER TABLE journey_reminders ADD COLUMN only_route_ids TEXT NOT NULL DEFAULT '[]';`},
	}
	for _, m := range jrMigrations {
		if jrExistingColumns[m.column] {
			continue
		}
		if _, err := d.db.ExecContext(ctx, m.ddl); err != nil {
			return fmt.Errorf("ensure schema: migrate journey_reminders.%s: %w", m.column, err)
		}
	}

	if err := d.migrateNotificationsDeviceIdentity(ctx); err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}

	return nil
}

// migrateNotificationsDeviceIdentity generalises `notifications` from a
// web-push-only client table (endpoint/p256dh/auth, all NOT NULL) to one that
// can also hold a native device (platform/device_id/device_secret_hash/
// apns_token/...). SQLite can't drop a NOT NULL constraint or a table-level
// UNIQUE with ALTER TABLE, so this rebuilds the table - a no-op once
// `platform` already exists.
func (d *Database) migrateNotificationsDeviceIdentity(ctx context.Context) error {
	existingColumns, err := d.columnNames(ctx, "notifications")
	if err != nil {
		return fmt.Errorf("migrate notifications device identity: %w", err)
	}
	if existingColumns["platform"] {
		return nil
	}

	conn, err := d.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("migrate notifications device identity: %w", err)
	}
	defer conn.Close()

	// PRAGMA foreign_keys is a no-op inside a transaction, so it has to be set
	// on this connection before BEGIN - and since it's per-connection, the
	// rebuild below must run on this same *sql.Conn throughout.
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=OFF;`); err != nil {
		return fmt.Errorf("migrate notifications device identity: disable foreign keys: %w", err)
	}
	// Always try to restore it, even if the migration below fails.
	defer conn.ExecContext(context.Background(), `PRAGMA foreign_keys=ON;`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrate notifications device identity: begin: %w", err)
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE TABLE notifications_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT,
            p256dh TEXT,
            auth TEXT,
            platform TEXT NOT NULL DEFAULT 'web',
            device_id TEXT,
            device_secret_hash TEXT,
            apns_token TEXT,
            apns_env TEXT NOT NULL DEFAULT '',
            push_to_start_token TEXT,
            recent_notifications TEXT NOT NULL DEFAULT '[]',
            created INTEGER NOT NULL,
            expiry_warning_sent INTEGER NOT NULL DEFAULT 0
        );`,
		`INSERT INTO notifications_new (id, endpoint, p256dh, auth, platform, recent_notifications, created, expiry_warning_sent)
            SELECT id, endpoint, p256dh, auth, 'web', recent_notifications, created, expiry_warning_sent FROM notifications;`,
		`DROP TABLE notifications;`,
		`ALTER TABLE notifications_new RENAME TO notifications;`,
		// Table-level UNIQUE(endpoint,p256dh,auth) becomes a partial index, since
		// an iOS row leaves those three columns NULL (NULL never conflicts with
		// NULL in SQLite anyway, but being explicit is cheap and future-proof).
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_web_identity ON notifications(endpoint, p256dh, auth) WHERE platform = 'web';`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_device_id ON notifications(device_id) WHERE device_id IS NOT NULL;`,
	}
	for _, stmt := range stmts {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate notifications device identity: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migrate notifications device identity: commit: %w", err)
	}

	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=ON;`); err != nil {
		return fmt.Errorf("migrate notifications device identity: re-enable foreign keys: %w", err)
	}
	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check;`)
	if err != nil {
		return fmt.Errorf("migrate notifications device identity: foreign key check: %w", err)
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("migrate notifications device identity: foreign key check failed after rebuild")
	}

	return nil
}

// ClientIdentity is how a request says which client it is - either a native
// device's X-Device-Id/X-Device-Secret header pair, or (the original, and
// still how the web PWA identifies itself) the endpoint/p256dh/auth triple
// from its push subscription. See routes.go's identityFromRequest.
type ClientIdentity struct {
	DeviceID     string
	DeviceSecret string
	Endpoint     string
	P256dh       string
	Auth         string
}

func (id ClientIdentity) isDevice() bool { return id.DeviceID != "" }

// ResolveClient finds an already-registered client from its identity. An iOS
// device must already exist (via RegisterIOSDevice/POST /devices/register);
// a web client is matched on its push subscription triple, same as
// FindNotificationClient always did. parentStopId, if given, additionally
// requires the client to hold a stop subscription for that parent stop.
func (v *Database) ResolveClient(identity ClientIdentity, parentStopId string) (*NotificationClient, error) {
	if identity.isDevice() {
		client, err := v.FindIOSDeviceClient(identity.DeviceID, identity.DeviceSecret)
		if err != nil {
			return nil, err
		}
		if parentStopId != "" {
			subscribed, sErr := v.clientSubscribedToStop(client.Id, parentStopId)
			if sErr != nil {
				return nil, sErr
			}
			if !subscribed {
				return nil, ErrClientNotFound
			}
		}
		return client, nil
	}
	return v.FindNotificationClient(identity.Endpoint, identity.P256dh, identity.Auth, parentStopId)
}

// ResolveOrCreateClient is ResolveClient, but for the handful of endpoints
// that silently create a web push client on first use (a device that was
// never explicitly subscribed to anything yet still wants a reminder). An
// iOS device can't be created this way - there's no APNs token to create it
// with - so an unregistered device id is ErrDeviceNotRegistered.
func (v *Database) ResolveOrCreateClient(identity ClientIdentity, gtfsDB gtfs.Database) (*NotificationClient, error) {
	if identity.isDevice() {
		client, err := v.FindIOSDeviceClient(identity.DeviceID, identity.DeviceSecret)
		if err != nil {
			if errors.Is(err, ErrClientNotFound) {
				return nil, ErrDeviceNotRegistered
			}
			return nil, err
		}
		return client, nil
	}
	return v.CreateNotificationClient(identity.Endpoint, identity.P256dh, identity.Auth, gtfsDB)
}

func (v *Database) clientSubscribedToStop(clientId int, parentStopId string) (bool, error) {
	row, cancel := v.queryRowContext(`SELECT 1 FROM stops WHERE clientId = ? AND parent_stop = ?`, clientId, parentStopId)
	defer cancel()

	var one int
	if err := row.Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
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
	// URL is the notification's deeplink (push data.url) so the in-app list can
	// open the relevant page on tap. Dismissed hides the entry from the in-app
	// list while keeping the row so the TTL'd push-dedup (hasSeenNotification)
	// still suppresses a repeat native notification.
	URL       string `json:"url,omitempty"`
	Dismissed bool   `json:"dismissed,omitempty"`
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

// encodeIntSlice / decodeIntSlice back the JSON []int columns on
// journey_reminders (offsets, sent_offsets). Empty always round-trips as "[]"
// (the column's NOT NULL DEFAULT), never NULL.
func encodeIntSlice(values []int) string {
	if len(values) == 0 {
		return "[]"
	}
	b, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func decodeIntSlice(raw sql.NullString) []int {
	if !raw.Valid || raw.String == "" || raw.String == "[]" {
		return nil
	}
	var values []int
	if err := json.Unmarshal([]byte(raw.String), &values); err != nil {
		return nil
	}
	return values
}

// encodeStringSlice / decodeStringSlice back the JSON []string column on
// journey_reminders (only_route_ids), same round-trip convention as
// encodeIntSlice/decodeIntSlice above.
func encodeStringSlice(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	b, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func decodeStringSlice(raw sql.NullString) []string {
	if !raw.Valid || raw.String == "" || raw.String == "[]" {
		return nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw.String), &values); err != nil {
		return nil
	}
	return values
}

// nullableString is a small helper for INSERT/UPDATE args: an empty string
// should be stored as SQL NULL (not "") in the nullable device-identity
// columns, so an absent APNs token round-trips as NULL rather than "".
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// rowScanner is the common subset of *sql.Row and *sql.Rows that
// scanClientRow needs - so the same scan code backs both a single-row lookup
// (queryRowContext) and a multi-row fan-out query (queryContext).
type rowScanner interface {
	Scan(dest ...any) error
}

// scanClientRow scans the notification-client identity/meta columns that
// every client query below selects, in this fixed order:
//
//	id, endpoint, p256dh, auth, platform, device_id, apns_token, apns_env,
//	push_to_start_token, recent_notifications, created, expiry_warning_sent
//
// followed by whatever extra columns the caller's query appends (e.g.
// s.routes, r.min_severity) - passed through to Scan as extra destinations.
// The returned client's RecentNotifications is decoded but not pruned or
// platform-checked for expiry; callers do that.
func scanClientRow(row rowScanner, extra ...any) (NotificationClient, error) {
	var (
		id                             int
		endpoint, p256dh, auth         sql.NullString
		platform                       string
		deviceID, apnsToken, pushStart sql.NullString
		apnsEnv                        string
		recent                         sql.NullString
		created                        int
		expiryWarningSent              int
	)

	dest := append([]any{
		&id, &endpoint, &p256dh, &auth, &platform, &deviceID, &apnsToken, &apnsEnv, &pushStart,
		&recent, &created, &expiryWarningSent,
	}, extra...)

	if err := row.Scan(dest...); err != nil {
		return NotificationClient{}, err
	}

	recentEntries, err := decodeRecentNotifications(recent)
	if err != nil {
		return NotificationClient{}, fmt.Errorf("parse recent notifications: %w", err)
	}

	return NotificationClient{
		Id:               id,
		Platform:         platform,
		DeviceID:         deviceID.String,
		ApnsToken:        apnsToken.String,
		ApnsEnv:          apnsEnv,
		PushToStartToken: pushStart.String,
		Notification: webpush.Subscription{
			Endpoint: endpoint.String,
			Keys:     webpush.Keys{Auth: auth.String, P256dh: p256dh.String},
		},
		RecentNotifications: recentEntries,
		Created:             created,
		ExpiryWarningSent:   expiryWarningSent,
	}, nil
}

// clientCoreColumns is the fixed SELECT list every scanClientRow call site
// must use, in that exact order (see scanClientRow's doc comment), so the
// alias prefix ("n." for a join, "" for a plain SELECT FROM notifications)
// is the only thing that varies between queries.
func clientCoreColumns(alias string) string {
	if alias != "" {
		alias += "."
	}
	return alias + "id, " + alias + "endpoint, " + alias + "p256dh, " + alias + "auth, " +
		alias + "platform, " + alias + "device_id, " + alias + "apns_token, " + alias + "apns_env, " +
		alias + "push_to_start_token, " + alias + "recent_notifications, " + alias + "created, " + alias + "expiry_warning_sent"
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
