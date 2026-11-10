package notifications

import (
	"errors"
	"time"
)

// fcmActivityEnv marks a live_activities / trip_live_activities row as an
// Android one: the "activity" is the app's ongoing live notification, and it
// is pushed to with the device's current FCM token (read through the
// notifications row - see liveActivityTokenColumn) as a data message the app
// draws itself. Everything else about the row - the cron, the state, the
// client-active window, the alerts - is shared with iOS.
const fcmActivityEnv = "fcm"

// Activity kinds, as the Android app's TransitMessagingService reads them.
const (
	activityKindJourney = "journey"
	activityKindTrip    = "trip"
)

// liveActivityTokenColumn is the push token an activity row is sent with:
// its own (an iOS Live Activity token), or for an Android row, the device's
// FCM token - so a rotated FCM token is picked up without the app
// re-registering every activity. `alias` is the activity table's.
func liveActivityTokenColumn(alias string) string {
	return `CASE WHEN ` + alias + `.apns_env = '` + fcmActivityEnv + `' THEN COALESCE(n.fcm_token, '') ELSE ` + alias + `.push_token END`
}

// activityEnvFor is the env stored on a newly registered activity: Android
// devices are always FCM; iOS ones take the app's APNs environment, falling
// back to the device's.
func activityEnvFor(client *NotificationClient, requested string) string {
	if client.Platform == "android" {
		return fcmActivityEnv
	}
	if requested == "sandbox" || requested == "production" {
		return requested
	}
	return client.ApnsEnv
}

// activityPushConfigured: there's something to push Live Activities with.
func activityPushConfigured() bool {
	return sharedAPNsSender() != nil || sharedFCMSender() != nil
}

func sharedFCMSender() *fcmSender {
	sharedNotifier() // ensures the Once has run
	return sharedFCMVal
}

var errActivityPushUnconfigured = errors.New("no push service configured for this activity")

// sendActivityUpdate pushes an activity's state - an APNs Live Activity
// update on iOS, an FCM live-update data message on Android. staleDate is
// iOS only (an Android notification never goes stale - the next push or the
// app replaces it); dismissalDate ends the activity on both.
func sendActivityUpdate(kind, activityID, pushToken, env string, state any, alert *activityAlert, staleDate, dismissalDate *time.Time) error {
	if env == fcmActivityEnv {
		fcm := sharedFCMSender()
		if fcm == nil {
			return errActivityPushUnconfigured
		}
		return fcm.SendLiveUpdate(pushToken, kind, activityID, state, alert, dismissalDate)
	}
	apns := sharedAPNsSender()
	if apns == nil {
		return errActivityPushUnconfigured
	}
	return apns.SendLiveActivityUpdate(pushToken, env, state, alert, staleDate, dismissalDate)
}
