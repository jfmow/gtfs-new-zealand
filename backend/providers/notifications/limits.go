package notifications

import (
	"math"
	"strings"
	"unicode/utf8"
)

// Input bounds shared by the notification handlers and the public planner.
// Every value here is stored per client or replanned by a shared cron, so it
// has to be bounded at the edge rather than trusted from the request.
const (
	// maxReminderLabelRunes caps free-text labels stored on journey reminders
	// (start/end labels, route short name, boarding stop name).
	maxReminderLabelRunes = 200
	// maxDeeplinkBytes caps the in-app path a reminder push opens.
	maxDeeplinkBytes = 512

	// MaxPlannerWalkKm and MaxPlannerTransfers are the largest values the web
	// and iOS planners offer (5 km, 5 transfers) plus a little headroom.
	MaxPlannerWalkKm    = 5.0
	MaxPlannerTransfers = 6
)

// ClampMaxWalkKm keeps a requested walking limit within what the apps offer.
func ClampMaxWalkKm(km float64) float64 {
	if math.IsNaN(km) || km > MaxPlannerWalkKm {
		return MaxPlannerWalkKm
	}
	return km
}

// ClampMaxTransfers keeps a requested transfer limit within what the apps offer.
func ClampMaxTransfers(n int) int {
	if n > MaxPlannerTransfers {
		return MaxPlannerTransfers
	}
	return n
}

// truncateRunes cuts s to at most n runes without splitting a character.
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}

// isAppPath reports whether p is a same-origin in-app path ("/journey?id=…").
// Protocol-relative ("//host") and backslash forms are rejected because
// browsers treat them as another origin.
func isAppPath(p string) bool {
	return len(p) <= maxDeeplinkBytes &&
		strings.HasPrefix(p, "/") &&
		!strings.HasPrefix(p, "//") &&
		!strings.ContainsAny(p, "\\\r\n")
}

// validLatLon rejects NaN/Inf and out-of-range coordinates.
func validLatLon(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) &&
		lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}
