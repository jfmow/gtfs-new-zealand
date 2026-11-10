package dev.suddsy.transitnative

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * The native side of the Expo app on Android: the journey and trip live
 * updates (Android's Live Activities - see LiveNotifications), behind the
 * same calls as the iOS module, and a shared store for a home-screen widget.
 */
class TransitNativeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")

  override fun definition() = ModuleDefinition {
    Name("TransitNative")
    Events("onActivityPushToken", "onPushToStartToken", "onActivityStarted", "onActivityEnded", "onTripActivityPushToken", "onTripActivityEnded")

    Function("setSharedString") { key: String, value: String? ->
      prefs().edit().putString(key, value).apply()
    }
    Function("setSharedJSON") { key: String, json: String ->
      prefs().edit().putString(key, json).apply()
    }
    Function("reloadWidgets") { }

    Function("liveActivitiesEnabled") { NotificationManagerCompat.from(context).areNotificationsEnabled() }

    // ─── journey ───
    Function("activeActivities") { LiveNotifications.activeJourneys(context) }
    AsyncFunction("startActivity") { planId: String, destinationLabel: String, regionSlug: String, contentJSON: String ->
      LiveNotifications.startJourney(context, planId, destinationLabel, regionSlug, JSONObject(contentJSON))
    }
    AsyncFunction("updateActivity") { id: String, contentJSON: String, alertTitle: String?, alertBody: String? ->
      LiveNotifications.updateJourney(context, id, JSONObject(contentJSON), alert(alertTitle, alertBody))
    }
    AsyncFunction("endActivity") { id: String? ->
      LiveNotifications.endJourney(context, id)
    }

    // ─── trip ───
    Function("activeTripActivities") { LiveNotifications.activeTrips(context) }
    AsyncFunction("startTripActivity") { attributesJSON: String, contentJSON: String ->
      LiveNotifications.startTrip(context, JSONObject(attributesJSON), JSONObject(contentJSON))
    }
    AsyncFunction("updateTripActivity") { id: String, contentJSON: String, alertTitle: String?, alertBody: String? ->
      LiveNotifications.updateTrip(context, id, JSONObject(contentJSON), alert(alertTitle, alertBody))
    }
    AsyncFunction("endTripActivity") { id: String? ->
      LiveNotifications.endTrip(context, id)
    }
  }

  private fun alert(title: String?, body: String?) =
    title?.takeIf { it.isNotEmpty() }?.let { LiveNotifications.Alert(it, body.orEmpty()) }

  private fun prefs() = context.getSharedPreferences("transit_shared", Context.MODE_PRIVATE)
}
