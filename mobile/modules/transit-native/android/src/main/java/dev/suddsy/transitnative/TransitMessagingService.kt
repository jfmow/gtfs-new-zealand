package dev.suddsy.transitnative

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Receives every FCM message ahead of expo-notifications (its service is
 * registered at priority -1, this one at 0 - see the module's manifest).
 * Live-update pushes from the server's Live Activity crons are drawn here;
 * everything else - alerts, reminders, token refreshes - goes on to Expo
 * unchanged.
 */
class TransitMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    if (LiveNotifications.onPush(applicationContext, remoteMessage.data)) return
    super.onMessageReceived(remoteMessage)
  }
}
