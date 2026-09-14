package providers

import (
	"math"
	"testing"

	"github.com/paulmach/orb"
)

func TestCumulativeLineDistances(t *testing.T) {
	line := orb.LineString{
		{0, 0},
		{0, 1},
		{0, 2},
	}
	cum := cumulativeLineDistances(line)
	if len(cum) != 3 {
		t.Fatalf("expected 3 cumulative distances, got %d", len(cum))
	}
	if cum[0] != 0 {
		t.Fatalf("expected first cumulative distance 0, got %v", cum[0])
	}
	if cum[2] <= cum[1] || cum[1] <= cum[0] {
		t.Fatalf("expected strictly increasing cumulative distances, got %v", cum)
	}
	// Equal-length segments (1 degree of latitude each) should give cum[2] ~= 2*cum[1].
	if math.Abs(cum[2]-2*cum[1]) > 1 {
		t.Fatalf("expected cum[2] ~= 2*cum[1], got cum[1]=%v cum[2]=%v", cum[1], cum[2])
	}
}

// TestNearestPointOnLineStringUsesPrecomputedCumDist guards the refactor that
// made nearestPointOnLineString take a precomputed cumDist array instead of
// re-summing a distance-to-segment-start prefix on every improving
// candidate - that re-sum was what made a shape with many points quadratic.
func TestNearestPointOnLineStringUsesPrecomputedCumDist(t *testing.T) {
	line := orb.LineString{
		{0, 0},
		{0, 1},
		{0, 2},
		{0, 3},
	}
	cum := cumulativeLineDistances(line)

	// A point exactly at line[2] should project with distAlong == cum[2].
	_, segIdx, distAlong := nearestPointOnLineString(line, cum, line[2])
	if math.Abs(distAlong-cum[2]) > 1e-6 {
		t.Fatalf("expected distAlong %v at line[2], got %v (segment %d)", cum[2], distAlong, segIdx)
	}
}

func TestComputeShapeDistanceOrderingReflectsProgress(t *testing.T) {
	line := orb.LineString{
		{0, 0},
		{0, 1},
		{0, 2},
		{0, 3},
	}
	cum := cumulativeLineDistances(line)

	near, err := computeShapeDistance(line, cum, orb.Point{0, 0.5})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	far, err := computeShapeDistance(line, cum, orb.Point{0, 2.5})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if far <= near {
		t.Fatalf("expected a point further along the shape to have a larger distance-along value: near=%v far=%v", near, far)
	}
}

// BenchmarkNearestPointOnLineStringLongShape stands in for a detailed
// real-world trip shape (a rail line can easily have several thousand shape
// points). It should scale linearly with shape length - the previous
// implementation's O(n) prefix re-sum on every improving candidate made this
// effectively O(n^2), which is what made /stop-times slow well into a long
// trip's shape.
func BenchmarkNearestPointOnLineStringLongShape(b *testing.B) {
	const n = 5000
	line := make(orb.LineString, n)
	for i := 0; i < n; i++ {
		line[i] = orb.Point{0, float64(i) * 0.001}
	}
	cum := cumulativeLineDistances(line)
	target := orb.Point{0.0005, float64(n-1) * 0.001} // near the far end of the shape

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		nearestPointOnLineString(line, cum, target)
	}
}
