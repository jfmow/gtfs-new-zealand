package fares

import (
	"strings"
	"time"
)

// Concession is the fare type the rider has chosen in the app. Each region
// prices the ones it offers; any other falls back to the adult fare, and
// the estimate says so.
type Concession string

const (
	Adult Concession = "adult"
	// Child: school-age - Auckland's child and secondary student fares,
	// Metlink's child fare, Christchurch and Otago's child/youth fares.
	Child Concession = "child"
	// Youth: 19-24 (Christchurch's youth fare, Otago's youth fare).
	Youth Concession = "youth"
	// Tertiary: a full-time tertiary student concession.
	Tertiary Concession = "tertiary"
	// Community: a Community Services Card (Community Connect).
	Community Concession = "community"
	// SuperGold: free off-peak travel for 65+.
	SuperGold Concession = "supergold"
	// Accessible: Total Mobility / Blind Low Vision NZ cardholders.
	Accessible Concession = "accessible"
)

// ParseConcession reads the app's value; anything unknown is Adult.
func ParseConcession(s string) Concession {
	switch c := Concession(s); c {
	case Child, Youth, Tertiary, Community, SuperGold, Accessible:
		return c
	}
	return Adult
}

// noun - "child", for "Child fare" / "no child fare here".
func (c Concession) noun() string {
	switch c {
	case Child:
		return "child"
	case Youth:
		return "youth"
	case Tertiary:
		return "tertiary student"
	case Community:
		return "Community Connect"
	case SuperGold:
		return "SuperGold"
	case Accessible:
		return "accessible"
	}
	return "adult"
}

// fareNote opens an estimate's note: "Child fare." - or, when the region
// has no such concession, "Adult fare - there's no tertiary student fare
// here."
func fareNote(asked, applied Concession) string {
	if asked != applied {
		return "Adult fare - there's no " + asked.noun() + " fare here."
	}
	n := applied.noun()
	return strings.ToUpper(n[:1]) + n[1:] + " fare."
}

// superGoldFree is the national SuperGold off-peak window: weekdays
// 9am-3pm and from 6:30pm, and all weekend. Public holidays count too but
// aren't known here.
func superGoldFree(t time.Time) bool {
	if wd := t.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return true
	}
	mins := t.Hour()*60 + t.Minute()
	return (mins >= 9*60 && mins < 15*60) || mins >= 18*60+30
}

func weekend(t time.Time) bool {
	wd := t.Weekday()
	return wd == time.Saturday || wd == time.Sunday
}

// halfCents is half a fare, rounded to the nearest cent.
func halfCents(cents int) int { return (cents + 1) / 2 }
