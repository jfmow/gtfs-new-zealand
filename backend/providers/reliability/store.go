package reliability

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

/*
reliability.db keeps how routes have been running - aggregates only, never
per-trip history (that's what made the old history store too big). Two kinds
of table:

  - Fading figures, for "how does it usually run": stop_delays (route x
    station x time-of-week band), route_trips (trips run / cancelled by band),
    route_hours (route x day type x hour) and day_weights (how many days of
    each type those add up to). Every day all of them are multiplied by
    decayPerDay, so they follow the last few weeks and a row nobody's seen for
    months drops out.

  - Dated figures, for trends: route_days holds each route's day for 8 weeks,
    then rollup folds those days into route_weeks (kept 2 years). Service
    alerts are logged in alert_log for 8 weeks, then kept only as a weekly
    count per route in alert_weeks. So the trend survives at a few hundred
    bytes a route a week.

One SQLite file, process-wide, with a region column (the region processes'
recorders all write to it).
*/

// halfLifeDays: a day's observations count half as much this many days on.
const halfLifeDays = 21

var decayPerDay = math.Pow(0.5, 1.0/halfLifeDays)

// Rows whose decayed sample count falls below this are deleted.
const pruneBelow = 0.3

// Daily rows (route_days, alert_log) are rolled up into weekly ones once
// they're this old; weekly rows are kept this long.
const (
	keepDays  = 56
	keepWeeks = 104
)

// binEdges are the delay histogram's bin boundaries in seconds: a delay d
// falls in the first bin whose edge is above it, or the last.
//
//	0: < -2 min   1: -2..-1   2: -1..+1   3: +1..+3
//	4: +3..+5     5: +5..+10  6: +10..+15 7: >= +15 min
var binEdges = [...]int{-120, -60, 60, 180, 300, 600, 900}

const numBins = len(binEdges) + 1

func binFor(delaySeconds int) int {
	for i, edge := range binEdges {
		if delaySeconds < edge {
			return i
		}
	}
	return numBins - 1
}

// stopAgg is a delay distribution: a row's figures, or a batch of additions
// to them. Every table that holds delays stores these columns (aggCols).
type stopAgg struct {
	n, delaySum, delaySq float64
	bins                 [numBins]float64
}

func (a *stopAgg) merge(b stopAgg) {
	a.n += b.n
	a.delaySum += b.delaySum
	a.delaySq += b.delaySq
	for i := range a.bins {
		a.bins[i] += b.bins[i]
	}
}

func (a *stopAgg) add(delaySeconds int) {
	d := float64(delaySeconds)
	a.n++
	a.delaySum += d
	a.delaySq += d * d
	a.bins[binFor(delaySeconds)]++
}

// variance of the delays, in seconds squared.
func (a stopAgg) variance() float64 {
	if a.n < 2 {
		return 0
	}
	mean := a.delaySum / a.n
	return math.Max(0, a.delaySq/a.n-mean*mean)
}

// aggCols - "n, delay_sum, delay_sq, h0, ..., h7".
var aggCols = func() []string {
	cols := []string{"n", "delay_sum", "delay_sq"}
	for i := 0; i < numBins; i++ {
		cols = append(cols, fmt.Sprintf("h%d", i))
	}
	return cols
}()

func (a *stopAgg) dest() []any {
	out := []any{&a.n, &a.delaySum, &a.delaySq}
	for i := range a.bins {
		out = append(out, &a.bins[i])
	}
	return out
}

func (a stopAgg) args() []any {
	out := []any{a.n, a.delaySum, a.delaySq}
	for _, b := range a.bins {
		out = append(out, b)
	}
	return out
}

// Keys for each table's rows.
type (
	stopKey  struct{ region, route, stop, band string }
	routeKey struct{ region, route, band string }
	hourKey  struct {
		region, route, dayType string
		hour                   int
	}
	dayKey    struct{ region, route, date string }
	weightKey struct{ region, dayType string }
)

type routeAgg struct {
	trips, cancelled float64
}

// hourAgg is a route's delays by hour of day, and how many trips started
// in that hour.
type hourAgg struct {
	stopAgg
	trips float64
}

// dayAgg is one route's dated day (or week).
type dayAgg struct {
	stopAgg
	trips, cancelled float64
}

// batch is one recorder tick's additions.
type batch struct {
	stops   map[stopKey]*stopAgg
	routes  map[routeKey]*routeAgg
	hours   map[hourKey]*hourAgg
	days    map[dayKey]*dayAgg
	weights map[weightKey]float64
}

func newBatch() *batch {
	return &batch{
		stops: map[stopKey]*stopAgg{}, routes: map[routeKey]*routeAgg{},
		hours: map[hourKey]*hourAgg{}, days: map[dayKey]*dayAgg{}, weights: map[weightKey]float64{},
	}
}

func (b *batch) empty() bool {
	return len(b.stops) == 0 && len(b.routes) == 0 && len(b.hours) == 0 && len(b.days) == 0 && len(b.weights) == 0
}

// Store is the reliability database. Every method tolerates a nil Store, so
// a database that won't open just means no reliability figures.
type Store struct {
	db *sql.DB
	mu sync.Mutex // serialises the daily decay and rollup against flushes
}

var (
	sharedOnce  sync.Once
	sharedStore *Store
)

// Shared opens (once) the process-wide store under DATA_DIR/reliability,
// or nil if it can't be opened.
func Shared() *Store {
	sharedOnce.Do(func() {
		s, err := Open(filepath.Join(workDir(), "reliability", "reliability.db"))
		if err != nil {
			log.Printf("reliability: %v", err)
			return
		}
		sharedStore = s
	})
	return sharedStore
}

// workDir mirrors main.go's getWorkDir (also copied in plan_store.go and
// notifications/help.go).
func workDir() string {
	if dir := os.Getenv("DATA_DIR"); dir != "" {
		return dir
	}
	ex, err := os.Executable()
	if err != nil {
		return "."
	}
	dir := filepath.Dir(ex)
	if strings.Contains(dir, "go-build") {
		return "."
	}
	return dir
}

// Open opens (creating if needed) a store at path.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create dir: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate&_cache_size=-4000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(1)

	agg := make([]string, len(aggCols))
	for i, c := range aggCols {
		agg[i] = c + " REAL NOT NULL DEFAULT 0"
	}
	aggDDL := strings.Join(agg, ", ")
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS stop_delays (
			region TEXT NOT NULL, route_id TEXT NOT NULL, stop_id TEXT NOT NULL, band TEXT NOT NULL,
			` + aggDDL + `,
			PRIMARY KEY (region, route_id, stop_id, band)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS route_trips (
			region TEXT NOT NULL, route_id TEXT NOT NULL, band TEXT NOT NULL,
			trips REAL NOT NULL DEFAULT 0, cancelled REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, route_id, band)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS route_hours (
			region TEXT NOT NULL, route_id TEXT NOT NULL, day_type TEXT NOT NULL, hour INTEGER NOT NULL,
			` + aggDDL + `, trips REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, route_id, day_type, hour)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS day_weights (
			region TEXT NOT NULL, day_type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, day_type)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS route_days (
			region TEXT NOT NULL, route_id TEXT NOT NULL, date TEXT NOT NULL,
			` + aggDDL + `, trips REAL NOT NULL DEFAULT 0, cancelled REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, route_id, date)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS route_weeks (
			region TEXT NOT NULL, route_id TEXT NOT NULL, week TEXT NOT NULL,
			` + aggDDL + `, trips REAL NOT NULL DEFAULT 0, cancelled REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, route_id, week)
		) WITHOUT ROWID;`,
		`CREATE INDEX IF NOT EXISTS idx_route_days_date ON route_days(region, date);`,
		`CREATE TABLE IF NOT EXISTS alert_log (
			region TEXT NOT NULL, alert_id TEXT NOT NULL,
			first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
			header TEXT NOT NULL DEFAULT '', effect TEXT NOT NULL DEFAULT '', cause TEXT NOT NULL DEFAULT '',
			routes TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (region, alert_id)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS alert_weeks (
			region TEXT NOT NULL, route_id TEXT NOT NULL, week TEXT NOT NULL,
			alerts INTEGER NOT NULL DEFAULT 0, hours REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (region, route_id, week)
		) WITHOUT ROWID;`,
		`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			db.Close()
			return nil, fmt.Errorf("schema: %w", err)
		}
	}
	// stop_delays predates delay_sq.
	if _, err := db.Exec(`ALTER TABLE stop_delays ADD COLUMN delay_sq REAL NOT NULL DEFAULT 0`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	return s.db.Close()
}

// upsertSQL adds each of cols on conflict.
func upsertSQL(table string, keys, cols []string) string {
	all := append(append([]string{}, keys...), cols...)
	marks := strings.TrimSuffix(strings.Repeat("?, ", len(all)), ", ")
	sets := make([]string, len(cols))
	for i, c := range cols {
		sets[i] = fmt.Sprintf("%s = %s + excluded.%s", c, c, c)
	}
	return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
		table, strings.Join(all, ", "), marks, strings.Join(keys, ", "), strings.Join(sets, ", "))
}

// flush adds a batch in one transaction.
func (s *Store) flush(b *batch) error {
	if s == nil || b == nil || b.empty() {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	exec := func(query string, rows [][]any) error {
		if len(rows) == 0 {
			return nil
		}
		stmt, err := tx.Prepare(query)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, r := range rows {
			if _, err := stmt.Exec(r...); err != nil {
				return err
			}
		}
		return nil
	}

	var rows [][]any
	for k, a := range b.stops {
		rows = append(rows, append([]any{k.region, k.route, k.stop, k.band}, a.args()...))
	}
	if err := exec(upsertSQL("stop_delays", []string{"region", "route_id", "stop_id", "band"}, aggCols), rows); err != nil {
		return err
	}

	rows = nil
	for k, a := range b.routes {
		rows = append(rows, []any{k.region, k.route, k.band, a.trips, a.cancelled})
	}
	if err := exec(upsertSQL("route_trips", []string{"region", "route_id", "band"}, []string{"trips", "cancelled"}), rows); err != nil {
		return err
	}

	rows = nil
	for k, a := range b.hours {
		rows = append(rows, append(append([]any{k.region, k.route, k.dayType, k.hour}, a.args()...), a.trips))
	}
	if err := exec(upsertSQL("route_hours", []string{"region", "route_id", "day_type", "hour"}, append(append([]string{}, aggCols...), "trips")), rows); err != nil {
		return err
	}

	rows = nil
	for k, a := range b.days {
		rows = append(rows, append(append([]any{k.region, k.route, k.date}, a.args()...), a.trips, a.cancelled))
	}
	if err := exec(upsertSQL("route_days", []string{"region", "route_id", "date"}, append(append([]string{}, aggCols...), "trips", "cancelled")), rows); err != nil {
		return err
	}

	rows = nil
	for k, w := range b.weights {
		rows = append(rows, []any{k.region, k.dayType, w})
	}
	if err := exec(upsertSQL("day_weights", []string{"region", "day_type"}, []string{"weight"}), rows); err != nil {
		return err
	}
	return tx.Commit()
}

// decay fades the fading tables by a day's worth for each day since it last
// ran (catching up after downtime), drops rows that have faded away, rolls
// old dated rows up (rollupLocked), and reclaims the space. Safe to call
// often - it does nothing on a day it already ran.
func (s *Store) decay(now time.Time) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	// Days turn over at 15:00 UTC - 3-4am in NZ, 1am in Brisbane - so
	// the big UPDATE runs while it's quiet.
	today := decayDay(now)
	var last string
	_ = s.db.QueryRow(`SELECT value FROM meta WHERE key = 'decayed'`).Scan(&last)
	if last == today {
		return nil
	}
	days := 1
	if t, err := time.Parse("2006-01-02", last); err == nil {
		days = int(now.UTC().Add(-decayDayOffset).Sub(t).Hours() / 24)
		if days < 1 {
			days = 1
		}
	}
	if last == "" {
		days = 0 // a new store has nothing to fade yet
	}
	f := math.Pow(decayPerDay, float64(days))

	fade := func(table string, cols []string) string {
		sets := make([]string, len(cols))
		for i, c := range cols {
			sets[i] = fmt.Sprintf("%s = %s * %v", c, c, f)
		}
		return "UPDATE " + table + " SET " + strings.Join(sets, ", ")
	}
	type query struct {
		sql  string
		args []any
	}
	var queries []query
	if days > 0 {
		queries = append(queries,
			query{fade("stop_delays", aggCols), nil},
			query{fade("route_trips", []string{"trips", "cancelled"}), nil},
			query{fade("route_hours", append(append([]string{}, aggCols...), "trips")), nil},
			query{fade("day_weights", []string{"weight"}), nil},
		)
	}
	queries = append(queries,
		query{`DELETE FROM stop_delays WHERE n < ?`, []any{pruneBelow}},
		query{`DELETE FROM route_trips WHERE trips < ?`, []any{pruneBelow}},
		query{`DELETE FROM route_hours WHERE n < ? AND trips < ?`, []any{pruneBelow, pruneBelow}},
		query{`INSERT INTO meta (key, value) VALUES ('decayed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []any{today}},
	)
	for _, q := range queries {
		if _, err := s.db.Exec(q.sql, q.args...); err != nil {
			return err
		}
	}
	if err := s.rollupLocked(now); err != nil {
		return err
	}
	s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return nil
}

const decayDayOffset = 15 * time.Hour

func decayDay(now time.Time) string {
	return now.UTC().Add(-decayDayOffset).Format("2006-01-02")
}

// weekOf is the Monday starting date's week, "2006-01-02".
func weekOf(date string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	back := (int(t.Weekday()) + 6) % 7 // Monday = 0
	return t.AddDate(0, 0, -back).Format("2006-01-02")
}

// rollupLocked folds route_days older than keepDays into route_weeks and
// alerts older than keepDays into alert_weeks, and drops weeks older than
// keepWeeks. Caller holds s.mu.
func (s *Store) rollupLocked(now time.Time) error {
	cutoff := now.UTC().AddDate(0, 0, -keepDays).Format("2006-01-02")
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	cols := append(append([]string{}, aggCols...), "trips", "cancelled")
	rows, err := tx.Query(`SELECT region, route_id, date, `+strings.Join(cols, ", ")+` FROM route_days WHERE date < ?`, cutoff)
	if err != nil {
		return err
	}
	weeks := map[dayKey]*dayAgg{}
	for rows.Next() {
		var k dayKey
		var d dayAgg
		if err := rows.Scan(append(append([]any{&k.region, &k.route, &k.date}, d.dest()...), &d.trips, &d.cancelled)...); err != nil {
			rows.Close()
			return err
		}
		wk := dayKey{k.region, k.route, weekOf(k.date)}
		w := weeks[wk]
		if w == nil {
			w = &dayAgg{}
			weeks[wk] = w
		}
		w.merge(d.stopAgg)
		w.trips += d.trips
		w.cancelled += d.cancelled
	}
	rows.Close()
	if len(weeks) > 0 {
		stmt, err := tx.Prepare(upsertSQL("route_weeks", []string{"region", "route_id", "week"}, cols))
		if err != nil {
			return err
		}
		for k, w := range weeks {
			if _, err := stmt.Exec(append(append([]any{k.region, k.route, k.date}, w.args()...), w.trips, w.cancelled)...); err != nil {
				stmt.Close()
				return err
			}
		}
		stmt.Close()
	}
	if _, err := tx.Exec(`DELETE FROM route_days WHERE date < ?`, cutoff); err != nil {
		return err
	}

	// Alerts: each old alert counts once in the week it started, against
	// every route it named, with how long it was up.
	cutoffUnix := now.AddDate(0, 0, -keepDays).Unix()
	arows, err := tx.Query(`SELECT region, first_seen, last_seen, routes FROM alert_log WHERE last_seen < ?`, cutoffUnix)
	if err != nil {
		return err
	}
	type alertWeek struct {
		alerts int
		hours  float64
	}
	alertWeeks := map[dayKey]*alertWeek{}
	for arows.Next() {
		var region, routes string
		var first, last int64
		if err := arows.Scan(&region, &first, &last, &routes); err != nil {
			arows.Close()
			return err
		}
		week := weekOf(time.Unix(first, 0).UTC().Format("2006-01-02"))
		for _, route := range strings.Split(routes, ",") {
			if route == "" {
				continue
			}
			k := dayKey{region, route, week}
			w := alertWeeks[k]
			if w == nil {
				w = &alertWeek{}
				alertWeeks[k] = w
			}
			w.alerts++
			w.hours += float64(last-first) / 3600
		}
	}
	arows.Close()
	for k, w := range alertWeeks {
		if _, err := tx.Exec(upsertSQL("alert_weeks", []string{"region", "route_id", "week"}, []string{"alerts", "hours"}),
			k.region, k.route, k.date, w.alerts, w.hours); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM alert_log WHERE last_seen < ?`, cutoffUnix); err != nil {
		return err
	}

	oldWeek := weekOf(now.UTC().AddDate(0, 0, -7*keepWeeks).Format("2006-01-02"))
	if _, err := tx.Exec(`DELETE FROM route_weeks WHERE week < ?`, oldWeek); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM alert_weeks WHERE week < ?`, oldWeek); err != nil {
		return err
	}
	return tx.Commit()
}

// stopStats reads one stop_delays row.
func (s *Store) stopStats(k stopKey) (stopAgg, bool) {
	if s == nil {
		return stopAgg{}, false
	}
	var a stopAgg
	err := s.db.QueryRow(`SELECT `+strings.Join(aggCols, ", ")+` FROM stop_delays
		WHERE region = ? AND route_id = ? AND stop_id = ? AND band = ?`,
		k.region, k.route, k.stop, k.band).Scan(a.dest()...)
	return a, err == nil
}

// stopStatsForStop reads every route's row at a stop in one band.
func (s *Store) stopStatsForStop(region, stop, band string) map[string]stopAgg {
	out := map[string]stopAgg{}
	if s == nil {
		return out
	}
	rows, err := s.db.Query(`SELECT route_id, `+strings.Join(aggCols, ", ")+` FROM stop_delays
		WHERE region = ? AND stop_id = ? AND band = ?`, region, stop, band)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var route string
		var a stopAgg
		if rows.Scan(append([]any{&route}, a.dest()...)...) == nil {
			out[route] = a
		}
	}
	return out
}

// routeStats reads one route_trips row.
func (s *Store) routeStats(k routeKey) (routeAgg, bool) {
	if s == nil {
		return routeAgg{}, false
	}
	var a routeAgg
	err := s.db.QueryRow(`SELECT trips, cancelled FROM route_trips WHERE region = ? AND route_id = ? AND band = ?`,
		k.region, k.route, k.band).Scan(&a.trips, &a.cancelled)
	return a, err == nil
}

type routeRow struct {
	stop, band string
	agg        stopAgg
}

// routeRows reads every stop_delays row for a route.
func (s *Store) routeRows(region, route string) []routeRow {
	if s == nil {
		return nil
	}
	rows, err := s.db.Query(`SELECT stop_id, band, `+strings.Join(aggCols, ", ")+` FROM stop_delays
		WHERE region = ? AND route_id = ?`, region, route)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []routeRow
	for rows.Next() {
		var r routeRow
		if rows.Scan(append([]any{&r.stop, &r.band}, r.agg.dest()...)...) == nil {
			out = append(out, r)
		}
	}
	return out
}

// routeTrips reads a route's trip counts by band.
func (s *Store) routeTrips(region, route string) map[string]routeAgg {
	out := map[string]routeAgg{}
	if s == nil {
		return out
	}
	rows, err := s.db.Query(`SELECT band, trips, cancelled FROM route_trips WHERE region = ? AND route_id = ?`, region, route)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var band string
		var a routeAgg
		if rows.Scan(&band, &a.trips, &a.cancelled) == nil {
			out[band] = a
		}
	}
	return out
}
