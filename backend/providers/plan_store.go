package providers

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/gtfs"
	_ "github.com/mattn/go-sqlite3"
)

/*
plan_store persists computed journey plans by their UUID (gtfs.JourneyPlan.ID)
so a shared "?id=…" link (GET /services/plan/:id) keeps working after a backend
restart - the in-memory planCache in services.go is L1, this is the durable L2.
Entries are kept only until the journey is well over (arrival + planStoreTTL).

One SQLite file, process-wide: setupServicesRoutes runs once per region but plan
UUIDs are globally unique so there's no need to scope by region.
*/

const planStoreTTL = 6 * time.Hour

// planStoreWorkDir mirrors main.go's package-private getWorkDir (also copied in
// providers/notifications/help.go).
func planStoreWorkDir() string {
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

type planStore struct{ db *sql.DB }

var (
	planStoreOnce sync.Once
	planStoreInst *planStore
)

// getPlanStore returns the process-wide store, or nil if it couldn't be opened
// (every method is nil-tolerant, so a failure just degrades to the in-memory cache).
func getPlanStore() *planStore {
	planStoreOnce.Do(func() {
		dir := filepath.Join(planStoreWorkDir(), "plans")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return
		}
		db, err := sql.Open("sqlite3", filepath.Join(dir, "plans.db")+"?_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate&_cache_size=-4000")
		if err != nil {
			return
		}
		if err := db.Ping(); err != nil {
			db.Close()
			return
		}
		// One writer, one reader is plenty for a small share-link cache; keeps
		// idle connections from pinning WAL snapshots and blocking checkpoints.
		db.SetMaxOpenConns(2)
		db.SetMaxIdleConns(1)
		if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS plans (
			id TEXT PRIMARY KEY,
			plan_json TEXT NOT NULL,
			arrival_unix INTEGER NOT NULL,
			created INTEGER NOT NULL
		);`); err != nil {
			db.Close()
			return
		}
		db.Exec(`CREATE INDEX IF NOT EXISTS idx_plans_arrival ON plans(arrival_unix);`)
		planStoreInst = &planStore{db: db}
	})
	return planStoreInst
}

func (s *planStore) put(p gtfs.JourneyPlan) {
	if s == nil || p.ID == "" {
		return
	}
	b, err := json.Marshal(p)
	if err != nil {
		return
	}
	now := time.Now().Unix()
	s.db.Exec(
		`INSERT INTO plans (id, plan_json, arrival_unix, created) VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET plan_json = excluded.plan_json, arrival_unix = excluded.arrival_unix`,
		p.ID, string(b), p.ArrivalTime.Unix(), now,
	)
}

func (s *planStore) get(id string) (gtfs.JourneyPlan, bool) {
	if s == nil || id == "" {
		return gtfs.JourneyPlan{}, false
	}
	var raw string
	var arrival int64
	if err := s.db.QueryRow(`SELECT plan_json, arrival_unix FROM plans WHERE id = ?`, id).Scan(&raw, &arrival); err != nil {
		return gtfs.JourneyPlan{}, false
	}
	if time.Now().Unix() > arrival+int64(planStoreTTL.Seconds()) {
		return gtfs.JourneyPlan{}, false
	}
	var p gtfs.JourneyPlan
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return gtfs.JourneyPlan{}, false
	}
	return p, true
}

func (s *planStore) gc(now time.Time) {
	if s == nil {
		return
	}
	s.db.Exec(`DELETE FROM plans WHERE arrival_unix < ?`, now.Add(-planStoreTTL).Unix())
	// Nothing else checkpoints this WAL - fold it back into the main file so it
	// doesn't drift up to SQLite's auto-checkpoint threshold and stay there.
	s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
}
