package providers

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestSearchQueryTooLarge(t *testing.T) {
	for _, q := range []string{"britomart", "Albany Station 4115", strings.Repeat("a ", 8)} {
		if searchQueryTooLarge(q) {
			t.Errorf("rejected ordinary search %q", q)
		}
	}
	for _, q := range []string{strings.Repeat("a ", 9), strings.Repeat("x", maxSearchQueryRunes+1)} {
		if !searchQueryTooLarge(q) {
			t.Errorf("accepted oversized search (%d chars)", len(q))
		}
	}
}

// gc must bound plans.db even when every plan's arrival is far in the future.
func TestPlanStoreGCCapsRows(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "plans.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE plans (id TEXT PRIMARY KEY, plan_json TEXT NOT NULL, arrival_unix INTEGER NOT NULL, created INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	future := now.Add(30 * 24 * time.Hour).Unix()
	tx, _ := db.Begin()
	for i := 0; i < planStoreMaxRows+50; i++ {
		tx.Exec(`INSERT INTO plans VALUES (?, '{}', ?, ?)`, fmt.Sprintf("p%06d", i), future, now.Unix()-int64(planStoreMaxRows+50-i))
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	(&planStore{db: db}).gc(now)

	var n int
	db.QueryRow(`SELECT count(*) FROM plans`).Scan(&n)
	if n != planStoreMaxRows {
		t.Fatalf("rows after gc = %d, want %d", n, planStoreMaxRows)
	}
	var oldest string
	db.QueryRow(`SELECT id FROM plans ORDER BY created ASC LIMIT 1`).Scan(&oldest)
	if oldest != "p000050" {
		t.Errorf("oldest kept row = %s, want p000050 (newest rows kept)", oldest)
	}
}
