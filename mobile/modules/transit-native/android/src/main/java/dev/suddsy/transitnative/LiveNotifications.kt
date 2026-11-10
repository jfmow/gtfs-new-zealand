package dev.suddsy.transitnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Android's Live Activities: the journey and trip "live updates" - ongoing
 * notifications with a progress bar along the ride and a countdown. On
 * Android 16+ they're promoted (a status-bar chip, top of the shade, the lock
 * screen); before that they're ordinary ongoing notifications.
 *
 * Drawn from the same content JSON as the iOS activities
 * (`JourneyActivityAttributes.ContentState` / `TripActivityAttributes.ContentState`),
 * written by the app while it's open (TransitNativeModule) and pushed by the
 * server's Live Activity crons over FCM while it isn't (TransitMessagingService).
 *
 * The running activity - its id and what doesn't change (plan, stop, route) -
 * is kept in shared preferences, so a push that arrives with the app not
 * running can still draw it, and one for an activity that's since ended is
 * ignored rather than bringing it back.
 */
internal object LiveNotifications {
  private const val PREFS = "transit_live"
  private const val KEY_JOURNEY = "journey"
  private const val KEY_TRIP = "trip"

  /**
   * Default importance, so it sits with the notifications that matter rather
   * than down in "Silent" - each post is silent (setSilent/onlyAlertOnce), so
   * updates never buzz. (A channel's importance can't be raised once made,
   * hence a new id; the old low-importance "journey_live" is deleted.)
   */
  private const val CHANNEL_LIVE = "live_updates"
  private const val CHANNEL_LIVE_OLD = "journey_live"
  /** The app's "Journey moments" channel (push.ts) - get on now, get off next. */
  private const val CHANNEL_MOMENT = "journey"

  private const val JOURNEY_ID = 4201
  private const val TRIP_ID = 4202
  private const val MOMENT_ID = 4203

  private const val WEB = "https://trains.suddsy.dev"
  private val FOREST = 0xFF173A2A.toInt()
  private val WALK = 0xFF9CA3AF.toInt()
  private val DEFAULT_ROUTE = 0xFF2E7D5B.toInt()
  private val STOP = 0xFFDC2626.toInt()

  /** A running card with no update for this long past its moment is taken down. */
  private const val ABANDON_AFTER_MS = 20 * 60_000L

  /** Up to this many stops out, the trip's vehicle slides in toward your stop (the iOS widget's window). */
  private const val TRIP_WINDOW = 8.0

  data class Alert(val title: String, val body: String, val silent: Boolean = false)

  // ─── the running activities ───

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun stored(ctx: Context, key: String): JSONObject? =
    prefs(ctx).getString(key, null)?.let { runCatching { JSONObject(it) }.getOrNull() }

  fun activeJourneys(ctx: Context): List<Map<String, String>> =
    stored(ctx, KEY_JOURNEY)?.let { listOf(mapOf("id" to it.optString("id"), "planId" to it.optString("planId"))) } ?: emptyList()

  fun activeTrips(ctx: Context): List<Map<String, String>> =
    stored(ctx, KEY_TRIP)?.let { listOf(mapOf("id" to it.optString("id"), "tripId" to it.optString("tripId"), "stopId" to it.optString("stopId"))) } ?: emptyList()

  fun startJourney(ctx: Context, planId: String, destination: String, region: String, content: JSONObject): String {
    val id = "android-journey-" + UUID.randomUUID()
    val record = JSONObject().put("id", id).put("planId", planId).put("destination", destination).put("region", region)
    prefs(ctx).edit().putString(KEY_JOURNEY, record.toString()).commit()
    renderJourney(ctx, record, content, null, null)
    return id
  }

  fun updateJourney(ctx: Context, id: String, content: JSONObject, alert: Alert?) {
    val record = stored(ctx, KEY_JOURNEY)?.takeIf { it.optString("id") == id } ?: return
    renderJourney(ctx, record, content, alert, null)
  }

  fun endJourney(ctx: Context, id: String?) {
    val record = stored(ctx, KEY_JOURNEY) ?: return
    if (id != null && record.optString("id") != id) return
    prefs(ctx).edit().remove(KEY_JOURNEY).commit()
    NotificationManagerCompat.from(ctx).cancel(JOURNEY_ID)
  }

  fun startTrip(ctx: Context, attributes: JSONObject, content: JSONObject): String {
    val id = "android-trip-" + UUID.randomUUID()
    val record = JSONObject().put("id", id).put("tripId", attributes.optString("tripID")).put("stopId", attributes.optString("stopID")).put("attributes", attributes)
    prefs(ctx).edit().putString(KEY_TRIP, record.toString()).commit()
    renderTrip(ctx, record, content, null, null)
    return id
  }

  fun updateTrip(ctx: Context, id: String, content: JSONObject, alert: Alert?) {
    val record = stored(ctx, KEY_TRIP)?.takeIf { it.optString("id") == id } ?: return
    renderTrip(ctx, record, content, alert, null)
  }

  fun endTrip(ctx: Context, id: String?) {
    val record = stored(ctx, KEY_TRIP) ?: return
    if (id != null && record.optString("id") != id) return
    prefs(ctx).edit().remove(KEY_TRIP).commit()
    NotificationManagerCompat.from(ctx).cancel(TRIP_ID)
  }

  /**
   * A live-update push from the server (fcmLiveMessage). False when it isn't
   * one - the caller hands it on to expo-notifications.
   */
  fun onPush(ctx: Context, data: Map<String, String>): Boolean {
    if (data["transit"] != "live") return false
    val id = data["activityId"] ?: return true
    val state = runCatching { JSONObject(data["state"] ?: "") }.getOrNull() ?: return true
    val alert = data["alertTitle"]?.takeIf { it.isNotEmpty() }?.let { Alert(it, data["alertBody"].orEmpty(), data["alertSilent"] == "1") }
    val endAt = data["end"]?.toLongOrNull()
    val key = if (data["kind"] == "trip") KEY_TRIP else KEY_JOURNEY
    // Not the activity this phone is running (ended here, or from before a reinstall): leave it ended.
    val record = stored(ctx, key)?.takeIf { it.optString("id") == id } ?: return true
    if (key == KEY_TRIP) renderTrip(ctx, record, state, alert, endAt) else renderJourney(ctx, record, state, alert, endAt)
    if (endAt != null) prefs(ctx).edit().remove(key).commit()
    return true
  }

  // ─── journey ───

  private fun renderJourney(ctx: Context, record: JSONObject, c: JSONObject, alert: Alert?, endAt: Long?) {
    val url = "$WEB/journey?id=${enc(record.optString("planId"))}&region=${enc(record.optString("region"))}&track=1"
    val route = c.optString("routeShortName")
    val headsign = c.optString("headsign")
    val finished = endAt != null || c.optString("status") == "arrived" || c.optString("phase") == "arrived"

    val b = base(ctx, url, JOURNEY_ID)
      .setContentTitle(c.optString("primaryText").ifEmpty { "Your journey" })
      .setContentText(c.optString("secondaryText"))
    if (route.isNotEmpty()) b.setSubText(if (headsign.isNotEmpty()) "$route to $headsign" else route)

    // One segment per leg, coloured like the leg chips (walks grey), with a
    // point at each change; the tracker rides along at the journey's progress.
    val legs = c.optJSONArray("legChain")
    val n = maxOf(1, legs?.length() ?: 0)
    val total = 1000
    val per = total / n
    val style = NotificationCompat.ProgressStyle()
    for (i in 0 until n) {
      val leg = legs?.optJSONObject(i)
      val length = if (i == n - 1) total - per * (n - 1) else per
      val color = if (leg == null || leg.optString("mode") == "walk") WALK else color(leg.optString("colorHex"), DEFAULT_ROUTE)
      style.addProgressSegment(NotificationCompat.ProgressStyle.Segment(length).setColor(color))
    }
    for (i in 1 until n) style.addProgressPoint(NotificationCompat.ProgressStyle.Point(per * i))
    val fraction = if (finished) 1.0 else c.optDouble("progressFraction", 0.0).coerceIn(0.0, 1.0)
    style.setProgress((fraction * total).toInt())
    style.setProgressTrackerIcon(IconCompat.createWithResource(ctx, R.drawable.transit_live_vehicle))
    b.setStyle(style)

    if (!finished) countdown(b, c.optDouble("targetUnix", 0.0), route.ifEmpty { null })
    finish(b, finished, endAt, maxOf((c.optDouble("targetUnix", 0.0) * 1000).toLong(), (c.optDouble("arrivalUnix", 0.0) * 1000).toLong()))
    notify(ctx, JOURNEY_ID, b)
    alert?.let { moment(ctx, it, url) }
  }

  // ─── trip ───

  private fun renderTrip(ctx: Context, record: JSONObject, s: JSONObject, alert: Alert?, endAt: Long?) {
    val a = record.optJSONObject("attributes") ?: return
    val stop = a.optString("stopName")
    val getOff = a.optString("kind") == "get_off"
    val route = a.optString("routeShortName")
    val headsign = a.optString("headsign")
    val phase = s.optString("phase", "coming")
    val target = (s.optDouble("targetUnix", 0.0) * 1000).toLong()
    val finished = endAt != null || phase == "gone"
    val url = "$WEB/trip?tripId=${enc(a.optString("tripID"))}&stop=${enc(a.optString("stopID"))}&region=${enc(a.optString("regionSlug"))}"

    // The iOS trip activity's copy (TripLiveActivity.swift TripHeadline).
    val title = when (phase) {
      "gone" -> if (getOff) "At $stop" else "Arrived at $stop"
      "next" -> if (getOff) "Get off next stop" else "$stop is next"
      else -> if (getOff) "Get off at $stop" else "Arriving at $stop"
    }
    val detail = when {
      phase == "cancelled" -> "This trip is cancelled"
      s.optBoolean("skipped") -> "Not stopping at $stop"
      phase == "gone" -> "Arrived ${clock(target)}"
      else -> "Arrives ${clock(target)} · ${delayText(s)}"
    }

    val b = base(ctx, url, TRIP_ID).setContentTitle(title).setContentText(detail)
    if (route.isNotEmpty()) b.setSubText(if (headsign.isNotEmpty()) "$route to $headsign" else route)

    // Stops until yours, counting it (1 = it's next) - only with a placed vehicle.
    val away = if (s.optBoolean("hasVehicle") && s.has("stopsAway") && s.optInt("stopsAway", -1) >= 0) s.optInt("stopsAway") + 1 else null
    val fraction = when {
      finished -> 1.0
      away != null -> 1 - minOf(away.toDouble(), TRIP_WINDOW) / TRIP_WINDOW
      else -> 0.0
    }
    val style = NotificationCompat.ProgressStyle()
      .addProgressSegment(NotificationCompat.ProgressStyle.Segment(100).setColor(color(a.optString("routeColorHex"), DEFAULT_ROUTE)))
      .addProgressPoint(NotificationCompat.ProgressStyle.Point(100).setColor(STOP))
      .setProgress((fraction * 100).toInt())
      .setProgressTrackerIcon(IconCompat.createWithResource(ctx, R.drawable.transit_live_vehicle))
    b.setStyle(style)

    if (!finished) {
      // The arrival countdown in the header; the chip says stops when there's a vehicle to count them.
      countdown(b, s.optDouble("targetUnix", 0.0), route.ifEmpty { null })
      when {
        phase == "cancelled" -> b.setShortCriticalText("Cancelled")
        phase == "next" -> b.setShortCriticalText("Next")
        away != null -> b.setShortCriticalText(if (away == 1) "1 stop" else "$away stops")
      }
    }
    finish(b, finished, endAt, target)
    notify(ctx, TRIP_ID, b)
    alert?.let { moment(ctx, it, url) }
  }

  private fun delayText(s: JSONObject): String {
    if (!s.optBoolean("isRealtime")) return "Timetable"
    val d = s.optInt("delayMinutes")
    return when {
      d > 0 -> "$d min late"
      d < 0 -> "${-d} min early"
      else -> "On time"
    }
  }

  // ─── building blocks ───

  private fun base(ctx: Context, url: String, requestCode: Int): NotificationCompat.Builder {
    ensureChannels(ctx)
    return NotificationCompat.Builder(ctx, CHANNEL_LIVE)
      .setSmallIcon(R.drawable.transit_live_vehicle)
      .setColor(FOREST)
      .setContentIntent(tap(ctx, url, requestCode))
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setSilent(true)
  }

  /**
   * The countdown: a chronometer to `targetUnix` (the status-bar chip ticks
   * on its own between pushes), or with nothing ahead, `chip` as the chip's text.
   */
  private fun countdown(b: NotificationCompat.Builder, targetUnix: Double, chip: String?) {
    val target = (targetUnix * 1000).toLong()
    if (target > System.currentTimeMillis()) {
      b.setWhen(target).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
    } else {
      b.setShowWhen(false)
      chip?.let { b.setShortCriticalText(it) }
    }
  }

  /**
   * Running: ongoing and asking to be promoted to a Live Update (Android 16+;
   * it must not be colorized for that). Finished: left up a little while
   * (until the server's dismissal time, else a minute), then removed.
   */
  private fun finish(b: NotificationCompat.Builder, finished: Boolean, endAt: Long?, targetMs: Long = 0) {
    if (!finished) {
      // Never left up forever if the updates stop (offline, or the server lost
      // the activity): gone a while after its moment - each update resets it.
      // (iOS has its stale date and 8 h limit.)
      val untilTarget = maxOf(0L, targetMs - System.currentTimeMillis())
      b.setOngoing(true).setRequestPromotedOngoing(true).setTimeoutAfter(untilTarget + ABANDON_AFTER_MS)
      return
    }
    val showFor = endAt?.let { it * 1000 - System.currentTimeMillis() } ?: 60_000L
    b.setOngoing(false).setRequestPromotedOngoing(false).setAutoCancel(true).setTimeoutAfter(maxOf(5_000L, showFor))
  }

  /** A moment to act on (get on now, get off next) - a heads-up of its own, as iOS expands the Dynamic Island. */
  private fun moment(ctx: Context, alert: Alert, url: String) {
    if (alert.silent) return // the server sent it as a notification already
    val b = NotificationCompat.Builder(ctx, CHANNEL_MOMENT)
      .setSmallIcon(R.drawable.transit_live_vehicle)
      .setColor(FOREST)
      .setContentTitle(alert.title)
      .setContentText(alert.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setTimeoutAfter(10 * 60_000L)
      .setContentIntent(tap(ctx, url, MOMENT_ID))
    notify(ctx, MOMENT_ID, b)
  }

  private fun notify(ctx: Context, id: Int, b: NotificationCompat.Builder) {
    try {
      NotificationManagerCompat.from(ctx).notify(id, b.build())
    } catch (e: SecurityException) {
      // Notifications not allowed - nothing to show.
    }
  }

  private fun tap(ctx: Context, url: String, requestCode: Int): PendingIntent {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(ctx.packageName)
    return PendingIntent.getActivity(ctx, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = ctx.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_LIVE) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_LIVE, "Live journey", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Your journey or trip's progress while you travel"
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      })
      manager.deleteNotificationChannel(CHANNEL_LIVE_OLD)
    }
    // Normally made by the app at launch (push.ts); a push can arrive first.
    if (manager.getNotificationChannel(CHANNEL_MOMENT) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_MOMENT, "Journey moments", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Time to leave, get on now, get off next"
        vibrationPattern = longArrayOf(0, 250, 150, 250)
        enableVibration(true)
      })
    }
  }

  private fun color(hex: String?, fallback: Int): Int {
    val h = hex?.trim()?.removePrefix("#").orEmpty()
    if (h.length != 6) return fallback
    return runCatching { Color.parseColor("#$h") }.getOrDefault(fallback)
  }

  private val clockFormat = SimpleDateFormat("h:mma", Locale.US)
  private fun clock(ms: Long) = synchronized(clockFormat) { clockFormat.format(Date(ms)).lowercase(Locale.US) }

  private fun enc(s: String) = Uri.encode(s)
}
