package providers

import (
	"testing"
	"time"

	"github.com/jfmow/gtfs/realtime/proto"
	gproto "google.golang.org/protobuf/proto"
)

func TestCurrentDelay(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	ev := func(at int64, delay int32) *proto.TripUpdate_StopTimeEvent {
		return &proto.TripUpdate_StopTimeEvent{Time: gproto.Int64(at), Delay: gproto.Int32(delay)}
	}
	tu := &proto.TripUpdate{StopTimeUpdate: []*proto.TripUpdate_StopTimeUpdate{
		{StopSequence: gproto.Uint32(3), Departure: ev(now.Unix()-120, 180)},
		{StopSequence: gproto.Uint32(4), Departure: ev(now.Unix()-30, 240)},
		{StopSequence: gproto.Uint32(5), Arrival: ev(now.Unix()+60, 300)},
	}}
	if d, ok := currentDelay(tu, now); !ok || d != 240 {
		t.Errorf("furthest passed stop: %d ok=%t", d, ok)
	}
	future := &proto.TripUpdate{StopTimeUpdate: []*proto.TripUpdate_StopTimeUpdate{{Arrival: ev(now.Unix()+60, -90)}}}
	if d, ok := currentDelay(future, now); !ok || d != -90 {
		t.Errorf("next prediction: %d ok=%t", d, ok)
	}
	if _, ok := currentDelay(&proto.TripUpdate{}, now); ok {
		t.Error("nothing to go on")
	}
}

func TestSummariseNetwork(t *testing.T) {
	d := func(s int) *int { return &s }
	r70 := VehiclesRoute{RouteId: "70", RouteShortName: "70"}
	nx1 := VehiclesRoute{RouteId: "NX1", RouteShortName: "NX1"}
	s := summariseNetwork([]VehiclesResponse{
		{Route: r70, DelaySeconds: d(600)}, {Route: r70, DelaySeconds: d(480)},
		{Route: nx1, DelaySeconds: d(0)}, {Route: nx1, DelaySeconds: d(-200)},
		{Route: nx1},
	})
	if s.Vehicles != 5 || s.Measured != 4 || s.OnTimePct != 25 || s.LatePct != 50 || s.EarlyPct != 25 {
		t.Errorf("summary = %+v", s)
	}
	if len(s.LatestRoutes) != 1 || s.LatestRoutes[0].Name != "70" || s.LatestRoutes[0].AverageMin != 9 {
		t.Errorf("latest = %+v", s.LatestRoutes)
	}
}
