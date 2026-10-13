package providers

import (
	"reflect"
	"testing"
)

func TestTrimStopTimes(t *testing.T) {
	stop := func(child, parent string) tripStopTime { return tripStopTime{ChildStopId: child, ParentStopId: parent} }
	ids := func(times []tripStopTime) []string {
		out := []string{}
		for _, t := range times {
			out = append(out, t.ChildStopId)
		}
		return out
	}
	trip := []tripStopTime{stop("a", "a"), stop("b1", "B"), stop("c", "c"), stop("d", "d"), stop("e", "e")}

	cases := []struct {
		name, from, to string
		want           []string
	}{
		{"both ends", "b1", "d", []string{"b1", "c", "d"}},
		{"by parent id", "B", "d", []string{"b1", "c", "d"}},
		{"no from", "", "c", []string{"a", "b1", "c"}},
		{"no to", "c", "", []string{"c", "d", "e"}},
		{"unknown ends", "x", "y", []string{"a", "b1", "c", "d", "e"}},
		{"to before from", "d", "b1", []string{"d", "e"}},
	}
	for _, tc := range cases {
		if got := ids(trimStopTimes(trip, tc.from, tc.to)); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}

	// A loop: first visit of the boarding stop, last of the alighting one.
	loop := []tripStopTime{stop("a", "a"), stop("b", "b"), stop("c", "c"), stop("a", "a"), stop("b", "b"), stop("d", "d")}
	if got := ids(trimStopTimes(loop, "b", "b")); !reflect.DeepEqual(got, []string{"b", "c", "a", "b"}) {
		t.Errorf("loop: got %v", got)
	}
}
