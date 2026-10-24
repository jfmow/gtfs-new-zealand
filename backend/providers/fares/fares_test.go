package fares

import (
	"strings"
	"testing"
	"time"

	"github.com/jfmow/gtfs"
)

func nz(t *testing.T) *time.Location {
	t.Helper()
	tz, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Fatal(err)
	}
	return tz
}

// Real station positions (AT GTFS) and the zones AT's map puts them in.
var (
	grafton   = gtfs.Stop{StopId: "grafton", StopName: "Grafton", StopLat: -36.86437, StopLon: 174.76459}        // City
	newmarket = gtfs.Stop{StopId: "newmarket", StopName: "Newmarket", StopLat: -36.86972, StopLon: 174.77883}    // City, Isthmus
	ellerslie = gtfs.Stop{StopId: "ellerslie", StopName: "Ellerslie", StopLat: -36.89845, StopLon: 174.80821}    // Isthmus
	otahuhu   = gtfs.Stop{StopId: "otahuhu", StopName: "Otahuhu", StopLat: -36.94669, StopLon: 174.83321}        // Isthmus, Northern Manukau
	papakura  = gtfs.Stop{StopId: "papakura", StopName: "Papakura", StopLat: -37.06441, StopLon: 174.94545}      // Southern Manukau
	manukau   = gtfs.Stop{StopId: "manukau", StopName: "Manukau", StopLat: -36.99350, StopLon: 174.87960}        // Northern/Southern Manukau
	nowhere   = gtfs.Stop{StopId: "sea", StopName: "Mid-Pacific", StopLat: -30, StopLon: 170}
)

func ride(route string, routeType int, from, to gtfs.Stop, dep time.Time, minutes int) gtfs.JourneyLeg {
	f, tt := from, to
	return gtfs.JourneyLeg{
		Mode: "transit", TripID: route + "-" + from.StopId, RouteID: route,
		Route:    &gtfs.Route{RouteId: route, RouteShortName: route, RouteType: routeType},
		FromStop: &f, ToStop: &tt,
		DepartureTime: dep, ArrivalTime: dep.Add(time.Duration(minutes) * time.Minute),
	}
}

func walk(dep time.Time, minutes int) gtfs.JourneyLeg {
	return gtfs.JourneyLeg{Mode: "walk", DepartureTime: dep, ArrivalTime: dep.Add(time.Duration(minutes) * time.Minute)}
}

func plan(legs ...gtfs.JourneyLeg) gtfs.JourneyPlan { return gtfs.JourneyPlan{ID: "p", Legs: legs} }

func TestMoney(t *testing.T) {
	for cents, want := range map[int]string{50: "50c", 300: "$3", 490: "$4.90", 1850: "$18.50", 95: "95c"} {
		if got := money(cents); got != want {
			t.Errorf("money(%d) = %q, want %q", cents, got, want)
		}
	}
}

func TestCountZones(t *testing.T) {
	for _, c := range []struct {
		stops [][]string
		want  int
	}{
		{[][]string{{"City"}, {"City", "Isthmus"}}, 1},              // Grafton -> Newmarket
		{[][]string{{"City", "Isthmus"}, {"Isthmus"}}, 1},           // Newmarket -> Ellerslie
		{[][]string{{"City"}, {"City", "Isthmus"}, {"Isthmus"}}, 2}, // Grafton -> Ellerslie
		{[][]string{{"City", "Isthmus"}}, 1},
		{[][]string{{"City"}, {"Isthmus"}, {"Isthmus", "Northern Manukau"}, {"Northern Manukau", "Southern Manukau"}, {"Southern Manukau"}}, 4},
		{[][]string{{"City"}, {"Southern Manukau"}}, 3}, // not neighbours: one zone between
		{[][]string{{"City"}, {"Lower North Shore"}}, 2}, // across the harbour
	} {
		if got, ok := aucklandZones().countZones(c.stops); !ok || got != c.want {
			t.Errorf("countZones(%v) = %d, want %d", c.stops, got, c.want)
		}
	}
	if _, ok := aucklandZones().countZones([][]string{{"City"}, nil}); ok {
		t.Error("a stop outside every zone can't be priced")
	}
}

func TestAucklandZoneLookup(t *testing.T) {
	zm := aucklandZones()
	for _, c := range []struct {
		stop gtfs.Stop
		want []string
	}{
		{grafton, []string{"City"}},
		{newmarket, []string{"City", "Isthmus"}},
		{ellerslie, []string{"Isthmus"}},
		{papakura, []string{"Southern Manukau"}},
		{nowhere, nil},
	} {
		got := zm.zonesAt(c.stop.StopLat, c.stop.StopLon)
		if len(got) != len(c.want) {
			t.Errorf("%s: zones %v, want %v", c.stop.StopName, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("%s: zones %v, want %v", c.stop.StopName, got, c.want)
			}
		}
	}
}

func TestAuckland(t *testing.T) {
	tz := nz(t)
	at := time.Date(2026, 10, 21, 8, 0, 0, 0, tz)
	// The Southern line calls at these between Grafton and Papakura.
	southern := []gtfs.Stop{grafton, newmarket, ellerslie, otahuhu, manukau, papakura}
	calc := For("at", Deps{TZ: tz, StopsOnTrip: func(trip string) []gtfs.Stop {
		if trip == "STH-grafton" {
			return southern
		}
		return nil
	}})

	// Within the overlap: one zone.
	e, ok := calc.Estimate(plan(walk(at, 5), ride("STH", routeRail, grafton, newmarket, at.Add(5*time.Minute), 4)), Adult)
	if !ok || e.Cents != 300 || e.Label != "$3" || e.Detail != "AT HOP or contactless · 1 zone" || e.Partial {
		t.Errorf("Grafton-Newmarket: %+v", e)
	}

	// All the way down the line: City, Isthmus, Northern and Southern
	// Manukau - from the stops it passes, not just the two ends.
	e, _ = calc.Estimate(plan(ride("STH", routeRail, grafton, papakura, at, 40)), Adult)
	if e.Cents != 790 || e.Detail != "AT HOP or contactless · 4 zones" {
		t.Errorf("Grafton-Papakura: %+v", e)
	}

	// Bus then train within 30 min: one fare over both. Too long a wait:
	// two fares.
	bus := ride("70", routeBus, ellerslie, newmarket, at, 10)
	train := ride("WEST", routeRail, newmarket, grafton, at.Add(20*time.Minute), 4)
	e, _ = calc.Estimate(plan(bus, walk(at.Add(10*time.Minute), 5), train), Adult)
	if len(e.Parts) != 1 || e.Cents != 490 {
		t.Errorf("transfer: %+v", e)
	}
	late := ride("WEST", routeRail, newmarket, grafton, at.Add(50*time.Minute), 4)
	e, _ = calc.Estimate(plan(bus, late), Adult)
	if len(e.Parts) != 2 || e.Cents != 600 || e.Detail != "AT HOP or contactless · 2 fares" {
		t.Errorf("no transfer: %+v", e)
	}

	// A ferry isn't priced: the rest is, marked partial.
	ferry := ride("DEV", routeFerry, grafton, newmarket, at.Add(20*time.Minute), 12)
	e, _ = calc.Estimate(plan(bus, ferry), Adult)
	if !e.Partial || e.Label != "$3+" || e.Cents != 300 {
		t.Errorf("ferry: %+v", e)
	}
	// Only a ferry: no estimate.
	if _, ok := calc.Estimate(plan(ferry), Adult); ok {
		t.Error("a ferry-only journey has no estimate")
	}
	// City Link on its own.
	e, _ = calc.Estimate(plan(ride("CTY", routeBus, grafton, newmarket, at, 6)), Adult)
	if e.Cents != 95 {
		t.Errorf("City Link: %+v", e)
	}
}

func TestZoneSpan(t *testing.T) {
	for _, c := range []struct {
		stops [][]int
		want  int
	}{
		{[][]int{{3}, {2}, {1}, {2}, {3}}, 3}, // across the city: each zone once
		{[][]int{{1}, {1, 2}}, 1},
		{[][]int{{1, 2}, {3}}, 2},
		{[][]int{{5}, {4, 5}, {7}}, 3},
	} {
		if got, ok := zoneSpan(c.stops); !ok || got != c.want {
			t.Errorf("zoneSpan(%v) = %d, want %d", c.stops, got, c.want)
		}
	}
	if _, ok := zoneSpan([][]int{{1}, nil}); ok {
		t.Error("a stop with no zone can't be priced")
	}
}

func TestWellington(t *testing.T) {
	tz := nz(t)
	zones := map[string]string{"karori": "3", "kelburn": "2", "lambton": "1", "miramar": "3", "boundary": "1/2", "petone": "5", "wgtn-stn": "1"}
	stops := func(ids ...string) []gtfs.Stop {
		var out []gtfs.Stop
		for _, id := range ids {
			out = append(out, gtfs.Stop{StopId: id})
		}
		return out
	}
	calc := For("wel", Deps{TZ: tz, ZoneOf: func(id string) string { return zones[id] }, StopsOnTrip: func(trip string) []gtfs.Stop {
		if trip == "2-karori" {
			return stops("karori", "kelburn", "lambton", "miramar")
		}
		return nil
	}})
	peak := time.Date(2026, 10, 21, 8, 0, 0, 0, tz) // Wednesday 8am
	offPeak := time.Date(2026, 10, 21, 11, 0, 0, 0, tz)

	cross := ride("2", routeBus, gtfs.Stop{StopId: "karori"}, gtfs.Stop{StopId: "miramar"}, peak, 35)
	e, ok := calc.Estimate(plan(cross), Adult)
	if !ok || e.Cents != 467 || e.Detail != "Snapper or contactless · 3 zones · peak" {
		t.Errorf("across the city at peak: %+v", e)
	}
	cross.DepartureTime, cross.ArrivalTime = offPeak, offPeak.Add(35*time.Minute)
	e, _ = calc.Estimate(plan(cross), Adult)
	if e.Cents != 374 {
		t.Errorf("off-peak: %+v", e)
	}

	// Bus then train: two fares, even straight after.
	bus := ride("1", routeBus, gtfs.Stop{StopId: "boundary"}, gtfs.Stop{StopId: "wgtn-stn"}, peak, 5)
	train := ride("HVL", routeRail, gtfs.Stop{StopId: "wgtn-stn"}, gtfs.Stop{StopId: "petone"}, peak.Add(10*time.Minute), 15)
	e, _ = calc.Estimate(plan(bus, train), Adult)
	if len(e.Parts) != 2 || e.Parts[0].Cents != 212 || e.Parts[1].Cents != 639 {
		t.Errorf("bus + train: %+v", e)
	}

	// The cable car isn't priced.
	cable := ride("CCL", routeCableTram, gtfs.Stop{StopId: "lambton"}, gtfs.Stop{StopId: "kelburn"}, peak, 5)
	if _, ok := calc.Estimate(plan(cable), Adult); ok {
		t.Error("cable car only: no estimate")
	}
}

func TestWellingtonOffPeak(t *testing.T) {
	tz := nz(t)
	day := func(h, m int) time.Time { return time.Date(2026, 10, 21, h, m, 0, 0, tz) } // a Wednesday
	for _, c := range []struct {
		at    time.Time
		train bool
		want  bool
	}{
		{day(6, 30), false, true}, {day(6, 30), true, false},
		{day(8, 0), false, false}, {day(9, 0), false, true}, {day(15, 0), false, false},
		{day(18, 30), false, true}, {time.Date(2026, 10, 24, 8, 0, 0, 0, tz), false, true},
	} {
		if got := wellingtonOffPeak(c.at, c.train); got != c.want {
			t.Errorf("offPeak(%v, train=%t) = %t", c.at, c.train, got)
		}
	}
}

func TestChristchurch(t *testing.T) {
	tz := nz(t)
	at := time.Date(2026, 10, 21, 8, 0, 0, 0, tz)
	calc := For("christ", Deps{TZ: tz})
	a, b := gtfs.Stop{StopId: "a"}, gtfs.Stop{StopId: "b"}
	// Two buses within two hours: one fare. A third later: another.
	e, _ := calc.Estimate(plan(ride("1", routeBus, a, b, at, 20), ride("3", routeBus, b, a, at.Add(60*time.Minute), 20), ride("5", routeBus, a, b, at.Add(150*time.Minute), 10)), Adult)
	if len(e.Parts) != 2 || e.Cents != 600 {
		t.Errorf("transfers: %+v", e)
	}
	// The Diamond Harbour ferry (route F) is its own fare.
	e, _ = calc.Estimate(plan(ride("F", routeBus, a, b, at, 20)), Adult)
	if e.Cents != 500 || e.Detail != "Metrocard or contactless · ferry" {
		t.Errorf("ferry: %+v", e)
	}
}

func TestOtago(t *testing.T) {
	tz := nz(t)
	zones := map[string]string{"octagon": "5900_1", "mosgiel": "5900_1", "palmerston": "5900_3", "frankton": "5901_1"}
	calc := For("otago", Deps{TZ: tz, ZoneOf: func(id string) string { return zones[id] }})
	octagon, mosgiel, palmerston := gtfs.Stop{StopId: "octagon"}, gtfs.Stop{StopId: "mosgiel"}, gtfs.Stop{StopId: "palmerston"}

	before := time.Date(2026, 10, 21, 8, 0, 0, 0, tz)
	after := time.Date(2026, 11, 2, 8, 0, 0, 0, tz)
	if e, ok := calc.Estimate(plan(ride("1", routeBus, octagon, palmerston, before, 50)), Adult); !ok || e.Cents != 250 {
		t.Errorf("flat fare before November: %+v", e)
	}
	if e, ok := calc.Estimate(plan(ride("1", routeBus, octagon, mosgiel, after, 30)), Adult); !ok || e.Cents != 250 {
		t.Errorf("within Dunedin after November: %+v", e)
	}
	if _, ok := calc.Estimate(plan(ride("1", routeBus, octagon, palmerston, after, 50)), Adult); ok {
		t.Error("out of Dunedin after November isn't estimated")
	}
	if e, _ := calc.Estimate(plan(ride("6", routeFerry, gtfs.Stop{StopId: "frankton"}, gtfs.Stop{StopId: "frankton"}, before, 20)), Adult); e.Cents != 1000 {
		t.Errorf("Queenstown ferry: %+v", e)
	}
}

func TestSEQ(t *testing.T) {
	at := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	a, b := gtfs.Stop{StopId: "a"}, gtfs.Stop{StopId: "b"}
	calc := For("seq", Deps{})
	e, _ := calc.Estimate(plan(ride("BNBR", routeRail, a, b, at, 30), ride("F1", routeFerry, b, a, at.Add(45*time.Minute), 20)), Adult)
	if e.Cents != 50 || e.Label != "50c" || e.Currency != "AUD" || len(e.Parts) != 1 {
		t.Errorf("train + ferry within an hour: %+v", e)
	}
	if For("nowhere", Deps{}) != nil {
		t.Error("an unknown region has no calculator")
	}
}

func TestConcessions(t *testing.T) {
	tz := nz(t)
	wed8 := time.Date(2026, 10, 21, 8, 0, 0, 0, tz)  // weekday peak
	wed10 := time.Date(2026, 10, 21, 10, 0, 0, 0, tz) // weekday off-peak
	sat := time.Date(2026, 10, 24, 10, 0, 0, 0, tz)
	price := func(calc Calculator, legs gtfs.JourneyPlan, c Concession) Estimate {
		t.Helper()
		e, ok := calc.Estimate(legs, c)
		if !ok {
			t.Fatalf("no estimate for %s", c)
		}
		return e
	}

	// Auckland: Grafton -> Ellerslie is 2 zones.
	at := For("at", Deps{TZ: tz})
	two := func(dep time.Time) gtfs.JourneyPlan { return plan(ride("STH", routeRail, grafton, ellerslie, dep, 8)) }
	for _, c := range []struct {
		conc  Concession
		dep   time.Time
		cents int
		card  string
	}{
		{Adult, wed8, 490, "AT HOP or contactless"},
		{Child, wed8, 290, "Registered AT HOP card"},
		{Child, sat, 0, "Registered AT HOP card"},
		{Tertiary, wed8, 290, "Registered AT HOP card"},
		{Community, wed8, 245, "Registered AT HOP card"},
		{SuperGold, wed8, 490, "Registered AT HOP card"},
		{SuperGold, wed10, 0, "Registered AT HOP card"},
		{Youth, wed8, 490, "AT HOP or contactless"},
	} {
		e := price(at, two(c.dep), c.conc)
		if e.Cents != c.cents || !strings.HasPrefix(e.Detail, c.card) {
			t.Errorf("Auckland %s at %v: %d %q, want %d %q", c.conc, c.dep.Format("Mon 15:04"), e.Cents, e.Detail, c.cents, c.card)
		}
	}
	if e := price(at, two(wed8), Youth); e.Concession != Adult || !strings.HasPrefix(e.Note, "Adult fare - there's no youth fare here.") {
		t.Errorf("unsupported concession falls back to adult and says so: %+v", e)
	}
	if e := price(at, two(sat), Child); e.Label != "Free" {
		t.Errorf("free label: %q", e.Label)
	}

	// Wellington: 3 zones.
	zones := map[string]string{"a": "1", "b": "3"}
	wel := For("wel", Deps{TZ: tz, ZoneOf: func(id string) string { return zones[id] }})
	three := func(dep time.Time) gtfs.JourneyPlan {
		return plan(ride("2", routeBus, gtfs.Stop{StopId: "a"}, gtfs.Stop{StopId: "b"}, dep, 20))
	}
	for _, c := range []struct {
		conc  Concession
		dep   time.Time
		cents int
	}{
		{Adult, wed8, 467}, {Adult, wed10, 374},
		{Child, wed8, 234}, {Community, wed10, 187},
		{Tertiary, wed8, 350}, {Tertiary, wed10, 350},
		{SuperGold, wed8, 467}, {SuperGold, wed10, 0},
	} {
		if e := price(wel, three(c.dep), c.conc); e.Cents != c.cents {
			t.Errorf("Wellington %s at %v: %d, want %d", c.conc, c.dep.Format("15:04"), e.Cents, c.cents)
		}
	}

	// Christchurch.
	ch := For("christ", Deps{TZ: tz})
	bus := func(dep time.Time) gtfs.JourneyPlan {
		return plan(ride("1", routeBus, gtfs.Stop{StopId: "a"}, gtfs.Stop{StopId: "b"}, dep, 20))
	}
	for c, want := range map[Concession]int{Adult: 300, Child: 150, Youth: 250, Tertiary: 300} {
		if e := price(ch, bus(wed8), c); e.Cents != want {
			t.Errorf("Christchurch %s: %d, want %d", c, e.Cents, want)
		}
	}
	if e := price(ch, bus(time.Date(2026, 10, 21, 16, 0, 0, 0, tz)), SuperGold); e.Cents != 0 {
		t.Errorf("Christchurch SuperGold is still free in the afternoon: %+v", e)
	}

	// Otago: Community Connect, and no concessions on the ferry.
	ot := For("otago", Deps{TZ: tz})
	if e := price(ot, bus(wed8), Community); e.Cents != 125 {
		t.Errorf("Otago Community Connect: %+v", e)
	}
	if e := price(ot, plan(ride("6", routeFerry, gtfs.Stop{StopId: "a"}, gtfs.Stop{StopId: "b"}, wed8, 20)), Child); e.Cents != 1000 {
		t.Errorf("Otago ferry has no child fare: %+v", e)
	}

	if e := price(ot, bus(wed8), Youth); e.Cents != 250 || e.Concession != Adult {
		t.Errorf("Otago has no 19-24 youth fare: %+v", e)
	}

	// SEQ: everyone pays 50c.
	if e := price(For("seq", Deps{}), bus(wed8), SuperGold); e.Cents != 50 {
		t.Errorf("SEQ: %+v", e)
	}
	if ParseConcession("nonsense") != Adult || ParseConcession("child") != Child {
		t.Error("ParseConcession")
	}
}

func TestOptions(t *testing.T) {
	for _, region := range []string{"at", "wel", "christ", "otago", "seq", "nowhere"} {
		opts := Options(region)
		if len(opts) == 0 || opts[0].Value != Adult {
			t.Errorf("%s: adult must come first: %+v", region, opts)
		}
	}
	if offers("christ", Tertiary) || !offers("christ", Youth) || offers("at", Youth) || len(Options("seq")) != 1 {
		t.Error("region offers")
	}
}
