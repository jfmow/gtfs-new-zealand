package notifications

import (
	"errors"
	"testing"
)

// fakeNotifier is a test double for Notifier - records the last client/payload
// it was asked to send, so platformNotifier's dispatch can be checked without
// touching a real web push endpoint or APNs.
type fakeNotifier struct {
	lastClient  NotificationClient
	lastPayload Payload
	calls       int
	err         error
}

func (f *fakeNotifier) Send(client NotificationClient, p Payload) error {
	f.calls++
	f.lastClient = client
	f.lastPayload = p
	return f.err
}

func TestPlatformNotifier_DispatchesByClientPlatform(t *testing.T) {
	web := &fakeNotifier{}
	ios := &fakeNotifier{}
	notifier := platformNotifier{byPlatform: map[string]Notifier{"web": web, "ios": ios}}

	webClient := NotificationClient{Id: 1, Platform: "web"}
	iosClient := NotificationClient{Id: 2, Platform: "ios"}
	payload := Payload{Title: "t", Body: "b", URL: "/plan", Urgency: "high"}

	if err := notifier.Send(webClient, payload); err != nil {
		t.Fatalf("send to web client: %v", err)
	}
	if web.calls != 1 || ios.calls != 0 {
		t.Fatalf("web.calls=%d ios.calls=%d, want 1/0", web.calls, ios.calls)
	}
	if web.lastClient.Id != 1 || web.lastPayload.Title != "t" {
		t.Errorf("web notifier got the wrong client/payload: %+v %+v", web.lastClient, web.lastPayload)
	}

	if err := notifier.Send(iosClient, payload); err != nil {
		t.Fatalf("send to ios client: %v", err)
	}
	if ios.calls != 1 {
		t.Fatalf("ios.calls=%d, want 1", ios.calls)
	}
	if ios.lastClient.Id != 2 {
		t.Errorf("ios notifier got the wrong client: %+v", ios.lastClient)
	}
}

func TestPlatformNotifier_EmptyPlatformDefaultsToWeb(t *testing.T) {
	web := &fakeNotifier{}
	notifier := platformNotifier{byPlatform: map[string]Notifier{"web": web}}

	// A client scanned before Platform existed (or any zero-value struct)
	// must still be treated as a web push subscriber.
	legacyClient := NotificationClient{Id: 3}
	if err := notifier.Send(legacyClient, Payload{}); err != nil {
		t.Fatalf("send: %v", err)
	}
	if web.calls != 1 {
		t.Fatalf("web.calls=%d, want 1", web.calls)
	}
}

func TestPlatformNotifier_UnconfiguredChannelErrorsInsteadOfPanicking(t *testing.T) {
	notifier := platformNotifier{byPlatform: map[string]Notifier{"web": &fakeNotifier{}}}

	err := notifier.Send(NotificationClient{Platform: "ios"}, Payload{})
	if err == nil {
		t.Fatal("expected an error for an unconfigured ios channel, got nil")
	}
}

func TestPlatformNotifier_PropagatesSendError(t *testing.T) {
	boom := errors.New("boom")
	notifier := platformNotifier{byPlatform: map[string]Notifier{"web": &fakeNotifier{err: boom}}}

	if err := notifier.Send(NotificationClient{Platform: "web"}, Payload{}); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want %v", err, boom)
	}
}
