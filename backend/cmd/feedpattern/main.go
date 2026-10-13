// Command feedpattern polls a GTFS-RT TripUpdates feed and reports how the
// producer builds its stop predictions: one StopTimeUpdate per trip with the
// delay left for consumers to propagate, a constant delay across downstream
// stops, or genuinely modelled per-stop times. It also measures the producer's
// own prediction error by lead time when the feed later reports stops as
// passed.
//
// Each poll is saved as a raw .pb file so the analysis can be re-run offline:
//
//	AT_APIKEY=... go run ./cmd/feedpattern -duration 1h -interval 30s -out ./feedpattern-data
//	go run ./cmd/feedpattern -replay ./feedpattern-data
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jfmow/gtfs/realtime/proto"
	googleProto "google.golang.org/protobuf/proto"
)

func main() {
	url := flag.String("url", "https://api.at.govt.nz/realtime/legacy", "GTFS-RT feed URL (combined or trip updates)")
	header := flag.String("header", "Ocp-Apim-Subscription-Key", "API key header")
	keyEnv := flag.String("key-env", "AT_APIKEY", "env var holding the API key")
	interval := flag.Duration("interval", 30*time.Second, "poll interval (AT's key allows 35k requests/week, shared with the backend)")
	duration := flag.Duration("duration", 30*time.Minute, "how long to poll")
	out := flag.String("out", "feedpattern-data", "directory to save raw .pb snapshots")
	replay := flag.String("replay", "", "analyse saved .pb snapshots in this directory instead of polling")
	flag.Parse()

	var snaps []*proto.FeedMessage
	if *replay != "" {
		snaps = loadSnapshots(*replay)
	} else {
		key := os.Getenv(*keyEnv)
		if key == "" {
			log.Fatalf("%s is not set", *keyEnv)
		}
		if err := os.MkdirAll(*out, 0o755); err != nil {
			log.Fatal(err)
		}
		snaps = poll(*url, *header, key, *interval, *duration, *out)
	}
	if len(snaps) == 0 {
		log.Fatal("no snapshots")
	}
	analyse(snaps)
}

func poll(url, header, key string, interval, duration time.Duration, out string) []*proto.FeedMessage {
	var snaps []*proto.FeedMessage
	deadline := time.Now().Add(duration)
	client := http.Client{Timeout: 20 * time.Second}
	for {
		body, err := fetch(&client, url, header, key)
		if err != nil {
			log.Printf("fetch: %v", err)
		} else {
			var msg proto.FeedMessage
			if err := googleProto.Unmarshal(body, &msg); err != nil {
				log.Printf("unmarshal: %v", err)
			} else {
				snaps = append(snaps, &msg)
				name := filepath.Join(out, fmt.Sprintf("%d.pb", time.Now().Unix()))
				if err := os.WriteFile(name, body, 0o644); err != nil {
					log.Printf("save: %v", err)
				}
				log.Printf("poll %d: %d entities", len(snaps), len(msg.GetEntity()))
			}
		}
		if time.Now().Add(interval).After(deadline) {
			return snaps
		}
		time.Sleep(interval)
	}
}

func fetch(client *http.Client, url, header, key string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/x-protobuf")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set(header, key)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d: %.200s", resp.StatusCode, body)
	}
	return body, nil
}

func loadSnapshots(dir string) []*proto.FeedMessage {
	files, err := filepath.Glob(filepath.Join(dir, "*.pb"))
	if err != nil {
		log.Fatal(err)
	}
	sort.Strings(files)
	var snaps []*proto.FeedMessage
	for _, f := range files {
		body, err := os.ReadFile(f)
		if err != nil {
			log.Fatal(err)
		}
		var msg proto.FeedMessage
		if err := googleProto.Unmarshal(body, &msg); err != nil {
			log.Printf("%s: %v", f, err)
			continue
		}
		snaps = append(snaps, &msg)
	}
	return snaps
}

// pollTime is the moment a snapshot describes: the feed header timestamp,
// which the producer sets when it built the message.
func pollTime(msg *proto.FeedMessage) int64 {
	return int64(msg.GetHeader().GetTimestamp())
}

func stuTime(stu *proto.TripUpdate_StopTimeUpdate) (int64, bool) {
	if a := stu.GetArrival(); a != nil && a.GetTime() != 0 {
		return a.GetTime(), true
	}
	if d := stu.GetDeparture(); d != nil && d.GetTime() != 0 {
		return d.GetTime(), true
	}
	return 0, false
}

func stuDelay(stu *proto.TripUpdate_StopTimeUpdate) (int32, bool) {
	if a := stu.GetArrival(); a != nil && a.Delay != nil {
		return a.GetDelay(), true
	}
	if d := stu.GetDeparture(); d != nil && d.Delay != nil {
		return d.GetDelay(), true
	}
	return 0, false
}

type predKey struct {
	trip string
	seq  uint32
}

type prediction struct {
	at   int64 // feed timestamp when this prediction was published
	time int64 // predicted (or reported) arrival/departure time
}

func analyse(snaps []*proto.FeedMessage) {
	var (
		trips, tripsWithTripDelay                 int
		stuCountHist                              = map[string]int{}
		stus, stusWithTime, stusWithDelay, stuUnc int
		stusPast, stusFuture                      int
		stusBehindVehicle, stusAtVehicle, stusAhd int
		multiTrips, multiConstDelay               int
		multiFutureTrips, decaying, growing, flat int
		pointerAdvances, pointerSame, pointerObs  int
	)
	lastSeqs := map[string]string{}
	series := map[predKey][]prediction{}

	for _, msg := range snaps {
		now := pollTime(msg)
		vehicleSeq := map[string]uint32{}
		for _, e := range msg.GetEntity() {
			if v := e.GetVehicle(); v != nil && v.GetTrip().GetTripId() != "" {
				vehicleSeq[v.GetTrip().GetTripId()] = v.GetCurrentStopSequence()
			}
		}

		for _, e := range msg.GetEntity() {
			tu := e.GetTripUpdate()
			if tu == nil {
				continue
			}
			tripID := tu.GetTrip().GetTripId()
			trips++
			if tu.Delay != nil {
				tripsWithTripDelay++
			}
			updates := tu.GetStopTimeUpdate()
			stuCountHist[bucketCount(len(updates))]++

			var seqs []string
			var futureDelays []int32
			var delays []int32
			for _, stu := range updates {
				stus++
				seqs = append(seqs, fmt.Sprint(stu.GetStopSequence()))
				t, hasTime := stuTime(stu)
				if hasTime {
					stusWithTime++
					if t <= now {
						stusPast++
					} else {
						stusFuture++
					}
					series[predKey{tripID, stu.GetStopSequence()}] = append(series[predKey{tripID, stu.GetStopSequence()}], prediction{now, t})
				}
				if d, ok := stuDelay(stu); ok {
					stusWithDelay++
					delays = append(delays, d)
					if hasTime && t > now {
						futureDelays = append(futureDelays, d)
					}
				}
				if stu.GetArrival().GetUncertainty() != 0 || stu.GetDeparture().GetUncertainty() != 0 {
					stuUnc++
				}
				if vs, ok := vehicleSeq[tripID]; ok && vs != 0 && stu.GetStopSequence() != 0 {
					switch {
					case stu.GetStopSequence() < vs:
						stusBehindVehicle++
					case stu.GetStopSequence() == vs:
						stusAtVehicle++
					default:
						stusAhd++
					}
				}
			}

			if len(delays) >= 2 {
				multiTrips++
				if allEqual(delays) {
					multiConstDelay++
				}
			}
			if len(futureDelays) >= 2 {
				multiFutureTrips++
				first, last := abs32(futureDelays[0]), abs32(futureDelays[len(futureDelays)-1])
				switch {
				case last < first:
					decaying++
				case last > first:
					growing++
				default:
					flat++
				}
			}

			key := strings.Join(seqs, ",")
			if prev, ok := lastSeqs[tripID]; ok {
				pointerObs++
				if prev == key {
					pointerSame++
				} else {
					pointerAdvances++
				}
			}
			lastSeqs[tripID] = key
		}
	}

	first, last := pollTime(snaps[0]), pollTime(snaps[len(snaps)-1])
	fmt.Printf("Snapshots: %d over %s\n", len(snaps), time.Duration(last-first)*time.Second)
	fmt.Printf("Trip updates seen: %d (avg %.0f per snapshot)\n\n", trips, float64(trips)/float64(len(snaps)))

	fmt.Println("== Shape of each TripUpdate ==")
	for _, b := range []string{"0", "1", "2-5", "6-20", "21+"} {
		fmt.Printf("  %-5s StopTimeUpdates: %s\n", b, pct(stuCountHist[b], trips))
	}
	fmt.Printf("  trip-level delay field set: %s\n", pct(tripsWithTripDelay, trips))
	fmt.Printf("  StopTimeUpdates with absolute time: %s, with delay: %s, with uncertainty: %s\n",
		pct(stusWithTime, stus), pct(stusWithDelay, stus), pct(stuUnc, stus))
	fmt.Printf("  StopTimeUpdate times in the past (actuals): %s, future (predictions): %s\n",
		pct(stusPast, stusWithTime), pct(stusFuture, stusWithTime))
	if v := stusBehindVehicle + stusAtVehicle + stusAhd; v > 0 {
		fmt.Printf("  vs vehicle's current_stop_sequence: behind %s, at %s, ahead %s\n",
			pct(stusBehindVehicle, v), pct(stusAtVehicle, v), pct(stusAhd, v))
	}

	fmt.Println("\n== Downstream propagation ==")
	fmt.Printf("  trips with >=2 delays: %d; all delays identical: %s\n", multiTrips, pct(multiConstDelay, multiTrips))
	fmt.Printf("  trips with >=2 future stops: %d; |delay| shrinks downstream %s, grows %s, flat %s\n",
		multiFutureTrips, pct(decaying, multiFutureTrips), pct(growing, multiFutureTrips), pct(flat, multiFutureTrips))

	fmt.Println("\n== Across polls ==")
	fmt.Printf("  same trip seen again: %d; StopTimeUpdate stop set changed: %s, unchanged: %s\n",
		pointerObs, pct(pointerAdvances, pointerObs), pct(pointerSame, pointerObs))

	reportLeadError(series)
	fmt.Println()
	fmt.Println(verdict(stuCountHist, trips, multiTrips, multiConstDelay, stusPast, stusWithTime))
}

// reportLeadError treats the last value reported for a stop at or after the
// moment it became past as the actual time, and scores every earlier
// prediction for that stop against it, grouped by how far ahead it was made.
func reportLeadError(series map[predKey][]prediction) {
	type acc struct {
		n          int
		sumAbs     float64
		sumSigned  float64
		absSamples []float64
	}
	buckets := []struct {
		name   string
		lo, hi int64
	}{{"0-5m", 0, 300}, {"5-10m", 300, 600}, {"10-20m", 600, 1200}, {"20-40m", 1200, 2400}, {"40m+", 2400, math.MaxInt64}}
	accs := make([]acc, len(buckets))
	stopsScored := 0

	for _, preds := range series {
		actual, ok := int64(0), false
		for _, p := range preds {
			if p.time <= p.at {
				actual, ok = p.time, true
			}
		}
		if !ok {
			continue
		}
		stopsScored++
		for _, p := range preds {
			lead := p.time - p.at
			if lead <= 0 {
				continue
			}
			err := float64(p.time - actual)
			for i, b := range buckets {
				if lead >= b.lo && lead < b.hi {
					accs[i].n++
					accs[i].sumAbs += math.Abs(err)
					accs[i].sumSigned += err
					accs[i].absSamples = append(accs[i].absSamples, math.Abs(err))
				}
			}
		}
	}

	fmt.Println("\n== Producer prediction error vs later-reported actual ==")
	if stopsScored == 0 {
		fmt.Println("  no stops were reported after being passed, so the feed's own error can't be scored")
		fmt.Println("  (actual times will need to come from vehicle positions instead)")
		return
	}
	fmt.Printf("  stops with a reported actual: %d\n", stopsScored)
	fmt.Printf("  %-7s %7s %9s %9s %9s\n", "lead", "n", "MAE", "p90 |err|", "bias")
	for i, b := range buckets {
		a := accs[i]
		if a.n == 0 {
			fmt.Printf("  %-7s %7d\n", b.name, 0)
			continue
		}
		sort.Float64s(a.absSamples)
		p90 := a.absSamples[int(float64(len(a.absSamples)-1)*0.9)]
		fmt.Printf("  %-7s %7d %8.0fs %8.0fs %+8.0fs\n", b.name, a.n, a.sumAbs/float64(a.n), p90, a.sumSigned/float64(a.n))
	}
	fmt.Println("  (bias > 0 means the feed predicted later than the vehicle actually came)")
}

func verdict(hist map[string]int, trips, multi, multiConst, past, withTime int) string {
	if trips == 0 {
		return "Verdict: no trip updates in the feed."
	}
	single := float64(hist["0"]+hist["1"]) / float64(trips)
	switch {
	case single > 0.8:
		v := "Verdict: mostly one StopTimeUpdate per trip, so the producer publishes the current delay and leaves consumers to carry it forward to later stops (method 1)."
		if withTime > 0 && float64(past)/float64(withTime) > 0.5 {
			v += " The update is mostly for a stop already passed, so it's an observed arrival or departure, not a forecast."
		}
		return v
	case multi > 0 && float64(multiConst)/float64(multi) > 0.8:
		return "Verdict: several stops per trip, but the delay is the same at every stop, so it's still flat propagation done by the producer."
	default:
		return "Verdict: per-stop delays differ along the trip, so the producer is modelling downstream times (method 2 or 3)."
	}
}

func bucketCount(n int) string {
	switch {
	case n == 0:
		return "0"
	case n == 1:
		return "1"
	case n <= 5:
		return "2-5"
	case n <= 20:
		return "6-20"
	default:
		return "21+"
	}
}

func allEqual(xs []int32) bool {
	for _, x := range xs[1:] {
		if x != xs[0] {
			return false
		}
	}
	return true
}

func abs32(x int32) int32 {
	if x < 0 {
		return -x
	}
	return x
}

func pct(n, d int) string {
	if d == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%% (%d)", 100*float64(n)/float64(d), n)
}
