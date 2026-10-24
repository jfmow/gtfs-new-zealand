package timetable

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

// fixture: route R runs A -> B -> C every 10 min from 8:00 to 8:50 on
// weekdays. Wednesday 21 October 2026 is a weekday.
func fixture(t *testing.T) *Timetable {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gtfs.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE calendar (service_id TEXT, monday INT, tuesday INT, wednesday INT, thursday INT, friday INT, saturday INT, sunday INT, start_date TEXT, end_date TEXT)`,
		`CREATE TABLE calendar_dates (service_id TEXT, date TEXT, exception_type INT)`,
		`CREATE TABLE trips (trip_id TEXT, route_id TEXT, service_id TEXT)`,
		`CREATE TABLE stop_times (trip_id TEXT, stop_id TEXT, arrival_time TEXT, departure_time TEXT, stop_sequence INT)`,
		`CREATE TABLE stops (stop_id TEXT, parent_station TEXT, stop_lat REAL, stop_lon REAL)`,
		`INSERT INTO calendar VALUES ('wk',1,1,1,1,1,0,0,'20260101','20271231'), ('xmas',0,0,0,0,0,0,0,'20260101','20271231')`,
		`INSERT INTO calendar_dates VALUES ('wk','20261225',2)`,
		`INSERT INTO stops VALUES ('A','',-36.80,174.70), ('B','',-36.81,174.70), ('C','',-36.82,174.70), ('D','',-36.8218,174.70)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 6; i++ {
		trip := string(rune('a' + i))
		db.Exec(`INSERT INTO trips VALUES (?, 'R', 'wk')`, trip)
		m := i * 10
		for seq, stop := range []string{"A", "B", "C"} {
			hms := clock(8*3600 + (m+seq*5)*60)
			db.Exec(`INSERT INTO stop_times VALUES (?, ?, ?, ?, ?)`, trip, stop, hms, hms, seq+1)
		}
	}
	db.Close()
	tz, _ := time.LoadLocation("Pacific/Auckland")
	tt, err := Open(path, tz)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tt.db.Close() })
	return tt
}

func TestTripsByHourAndHeadway(t *testing.T) {
	tt := fixture(t)
	tz := tt.tz
	wed := time.Date(2026, 10, 21, 8, 20, 0, 0, tz)
	if got := tt.TripsByHour("R", wed); got[8] != 6 || got[9] != 0 {
		t.Errorf("trips by hour = %v", got)
	}
	if h, ok := tt.Headway("R", "B", wed); !ok || h != 20*time.Minute {
		// 6 trips in the 2 hours around 8:20.
		t.Errorf("headway = %v ok=%t", h, ok)
	}
	sat := time.Date(2026, 10, 24, 8, 20, 0, 0, tz)
	if got := tt.TripsByHour("R", sat); got[8] != 0 {
		t.Errorf("no weekday service on Saturday: %v", got)
	}
	xmas := time.Date(2026, 12, 25, 8, 20, 0, 0, tz)
	if got := tt.TripsByHour("R", xmas); got[8] != 0 {
		t.Errorf("calendar_dates removes Christmas: %v", got)
	}
}

func TestLongestTrip(t *testing.T) {
	tt := fixture(t)
	if trip, ok := tt.LongestTrip("R", time.Date(2026, 10, 21, 9, 0, 0, 0, tt.tz)); !ok || trip == "" {
		t.Errorf("trip = %q ok=%t", trip, ok)
	}
	if _, ok := tt.LongestTrip("nope", time.Now()); ok {
		t.Error("unknown route")
	}
}
