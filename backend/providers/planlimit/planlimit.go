// Package planlimit bounds how many journey-plan (RAPTOR) computations run at
// once across the whole process. Each run transiently allocates ~100-200 MB
// (the day's stop-times + stop map), so a handful of simultaneous ones - user
// /services/plan requests plus the per-region journey-reminder resolve crons -
// can OOM a memory-constrained host.
//
// Background work (reminder resolve/reroute, next-journey) has priority: while
// a background caller is waiting, user requests don't take a freed slot, so a
// stream of anonymous plan requests can't delay other riders' leave-by
// reminders indefinitely.
package planlimit

import (
	"context"
	"sync"
)

const slots = 2

var (
	mu        sync.Mutex
	inUse     int
	bgWaiting int
	// changed is closed (and replaced) whenever a slot frees or the set of
	// waiting background callers shrinks, waking everyone to re-check.
	changed = make(chan struct{})
)

// notifyLocked wakes all waiters. Caller holds mu.
func notifyLocked() {
	close(changed)
	changed = make(chan struct{})
}

// Acquire blocks until a slot is free (and no background caller is waiting
// for it) or ctx is done. Returns true if a slot was taken (caller must
// Release), false if ctx was cancelled first. Use for user requests.
func Acquire(ctx context.Context) bool {
	for {
		mu.Lock()
		if inUse < slots && bgWaiting == 0 {
			inUse++
			mu.Unlock()
			return true
		}
		ch := changed
		mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return false
		}
	}
}

// AcquireBackground blocks until a slot is free, ahead of any waiting user
// requests. Caller must Release.
func AcquireBackground() {
	mu.Lock()
	bgWaiting++
	for inUse >= slots {
		ch := changed
		mu.Unlock()
		<-ch
		mu.Lock()
	}
	inUse++
	bgWaiting--
	notifyLocked()
	mu.Unlock()
}

// Release returns a slot taken by Acquire or AcquireBackground.
func Release() {
	mu.Lock()
	inUse--
	notifyLocked()
	mu.Unlock()
}
