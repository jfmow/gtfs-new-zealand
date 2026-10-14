package providers

import (
	"testing"
	"time"

	rt "github.com/jfmow/gtfs/realtime"
	"github.com/jfmow/gtfs/realtime/proto"
)

func trainUnit(id, label string, speed float32, age time.Duration, now time.Time) *proto.VehiclePosition {
	ts := uint64(now.Add(-age).Unix())
	lat, lon := float32(-36.84), float32(174.76)
	return &proto.VehiclePosition{
		Vehicle:   &proto.VehicleDescriptor{Id: &id, Label: &label},
		Position:  &proto.Position{Latitude: &lat, Longitude: &lon, Speed: &speed},
		Timestamp: &ts,
	}
}

func TestCountUntrackedTrains(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	trailID := "trail"
	untripped := []*proto.VehiclePosition{
		trainUnit("moving", "AMP        415", 12, 10*time.Second, now),   // counts
		trainUnit("moving2", "AMP        565", 2.2, 30*time.Second, now), // counts
		trainUnit("stabled", "AMP        198", 0, 10*time.Second, now),   // not moving
		trainUnit("stale", "AMP        701", 12, 5*time.Minute, now),     // old reading
		trainUnit(trailID, "AMP        578", 12, 10*time.Second, now),    // trailing half
		trainUnit("bus", "NZ Bus 1234", 12, 10*time.Second, now),         // not a train
	}
	consists := rt.Consists{"t1": {{Id: strPtr("lead")}, {Id: &trailID}}}

	if got := countUntrackedTrains(untripped, consists, now); got != 2 {
		t.Fatalf("countUntrackedTrains = %d, want 2", got)
	}
}

func strPtr(s string) *string { return &s }
