package dev.suddsy.transitnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * The native side of the Expo app on Android: the ongoing "live journey"
 * notification (Android's stand-in for the iOS Live Activity), rendered from
 * the same content JSON (packages/shared/src/logic/live-content.ts), and a
 * shared store for a home-screen widget.
 */
class TransitNativeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")

  override fun definition() = ModuleDefinition {
    Name("TransitNative")
    Events("onActivityPushToken", "onPushToStartToken", "onActivityStarted", "onActivityEnded")

    Function("setSharedString") { key: String, value: String? ->
      prefs().edit().putString(key, value).apply()
    }
    Function("setSharedJSON") { key: String, json: String ->
      prefs().edit().putString(key, json).apply()
    }
    Function("reloadWidgets") { }

    Function("liveActivitiesEnabled") { false }
    Function("activeActivities") { emptyList<Map<String, String>>() }

    Function("showLiveNotification") { contentJSON: String, planId: String, alert: Boolean ->
      showLive(JSONObject(contentJSON), planId, alert)
    }
    Function("cancelLiveNotification") {
      NotificationManagerCompat.from(context).cancel(LIVE_ID)
    }
  }

  private fun prefs() = context.getSharedPreferences("transit_shared", Context.MODE_PRIVATE)

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    // Low importance: the card updates every few seconds and must not buzz.
    // Moments that need attention go on the "journey" channel instead.
    val channel = NotificationChannel(CHANNEL, "Live journey", NotificationManager.IMPORTANCE_LOW)
    channel.description = "Your journey's progress while you travel"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun showLive(c: JSONObject, planId: String, alert: Boolean) {
    ensureChannel()
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("https://trains.suddsy.dev/journey?id=" + Uri.encode(planId) + "&track=1")).setPackage(context.packageName)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val target = (c.optDouble("targetUnix", 0.0) * 1000).toLong()
    val progress = (c.optDouble("progressFraction", 0.0) * 100).toInt().coerceIn(0, 100)
    val route = c.optString("routeShortName", "")
    val title = c.optString("primaryText", "Your journey")
    val status = c.optString("status", "onTime")
    val builder = NotificationCompat.Builder(context, if (alert) "journey" else CHANNEL)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(if (route.isNotEmpty()) "$route · $title" else title)
      .setContentText(c.optString("secondaryText", ""))
      .setStyle(NotificationCompat.BigTextStyle().bigText(c.optString("secondaryText", "")))
      .setOngoing(status != "arrived")
      .setOnlyAlertOnce(!alert)
      .setSilent(!alert)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setContentIntent(tap)
      .setProgress(100, progress, false)
      .setColorized(true)
      .setColor(0xFF173A2A.toInt())
    if (target > System.currentTimeMillis()) {
      builder.setWhen(target).setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true)
    }
    try {
      NotificationManagerCompat.from(context).notify(LIVE_ID, builder.build())
    } catch (e: SecurityException) {
      // Notifications not allowed - nothing to show.
    }
  }

  companion object {
    private const val CHANNEL = "journey_live"
    private const val LIVE_ID = 4201
  }
}
