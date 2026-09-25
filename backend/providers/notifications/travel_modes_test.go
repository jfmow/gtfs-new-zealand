package notifications

import (
	"slices"
	"testing"
)

func TestParseTravelModes(t *testing.T) {
	if got, err := ParseTravelModes(""); err != nil || got != nil {
		t.Fatalf("empty should mean any mode, got %v %v", got, err)
	}
	got, err := ParseTravelModes(" Train, ferry ,")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, 2) || !slices.Contains(got, 4) || slices.Contains(got, 3) {
		t.Fatalf("expected train and ferry types only, got %v", got)
	}
	if _, err := ParseTravelModes("bus,hovercraft"); err == nil {
		t.Fatal("expected an unknown mode to be rejected")
	}
}
