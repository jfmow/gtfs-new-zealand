package geojson

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// GetWorkDir determines the working directory of the executable
func GetWorkDir() string {
	ex, err := os.Executable()
	if err != nil {
		panic(err)
	}

	dir := filepath.Dir(ex)

	if strings.Contains(dir, "go-build") {
		return "."
	}
	return filepath.Dir(ex)
}

type GeoJsonFeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}

type Feature struct {
	Type       string     `json:"type"`
	Properties Properties `json:"properties"`
	Geometry   Geometry   `json:"geometry"`
}

type Properties struct {
	AgencyName   string  `json:"AGENCYNAME"`
	Mode         string  `json:"MODE"`
	ObjectID     int     `json:"OBJECTID"`
	RouteName    string  `json:"ROUTENAME"`
	RouteNumber  string  `json:"ROUTENUMBER"`
	RoutePattern string  `json:"ROUTEPATTERN"`
	ShapeLength  float64 `json:"Shape__Length"`
}

type Geometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

type CacheItem struct {
	Data      GeoJsonFeatureCollection
	ExpiresAt time.Time
}

// Global cache for route queries
var (
	routeCache    = make(map[string]CacheItem) // Route caches
	cacheMutex    sync.Mutex
	cacheDuration = time.Hour // Cache duration is 1 hour
)

func GetGeoJsonDataForRoute(routeId string, typeOfVehicle string) (*GeoJsonFeatureCollection, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()
	// Check if the route data is already cached and not expired
	if cachedItem, found := routeCache[routeId]; found {
		if time.Now().Before(cachedItem.ExpiresAt) {
			// Return cached data if it's still valid
			return &cachedItem.Data, nil
		}
		// Remove expired cache item
		delete(routeCache, routeId)
	}

	// Load GeoJSON file for the specific vehicle type
	geoJson, err := loadGeoJsonFile(typeOfVehicle)
	if err != nil {
		return nil, err
	}

	// Filter features based on the provided route number
	var filteredFeatures []Feature
	for _, feature := range geoJson.Features {
		if feature.Properties.RouteNumber == routeId {
			filteredFeatures = append(filteredFeatures, feature)
		}
	}

	// Create a new GeoJSON feature collection with the filtered features
	filteredGeoJson := GeoJsonFeatureCollection{
		Type:     "FeatureCollection",
		Features: filteredFeatures,
	}

	// Cache the filtered result for future use
	routeCache[routeId] = CacheItem{
		Data:      filteredGeoJson,
		ExpiresAt: time.Now().Add(cacheDuration), // Cache expires in 1 hour
	}

	return &filteredGeoJson, nil
}

// loadGeoJsonFile loads the entire GeoJSON file based on the vehicle type
func loadGeoJsonFile(typeOfVehicle string) (*GeoJsonFeatureCollection, error) {
	var jsonFile string

	switch typeOfVehicle {
	case "bus":
		jsonFile = "Bus_Route.geojson"
	case "train":
		jsonFile = "Train_Route.geojson"
	case "ferry":
		jsonFile = "Ferry_Route.geojson"
	default:
		return nil, errors.New("invalid vehicle type")
	}

	file, err := os.Open(filepath.Join(GetWorkDir(), "geojson", jsonFile))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}

	var geoJson GeoJsonFeatureCollection
	err = json.Unmarshal(data, &geoJson)
	if err != nil {
		return nil, err
	}

	return &geoJson, nil
}

func (geoJson *GeoJsonFeatureCollection) FilterByTripName(tripName string) *GeoJsonFeatureCollection {
	var filteredData []Feature

	for _, i := range geoJson.Features {
		if i.Properties.RouteName == tripName {
			filteredData = append(filteredData, i)
		}
	}

	if len(filteredData) >= 1 {
		geoJson.Features = filteredData
	}

	return geoJson
}
