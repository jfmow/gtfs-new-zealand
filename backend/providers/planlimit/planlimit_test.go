package planlimit

import (
	"context"
	"testing"
	"time"
)

// A waiting background job gets the next free slot ahead of user requests.
func TestBackgroundHasPriority(t *testing.T) {
	// Fill both slots with user work.
	for i := 0; i < slots; i++ {
		if !Acquire(context.Background()) {
			t.Fatal("initial Acquire failed")
		}
	}

	bgGot := make(chan struct{})
	go func() {
		AcquireBackground()
		close(bgGot)
	}()
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return bgWaiting == 1 })

	// A user request arriving while the job waits must not jump the queue.
	userCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	userGot := make(chan bool, 1)
	go func() { userGot <- Acquire(userCtx) }()

	Release() // one user plan finishes
	select {
	case <-bgGot:
	case <-time.After(time.Second):
		t.Fatal("background job did not get the freed slot")
	}
	select {
	case <-userGot:
		t.Fatal("user request took a slot while both were in use")
	case <-time.After(100 * time.Millisecond):
	}

	Release() // the other user plan finishes - now the user request proceeds
	if !<-userGot {
		t.Fatal("user request never got a slot")
	}
	Release() // user
	Release() // background
	if inUse != 0 {
		t.Fatalf("inUse = %d after releasing everything", inUse)
	}
}

func TestAcquireHonoursContext(t *testing.T) {
	for i := 0; i < slots; i++ {
		Acquire(context.Background())
	}
	defer func() {
		for i := 0; i < slots; i++ {
			Release()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if Acquire(ctx) {
		t.Fatal("Acquire succeeded with no free slot")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
