package fares

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/gtfs"
)

// Auckland Transport. Fares by the number of zones travelled through, capped
// at four; a journey of up to five bus/train rides within four hours, no
// more than 30 min between them, is one fare. Ferries are priced separately
// and aren't estimated.
//
// Prices from 1 February 2026:
// https://at.govt.nz/bus-train-ferry/fares-and-discounts/public-transport-fare-changes
var aucklandZoneCents = [...]int{0, 300, 490, 650, 790} // by zones, 4+ = [4]

const aucklandCitylinkCents = 95

// Zones: AT's "Fare Zones" layer (Auckland Transport, CC BY 4.0) -
// https://data-atgis.opendata.arcgis.com, item 3549d3cc98e7480abb77f436e05a7799,
// last edited September 2026. Overlap areas are polygons named after both
// zones ("City, Isthmus"): a stop there counts as either.
//
//go:embed at_fare_zones.geojson
var aucklandZonesGeoJSON []byte

type zonePolygon struct {
	names []string
	rings [][][2]float64 // [lon, lat]; the first is the outline, the rest holes
	minLon, minLat, maxLon, maxLat float64
}

type zoneMap struct {
	polygons []zonePolygon
	// neighbours holds "a|b" (both ways) for zones that meet - known from
	// the overlap areas between them.
	neighbours map[string]bool
}

var (
	aucklandZonesOnce sync.Once
	aucklandZonesVal  *zoneMap
)

func aucklandZones() *zoneMap {
	aucklandZonesOnce.Do(func() {
		zm, err := parseZones(aucklandZonesGeoJSON)
		if err == nil {
			aucklandZonesVal = zm
		}
	})
	return aucklandZonesVal
}

func parseZones(raw []byte) (*zoneMap, error) {
	var fc struct {
		Features []struct {
			Properties struct {
				Name string `json:"Name"`
			} `json:"properties"`
			Geometry struct {
				Type        string          `json:"type"`
				Coordinates json.RawMessage `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		return nil, err
	}
	zm := &zoneMap{neighbours: map[string]bool{}}
	link := func(a, b string) { zm.neighbours[a+"|"+b], zm.neighbours[b+"|"+a] = true, true }
	for _, pair := range aucklandExtraNeighbours {
		link(pair[0], pair[1])
	}
	for _, f := range fc.Features {
		var polys [][][][2]float64
		switch f.Geometry.Type {
		case "Polygon":
			var p [][][2]float64
			if err := json.Unmarshal(f.Geometry.Coordinates, &p); err != nil {
				return nil, err
			}
			polys = append(polys, p)
		case "MultiPolygon":
			if err := json.Unmarshal(f.Geometry.Coordinates, &polys); err != nil {
				return nil, err
			}
		default:
			continue
		}
		var names []string
		for _, n := range strings.Split(f.Properties.Name, ",") {
			if n = strings.TrimSpace(n); n != "" {
				names = append(names, n)
			}
		}
		for i := range names {
			for j := i + 1; j < len(names); j++ {
				link(names[i], names[j])
			}
		}
		for _, rings := range polys {
			if len(rings) == 0 {
				continue
			}
			p := zonePolygon{names: names, rings: rings, minLon: 180, minLat: 90, maxLon: -180, maxLat: -90}
			for _, c := range rings[0] {
				p.minLon, p.maxLon = min(p.minLon, c[0]), max(p.maxLon, c[0])
				p.minLat, p.maxLat = min(p.minLat, c[1]), max(p.maxLat, c[1])
			}
			zm.polygons = append(zm.polygons, p)
		}
	}
	return zm, nil
}

// zonesAt is every zone the point counts as (two in an overlap area), or
// nil outside them all.
func (zm *zoneMap) zonesAt(lat, lon float64) []string {
	if zm == nil {
		return nil
	}
	var out []string
	for _, p := range zm.polygons {
		if lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat {
			continue
		}
		if !inRing(p.rings[0], lon, lat) {
			continue
		}
		inHole := false
		for _, hole := range p.rings[1:] {
			if inRing(hole, lon, lat) {
				inHole = true
				break
			}
		}
		if !inHole {
			out = append(out, p.names...)
		}
	}
	return out
}

// inRing - ray casting.
func inRing(ring [][2]float64, x, y float64) bool {
	in := false
	for i, j := 0, len(ring)-1; i < len(ring); j, i = i, i+1 {
		xi, yi, xj, yj := ring[i][0], ring[i][1], ring[j][0], ring[j][1]
		if (yi > y) != (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi {
			in = !in
		}
	}
	return in
}

// countZones is the fewest zones a trip passes through, given its stops in
// order (each with the zones it can count as - two in an overlap area). It
// follows the trip zone to zone: staying put is free, moving into a
// neighbouring zone adds one, and a jump between zones that don't touch
// (stops can be far apart) adds two - it went through one in between. A
// trip that doubles back into a zone counts it again (rare for a planned
// journey). False if any stop is outside every zone.
func (zm *zoneMap) countZones(stops [][]string) (int, bool) {
	if len(stops) == 0 {
		return 0, false
	}
	cost := map[string]int{}
	for _, z := range stops[0] {
		cost[z] = 1
	}
	for _, zs := range stops {
		if len(zs) == 0 {
			return 0, false
		}
	}
	for _, zs := range stops[1:] {
		next := map[string]int{}
		for _, z := range zs {
			best := -1
			for prev, c := range cost {
				step := 0
				switch {
				case prev == z:
				case zm.adjacent(prev, z):
					step = 1
				default:
					step = 2
				}
				if best < 0 || c+step < best {
					best = c + step
				}
			}
			next[z] = best
		}
		cost = next
	}
	best := -1
	for _, c := range cost {
		if best < 0 || c < best {
			best = c
		}
	}
	return best, true
}

// aucklandExtraNeighbours touch across water, with no overlap area to say so.
var aucklandExtraNeighbours = [][2]string{{"City", "Lower North Shore"}}

func (zm *zoneMap) adjacent(a, b string) bool {
	if zm == nil {
		return false
	}
	return zm.neighbours[a+"|"+b]
}

type auckland struct {
	deps  Deps
	zones *zoneMap
}

var aucklandTransfers = transferRule{window: 30 * time.Minute, maxRides: 5, span: 4 * time.Hour}

func (a auckland) Estimate(plan gtfs.JourneyPlan, c Concession) (Estimate, bool) {
	applied := c
	if !offers("at", c) {
		applied = Adult // secondary students are on the child fare; there's no 19-24 one
	}
	groups, partial := group(plan, aucklandTransfers, func(leg gtfs.JourneyLeg) bool {
		t := routeType(leg)
		return isBus(t) || t == routeRail
	})
	var parts []Part
	for _, g := range groups {
		citylink := true
		var stops [][]string
		for _, i := range g {
			leg := plan.Legs[i]
			if leg.Route == nil || !strings.EqualFold(leg.Route.RouteShortName, "CTY") {
				citylink = false
			}
			for _, s := range legStops(a.deps, leg) {
				stops = append(stops, a.zones.zonesAt(s.StopLat, s.StopLon))
			}
		}
		depart := inTZ(plan.Legs[g[0]].DepartureTime, a.deps.TZ)
		if citylink {
			cents := aucklandFare(applied, 0, true, depart)
			parts = append(parts, Part{Legs: g, Cents: cents, Label: money(cents), Detail: "City Link"})
			continue
		}
		n, ok := a.zones.countZones(stops)
		if !ok {
			partial = true
			continue
		}
		cents := aucklandFare(applied, n, false, depart)
		parts = append(parts, Part{Legs: g, Cents: cents, Label: money(cents), Detail: pluralZones(n)})
	}
	card, note := "AT HOP or contactless", "Adult fare. Contactless is capped at $20 a day, AT HOP at $50 a week."
	if applied != Adult {
		card, note = "Registered AT HOP card", fareNote(c, applied)+" Not available on contactless."
		if applied == Child {
			note += " Children travel free at weekends."
		}
		if applied == SuperGold {
			note = "SuperGold: free after 9am on weekdays and all weekend, otherwise the adult fare."
		}
	} else if c != Adult {
		note = fareNote(c, applied) + " " + note
	}
	return build(parts, partial, "NZD", card, note, applied)
}

// Child, secondary, tertiary and accessible concessions share AT's child
// fare table; Community Connect is half the adult fare.
var aucklandChildCents = [...]int{0, 155, 290, 390, 475}

const aucklandCitylinkChildCents = 50

// aucklandFare is one fare for n zones (or City Link), boarding at depart.
func aucklandFare(c Concession, n int, citylink bool, depart time.Time) int {
	adult := aucklandCitylinkCents
	if !citylink {
		adult = aucklandZoneCents[min(n, 4)]
	}
	switch c {
	case Child:
		if weekend(depart) {
			return 0
		}
		fallthrough
	case Tertiary, Accessible:
		if citylink {
			return aucklandCitylinkChildCents
		}
		return aucklandChildCents[min(n, 4)]
	case Community:
		return halfCents(adult)
	case SuperGold:
		if weekend(depart) || depart.Hour() >= 9 {
			return 0
		}
	}
	return adult
}

func pluralZones(n int) string {
	if n == 1 {
		return "1 zone"
	}
	return fmt.Sprintf("%d zones", n)
}
