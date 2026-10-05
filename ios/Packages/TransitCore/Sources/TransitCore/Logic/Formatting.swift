import Foundation
import os

/// Time/duration/distance formatting - ported from the web app's
/// `lib/formating.ts`. Service dates and clock times sent to the backend are
/// pinned to the selected region's time zone (`timeZone`), regardless of the
/// device's, same as the backend (`region.timeZone()` in `main.go`) and the
/// web app (`regionTimeZone()`).
public enum TimeFormatting {
    public static let nzTimeZone = TimeZone(identifier: "Pacific/Auckland")!

    private static let zone = OSAllocatedUnfairLock(initialState: nzTimeZone)

    /// The selected region's time zone. The app sets it whenever the region
    /// changes (`AppEnvironment.choose(region:)`); defaults to NZ.
    public static var timeZone: TimeZone {
        get { zone.withLock { $0 } }
        set { zone.withLock { $0 = newValue } }
    }

    /// "HH:MM:SS" (can be ">= 24:00:00" for a service past midnight on the
    /// same GTFS service day) to a 12-hour label like "4:15pm" - matches the
    /// Go backend's own `time.Format("3:04pm")` used in push copy.
    public static func convert24hTo12h(_ hhmmss: String) -> String? {
        let parts = hhmmss.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let wrappedHour = parts[0] % 24
        let minute = parts[1]
        let hour12 = wrappedHour % 12 == 0 ? 12 : wrappedHour % 12
        let period = wrappedHour < 12 ? "am" : "pm"
        return String(format: "%d:%02d%@", hour12, minute, period)
    }

    /// "Departed" / "Now" / "N min" / "H hr M min" / "N day(s)" - mirrors
    /// `timeTillArrivalString`/`timeTillArrivalMsString`. `minutes` should be
    /// the backend's own `time_till_arrival` (day-aware), not re-derived from
    /// a raw time string.
    public static func timeTillArrivalString(minutes: Double) -> String {
        if minutes < 0 { return "Departed" }
        if minutes < 1 { return "Now" }

        let totalMinutes = Int(minutes.rounded())
        let minutesPerDay = 60 * 24
        if totalMinutes >= minutesPerDay {
            let days = totalMinutes / minutesPerDay
            return days == 1 ? "1 day" : "\(days) days"
        }
        if totalMinutes < 60 {
            return "\(totalMinutes) min"
        }
        let hours = totalMinutes / 60
        let mins = totalMinutes % 60
        return mins == 0 ? "\(hours) hr" : "\(hours) hr \(mins) min"
    }

    /// A `GoDuration` (e.g. `JourneyLeg.duration`, `JourneyPlan.totalDuration`)
    /// to "N min" or "Xh Ym" - mirrors `formatDuration`.
    public static func formatDuration(_ duration: GoDuration) -> String {
        let totalMinutes = max(0, Int((duration.timeInterval / 60).rounded()))
        if totalMinutes < 60 { return "\(totalMinutes) min" }
        let hours = totalMinutes / 60
        let mins = totalMinutes % 60
        return mins == 0 ? "\(hours)h" : "\(hours)h \(mins)m"
    }

    /// Metres below 1 km, otherwise "X.XX km" - mirrors `formatDistance`.
    public static func formatDistance(meters: Double) -> String {
        if meters < 1000 { return "\(Int(meters.rounded())) m" }
        return String(format: "%.2f km", meters / 1000)
    }

    /// "YYYYMMDD" in the region's time zone - mirrors `serviceDate`. This is the
    /// GTFS service-date convention, not necessarily the device's local date.
    public static func nzServiceDate(_ date: Date) -> String {
        dateFormatter(pattern: "yyyyMMdd").string(from: date)
    }

    /// "HH:mm" in the region's time zone - mirrors `regionHHMM`.
    public static func nzHHMM(_ date: Date) -> String {
        dateFormatter(pattern: "HH:mm").string(from: date)
    }

    private static func dateFormatter(pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = pattern
        formatter.timeZone = timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }

    /// `formatTextToNiceLookingWords` from `lib/formating.ts` - AT's raw
    /// headsigns are often shouty caps ("WAIKOWHAI"); this strips digits
    /// (route-number suffixes some feeds tack on), collapses whitespace,
    /// and title-cases every word.
    public static func niceLookingWords(_ text: String, retainDigits: Bool = false) -> String {
        var words = text
        if !retainDigits {
            words = words.replacingOccurrences(of: #"\d+"#, with: "", options: .regularExpression)
        }
        words = words
            .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return words
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}
