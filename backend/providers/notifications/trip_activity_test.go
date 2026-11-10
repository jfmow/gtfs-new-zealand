package notifications

import (
	"testing"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/jfmow/gtfs/realtime/proto"
	protobuf "google.golang.org/protobuf/proto"
)

func tripStops() []gtfs.Stop {
	return []gtfs.Stop{
		{StopId: "a", StopName: "Alpha", Sequence: 1},
		{StopId: "b", StopName: "Bravo", Sequence: 2},
		{StopId: "c1", ParentStation: "c", StopName: "Charlie 1", Sequence: 3},
		{StopId: "d", StopName: "Delta", Sequence: 4},
	}
}

func TestTripActivity_NoFeedIsTimetable(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a := TripLiveActivity{TripId: "t", StopId: "c", Scheduled: now.Add(10 * time.Minute).Unix(), Created: now.Unix()}
	s := computeTripActivityState(a, now, nil, nil, tripStops(), 1, nil, time.UTC)
	if s.Phase != "coming" || s.IsRealtime || s.HasVehicle || s.StopsAway != nil {
		t.Fatalf("got %+v, want a timetable 'coming' state", s)
	}
	if int64(s.TargetUnix) != a.Scheduled {
		t.Errorf("target = %v, want the scheduled time", s.TargetUnix)
	}
}

func TestTripActivity_DelayAtYourStopMovesTarget(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a := TripLiveActivity{TripId: "t", StopId: "c", StopSeq: 3, Scheduled: now.Add(10 * time.Minute).Unix(), Created: now.Unix()}
	tu := &proto.TripUpdate{
		Trip: &proto.TripDescriptor{TripId: protobuf.String("t")},
		StopTimeUpdate: []*proto.TripUpdate_StopTimeUpdate{
			{StopSequence: protobuf.Uint32(3), Arrival: &proto.TripUpdate_StopTimeEvent{Delay: protobuf.Int32(120)}},
		},
	}
	s := computeTripActivityState(a, now, tu, nil, tripStops(), 1, nil, time.UTC)
	if !s.IsRealtime || s.DelayMinutes != 2 {
		t.Fatalf("got %+v, want realtime with a 2 min delay", s)
	}
	if int64(s.TargetUnix) != a.Scheduled+120 {
		t.Errorf("target = %v, want scheduled + 120 s", s.TargetUnix)
	}
}

func TestTripActivity_Cancelled(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a := TripLiveActivity{TripId: "t", StopId: "c", Scheduled: now.Add(10 * time.Minute).Unix(), Created: now.Unix()}
	cancelled := proto.TripDescriptor_CANCELED
	tu := &proto.TripUpdate{Trip: &proto.TripDescriptor{TripId: protobuf.String("t"), ScheduleRelationship: &cancelled}}
	s := computeTripActivityState(a, now, tu, nil, tripStops(), 1, nil, time.UTC)
	if s.Phase != "cancelled" {
		t.Fatalf("phase = %q, want cancelled", s.Phase)
	}
	if tripActivityDone(a, s, now) {
		t.Error("a cancelled trip's activity should stay up until it was due, so the rider sees it")
	}
	if !tripActivityDone(a, s, now.Add(11*time.Minute)) {
		t.Error("a cancelled trip's activity should end once it was due")
	}
}

func TestTripActivity_TargetIndexPrefersSequenceThenStation(t *testing.T) {
	stops := tripStops()
	if i := targetIndex(stops, TripLiveActivity{StopId: "c"}); i != 2 {
		t.Errorf("by parent station: %d, want 2", i)
	}
	if i := targetIndex(stops, TripLiveActivity{StopId: "zzz", StopSeq: 4}); i != 3 {
		t.Errorf("by sequence: %d, want 3", i)
	}
	if i := targetIndex(stops, TripLiveActivity{StopId: "zzz"}); i != -1 {
		t.Errorf("missing stop: %d, want -1", i)
	}
}

func TestTripActivity_DoneWhenGoneOrLongPastDue(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	a := TripLiveActivity{Created: now.Unix()}
	if !tripActivityDone(a, tripActivityState{Phase: "gone"}, now) {
		t.Error("gone should end it")
	}
	due := tripActivityState{Phase: "coming", TargetUnix: float64(now.Unix())}
	if tripActivityDone(a, due, now.Add(5*time.Minute)) {
		t.Error("5 min late with no vehicle is still worth showing")
	}
	if !tripActivityDone(a, due, now.Add(11*time.Minute)) {
		t.Error("over 10 min past due with no vehicle should end it")
	}
	withVehicle := tripActivityState{Phase: "next", TargetUnix: float64(now.Unix()), HasVehicle: true}
	if tripActivityDone(a, withVehicle, now.Add(30*time.Minute)) {
		t.Error("a placed vehicle that hasn't reached the stop keeps it running")
	}
	if !tripActivityDone(a, withVehicle, now.Add(5*time.Hour)) {
		t.Error("the age cap should end it")
	}
}

func TestTripActivity_HashIgnoresSmallCountdownWobble(t *testing.T) {
	base := tripActivityState{Version: 1, Phase: "coming", TargetUnix: 1_800_000_010, UpdatedUnix: 1}
	wobble := base
	wobble.TargetUnix += 5
	wobble.UpdatedUnix = 99
	if base.hash() != wobble.hash() {
		t.Error("a 5 s wobble and a new updatedUnix shouldn't change the hash")
	}
	moved := base
	moved.Phase = "next"
	if base.hash() == moved.hash() {
		t.Error("a phase change must change the hash")
	}
}

func TestTripActivity_StoreOnePerDevice(t *testing.T) {
	db := newTestDatabase(t)
	client, err := db.RegisterIOSDevice("22222222-2222-2222-2222-222222222222", "secret-secret-secret", "", "sandbox", "")
	if err != nil {
		t.Fatalf("RegisterIOSDevice: %v", err)
	}
	first := TripLiveActivity{ClientId: client.Id, Region: "at", TripId: "t1", StopId: "s", Kind: "arrival", ActivityId: "act-1", PushToken: "tok1", ApnsEnv: "sandbox"}
	if err := db.CreateTripLiveActivity(first); err != nil {
		t.Fatalf("create: %v", err)
	}
	second := first
	second.TripId, second.ActivityId, second.PushToken = "t2", "act-2", "tok2"
	if err := db.CreateTripLiveActivity(second); err != nil {
		t.Fatalf("create second: %v", err)
	}
	all, err := db.TripLiveActivitiesForRegion("at")
	if err != nil || len(all) != 1 || all[0].ActivityId != "act-2" {
		t.Fatalf("got %+v (%v), want only act-2", all, err)
	}
	if _, ok := db.TripLiveActivityFor(client.Id, "t1"); ok {
		t.Error("the replaced activity's trip shouldn't be found")
	}
	got, ok := db.TripLiveActivityFor(client.Id, "t2")
	if !ok || got.PushToken != "tok2" || got.ApnsEnv != "sandbox" {
		t.Fatalf("lookup = %+v %v", got, ok)
	}
	if err := db.DeleteTripLiveActivity(client.Id, "act-2"); err != nil {
		t.Fatal(err)
	}
	if _, ok := db.TripLiveActivityFor(client.Id, "t2"); ok {
		t.Error("deleted activity still found")
	}
}
