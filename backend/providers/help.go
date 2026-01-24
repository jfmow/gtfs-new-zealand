package providers

import "math"

func pointInBounds(lat, lng float64, sw, ne LatLng) bool {
	// Allow sw/ne to be provided in any order: normalize bounds
	minLat := math.Min(sw.Lat, ne.Lat)
	maxLat := math.Max(sw.Lat, ne.Lat)
	minLng := math.Min(sw.Lng, ne.Lng)
	maxLng := math.Max(sw.Lng, ne.Lng)

	return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

// haversine returns the distance in meters between two lat/lon points
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters

	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	lat1 = lat1 * math.Pi / 180
	lat2 = lat2 * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1)*math.Cos(lat2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}
