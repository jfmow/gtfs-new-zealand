package dev.suddsy.transitnative

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.format.DateFormat
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Date
import kotlin.concurrent.thread

/**
 * Next departures from a saved stop on the home screen - the Android version
 * of the iOS Departures widget (targets/widgets/DeparturesWidget.swift).
 *
 * The app mirrors the region and saved stops into the "transit_shared"
 * preferences (syncWidgetData in src/lib/live-surface.ts); the widget reads
 * them, fetches the stop's board, and shows departure times (clock times,
 * which stay right between refreshes). The ⇄ button steps through saved
 * stops; tapping a row opens the stop in the app.
 */
class DeparturesWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    refresh(context, manager, ids)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    refresh(context, manager, intArrayOf(id))
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val edit = prefs(context).edit()
    ids.forEach { edit.remove(stopIndexKey(it)) }
    edit.apply()
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_NEXT_STOP) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
        val p = prefs(context)
        p.edit().putInt(stopIndexKey(id), p.getInt(stopIndexKey(id), 0) + 1).apply()
        refresh(context, AppWidgetManager.getInstance(context), intArrayOf(id))
      }
      return
    }
    super.onReceive(context, intent)
  }

  private fun refresh(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val pending = goAsync()
    thread {
      try {
        ids.forEach { id -> manager.updateAppWidget(id, build(context, manager, id)) }
      } finally {
        pending.finish()
      }
    }
  }

  private data class SavedStop(val query: String, val title: String)
  private data class Row(val route: String, val color: Int?, val headsign: String, val departsAt: Long, val live: Boolean)

  /** Builds the widget for `id` (network: call off the main thread). */
  private fun build(context: Context, manager: AppWidgetManager, id: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.transit_widget_departures)
    views.removeAllViews(R.id.transit_widget_rows)
    val stops = savedStops(context)
    if (stops.isEmpty()) {
      views.setTextViewText(R.id.transit_widget_title, "Departures")
      views.addView(R.id.transit_widget_rows, message(context, "Save a stop in Transit (tap its star) to see its next departures here."))
      views.setTextViewText(R.id.transit_widget_footer, "")
      views.setOnClickPendingIntent(R.id.transit_widget_root, openApp(context, null, id))
      views.setViewVisibility(R.id.transit_widget_next, android.view.View.GONE)
      return views
    }
    val stop = stops[Math.floorMod(prefs(context).getInt(stopIndexKey(id), 0), stops.size)]
    views.setTextViewText(R.id.transit_widget_title, stop.title)
    views.setViewVisibility(R.id.transit_widget_next, if (stops.size > 1) android.view.View.VISIBLE else android.view.View.GONE)
    views.setOnClickPendingIntent(R.id.transit_widget_next, nextStop(context, id))
    views.setOnClickPendingIntent(R.id.transit_widget_root, openApp(context, stop.query, id))

    val heightDp = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180)
    val rowLimit = ((heightDp - 64) / 30).coerceIn(2, 8)
    val now = System.currentTimeMillis()
    val rows = try {
      fetch(context, stop.query, rowLimit, now)
    } catch (e: Exception) {
      null
    }
    when {
      rows == null -> views.addView(R.id.transit_widget_rows, message(context, "Couldn't load departures. Tap to open Transit."))
      rows.isEmpty() -> views.addView(R.id.transit_widget_rows, message(context, "No more departures today."))
      else -> rows.take(rowLimit).forEach { views.addView(R.id.transit_widget_rows, row(context, it)) }
    }
    views.setTextViewText(R.id.transit_widget_footer, "Updated ${clock(context, now)}")
    return views
  }

  private fun row(context: Context, r: Row): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.transit_widget_row)
    v.setTextViewText(R.id.transit_widget_row_route, r.route)
    v.setTextViewText(R.id.transit_widget_row_headsign, r.headsign)
    v.setTextViewText(R.id.transit_widget_row_time, clock(context, r.departsAt))
    v.setInt(R.id.transit_widget_row_dot, "setColorFilter", r.color ?: context.getColor(R.color.transit_widget_muted))
    if (r.live) v.setTextColor(R.id.transit_widget_row_time, context.getColor(R.color.transit_widget_live))
    v.setContentDescription(R.id.transit_widget_row_time, "${r.route} to ${r.headsign} at ${clock(context, r.departsAt)}${if (r.live) ", live" else ""}")
    return v
  }

  private fun message(context: Context, text: String): RemoteViews =
    RemoteViews(context.packageName, R.layout.transit_widget_message).apply { setTextViewText(R.id.transit_widget_message, text) }

  private fun fetch(context: Context, query: String, limit: Int, now: Long): List<Row> {
    val slug = prefs(context).getString("regionSlug", null) ?: "at"
    if (slug !in REGIONS) return emptyList()
    val segment = URLEncoder.encode(query, "UTF-8").replace("+", "%20")
    val conn = URL("$API/$slug/services/$segment?limit=${limit + 4}").openConnection() as HttpURLConnection
    conn.connectTimeout = 8000
    conn.readTimeout = 8000
    try {
      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
      val out = mutableListOf<Row>()
      for (i in 0 until data.length()) {
        val d = data.getJSONObject(i)
        if (d.optBoolean("canceled") || d.optBoolean("skipped") || d.optBoolean("departed")) continue
        val route = d.optJSONObject("route") ?: continue
        val minutes = d.optDouble("time_till_arrival", Double.NaN)
        if (minutes.isNaN()) continue
        out += Row(
          route = route.optString("name"),
          color = parseColor(route.optString("color")),
          headsign = d.optString("headsign"),
          departsAt = now + (minutes * 60_000).toLong(),
          live = d.optBoolean("location_tracking") || d.optBoolean("trip_update_tracking"),
        )
      }
      return out
    } finally {
      conn.disconnect()
    }
  }

  private fun parseColor(hex: String): Int? = try {
    if (hex.isBlank()) null else Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
  } catch (e: IllegalArgumentException) {
    null
  }

  private fun clock(context: Context, at: Long): String = DateFormat.getTimeFormat(context).format(Date(at))

  private fun savedStops(context: Context): List<SavedStop> {
    val raw = prefs(context).getString("savedStops", null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { arr.getJSONObject(it) }.map { SavedStop(it.optString("query"), it.optString("title")) }.filter { it.query.isNotBlank() }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /** Opens the app on the stop's board (or just the app). */
  private fun openApp(context: Context, stopQuery: String?, id: Int): PendingIntent {
    val scheme = prefs(context).getString("scheme", null) ?: "transit"
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    if (stopQuery != null) {
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse("$scheme://stop?s=${Uri.encode(stopQuery)}")
    }
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun nextStop(context: Context, id: Int): PendingIntent {
    val intent = Intent(context, DeparturesWidget::class.java).setAction(ACTION_NEXT_STOP).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  companion object {
    private const val ACTION_NEXT_STOP = "dev.suddsy.transitnative.DEPARTURES_NEXT_STOP"
    private const val API = "https://trainapi.suddsy.dev"
    // Keep in step with packages/shared/src/regions.ts (as the iOS widget's Region.bySlug).
    private val REGIONS = setOf("at", "wel", "christ", "otago", "seq")

    private fun prefs(context: Context) = context.getSharedPreferences("transit_shared", Context.MODE_PRIVATE)
    private fun stopIndexKey(id: Int) = "widget_stop_index_$id"

    /** Redraws every Departures widget - after the saved stops or region change. */
    fun reloadAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DeparturesWidget::class.java))
      if (ids.isEmpty()) return
      val intent = Intent(context, DeparturesWidget::class.java)
        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      context.sendBroadcast(intent)
    }
  }
}
