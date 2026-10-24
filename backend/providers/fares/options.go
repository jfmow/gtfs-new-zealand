package fares

// Option is a fare type a region offers, as the apps list it.
type Option struct {
	Value  Concession `json:"value"`
	Label  string     `json:"label"`
	Detail string     `json:"detail,omitempty"`
}

// Options is what the region's riders can pick in Settings - only the
// concessions it has its own fare for, in its own words. Adult is always
// first.
func Options(region string) []Option {
	switch region {
	case "at":
		return []Option{
			{Adult, "Adult", "AT HOP or contactless"},
			{Child, "Child or secondary student", "5-19. Free at weekends for 5-15"},
			{Tertiary, "Tertiary student", "Full-time, at an Auckland institution"},
			{Community, "Community Connect", "Community Services Card"},
			{SuperGold, "SuperGold", "Free after 9am on weekdays and at weekends"},
			{Accessible, "Accessible", "Total Mobility or Blind Low Vision NZ card"},
		}
	case "wel":
		return []Option{
			{Adult, "Adult", "Snapper or contactless"},
			{Child, "Child", "Half fare on Snapper"},
			{Tertiary, "Tertiary student", "25% off on Snapper"},
			{Community, "Community Connect", "Community Services Card"},
			{SuperGold, "SuperGold", "Free off-peak"},
			{Accessible, "Accessible", "Half fare on Snapper"},
		}
	case "christ":
		return []Option{
			{Adult, "Standard", "Metrocard or contactless"},
			{Child, "Child", "5-18"},
			{Youth, "Youth", "19-24"},
			{SuperGold, "SuperGold", "Free from 9am on weekdays and at weekends"},
		}
	case "otago":
		return []Option{
			{Adult, "Adult", "Bee Card"},
			{Child, "Child or youth", "5-18"},
			{Community, "Community Connect", "Community Services Card"},
			{SuperGold, "SuperGold", "Free off-peak"},
		}
	case "seq":
		return []Option{{Adult, "Everyone", "50c on every service"}}
	}
	return []Option{{Adult, "Adult", ""}}
}

// offers reports whether the region has its own fare for c.
func offers(region string, c Concession) bool {
	for _, o := range Options(region) {
		if o.Value == c {
			return true
		}
	}
	return false
}
