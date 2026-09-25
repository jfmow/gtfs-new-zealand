package notifications

import (
	"fmt"
	"sort"
	"strings"
)

// travelModeRouteTypes maps the planner's rider-facing modes to the GTFS
// route_type values (basic and extended) each one covers. "train" is anything
// on rails - light rail, trams and cable cars included - so choosing it never
// hides a rail line a rider would call "the train".
var travelModeRouteTypes = map[string][]int{
	"bus":   {3, 11, 700, 702, 704, 711, 712, 715},
	"train": {0, 1, 2, 5, 7, 12, 100, 101, 102, 106, 109, 400, 401, 900},
	"ferry": {4, 1000, 1200},
}

// ParseTravelModes turns a comma-separated mode list ("bus,train") into the
// GTFS route types to plan with. Empty means any mode (nil). An unknown mode
// is an error rather than silently widening the search.
func ParseTravelModes(raw string) ([]int, error) {
	seen := map[int]bool{}
	for _, part := range strings.Split(raw, ",") {
		mode := strings.ToLower(strings.TrimSpace(part))
		if mode == "" {
			continue
		}
		types, ok := travelModeRouteTypes[mode]
		if !ok {
			return nil, fmt.Errorf("unknown travel mode %q", mode)
		}
		for _, t := range types {
			seen[t] = true
		}
	}
	if len(seen) == 0 {
		return nil, nil
	}
	out := make([]int, 0, len(seen))
	for t := range seen {
		out = append(out, t)
	}
	sort.Ints(out)
	return out, nil
}

// ClampMinTransferSec bounds the "extra time at each change" option.
func ClampMinTransferSec(v int) int {
	if v < 0 {
		return 0
	}
	if v > 600 {
		return 600
	}
	return v
}
