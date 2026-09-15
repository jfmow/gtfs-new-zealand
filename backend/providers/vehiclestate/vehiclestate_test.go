package vehiclestate

import (
	"testing"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime/proto"
)

func ptrU32(v uint32) *uint32 { return &v }
func ptrStatus(v proto.VehiclePosition_VehicleStopStatus) *proto.VehiclePosition_VehicleStopStatus {
	return &v
}

// Four stops in a row, 200m apart along the equator so IsNearStop's 100m
// radius cleanly distinguishes which one the vehicle is next to.
func testStops() []gtfs.Stop {
	return []gtfs.Stop{
		{StopId: "A", StopLat: 0, StopLon: 0},
		{StopId: "B", StopLat: 0, StopLon: 0.0018},
		{StopId: "C", StopLat: 0, StopLon: 0.0036},
		{StopId: "D", StopLat: 0, StopLon: 0.0054},
	}
}

func TestStateFromCurrentStatus_DepartureDoesNotRegressNextStop(t *testing.T) {
	stops := testStops()
	lowestSequence := 5 // stop A=5, B=6, C=7, D=8

	// Stopped at B (seq 6): next stop should be C, local idx 2.
	stoppedAtB := &proto.VehiclePosition{
		CurrentStopSequence: ptrU32(6),
		CurrentStatus:       ptrStatus(proto.VehiclePosition_STOPPED_AT),
	}
	idx, state, ok := stateFromCurrentStatus(stoppedAtB, lowestSequence, stops, stops[1].StopLat, stops[1].StopLon)
	if !ok || state != "AtStop" || idx != 2 {
		t.Fatalf("STOPPED_AT at B: got idx=%d state=%q ok=%v, want idx=2 state=AtStop", idx, state, ok)
	}

	// Vehicle departs B: status flips to IN_TRANSIT_TO, but AT's feed is a
	// beat behind and CurrentStopSequence is still 6 (B), while the live
	// position is still parked at B's coordinates. The reported "next stop"
	// must not regress behind the AtStop value above (idx=2, i.e. C).
	leavingBStaleSeq := &proto.VehiclePosition{
		CurrentStopSequence: ptrU32(6),
		CurrentStatus:       ptrStatus(proto.VehiclePosition_IN_TRANSIT_TO),
	}
	idx, state, ok = stateFromCurrentStatus(leavingBStaleSeq, lowestSequence, stops, stops[1].StopLat, stops[1].StopLon)
	if !ok || state != "Leaving" || idx != 2 {
		t.Fatalf("IN_TRANSIT_TO with stale sequence near B: got idx=%d state=%q ok=%v, want idx=2 state=Leaving (must not regress from AtStop's idx=2)", idx, state, ok)
	}

	// Once AT's feed catches up and bumps CurrentStopSequence to 7 (C),
	// still near B's old position: unchanged pre-existing "Leaving" case.
	leavingBFreshSeq := &proto.VehiclePosition{
		CurrentStopSequence: ptrU32(7),
		CurrentStatus:       ptrStatus(proto.VehiclePosition_IN_TRANSIT_TO),
	}
	idx, state, ok = stateFromCurrentStatus(leavingBFreshSeq, lowestSequence, stops, stops[1].StopLat, stops[1].StopLon)
	if !ok || state != "Leaving" || idx != 2 {
		t.Fatalf("IN_TRANSIT_TO with fresh sequence near B: got idx=%d state=%q ok=%v, want idx=2 state=Leaving", idx, state, ok)
	}

	// Genuinely mid-route between B and C, far from every stop: normal
	// "Travelling" case, unaffected by the fix.
	midpoint := &proto.VehiclePosition{
		CurrentStopSequence: ptrU32(7),
		CurrentStatus:       ptrStatus(proto.VehiclePosition_IN_TRANSIT_TO),
	}
	midLat, midLon := 0.0, 0.0027
	idx, state, ok = stateFromCurrentStatus(midpoint, lowestSequence, stops, midLat, midLon)
	if !ok || state != "Travelling" || idx != 2 {
		t.Fatalf("IN_TRANSIT_TO mid-route: got idx=%d state=%q ok=%v, want idx=2 state=Travelling", idx, state, ok)
	}
}
