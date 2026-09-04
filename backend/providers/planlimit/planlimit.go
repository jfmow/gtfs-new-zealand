// Package planlimit bounds how many journey-plan (RAPTOR) computations run at
// once across the whole process. Each run transiently allocates ~100-200 MB
// (the day's stop-times + stop map), so a handful of simultaneous ones - user
// /services/plan requests plus the per-region journey-reminder resolve crons -
// can OOM a memory-constrained host.
package planlimit

import "context"

var sem = make(chan struct{}, 2)

// Acquire blocks until a slot is free or ctx is done. Returns true if a slot was
// taken (caller must Release), false if ctx was cancelled first.
func Acquire(ctx context.Context) bool {
	select {
	case sem <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

// Release returns a slot taken by Acquire.
func Release() { <-sem }
