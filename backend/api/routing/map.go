package routing

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"strings"
)

type Coordinates struct {
	Lat, Lon float64
}

// GeoJSON structure for the desired response format
type GeoJSONResponse struct {
	Type         string    `json:"type"`
	Features     []Feature `json:"features"`
	Instructions string    `json:"instructions"`
	Duration     float64   `json:"duration"` // Duration in seconds
}

type Feature struct {
	Type       string    `json:"type"`
	Geometry   Geometry  `json:"geometry"`
	Properties *struct{} `json:"properties"` // null in this case
}

type Geometry struct {
	Type        string      `json:"type"`
	Coordinates [][]float64 `json:"coordinates"`
}

// Step struct for OSRM step details
type Step struct {
	Maneuver struct {
		Modifier string `json:"modifier"`
	} `json:"maneuver"`
	Name     string  `json:"name"`
	Distance float64 `json:"distance"`
}

// Function to get the route from OSRM
func getRouteFromOSRM(start, end Coordinates) (GeoJSONResponse, error) {
	// Base URL for OSRM
	baseURL := os.Getenv("OSRM_URL")

	// Construct the API query URL (lon,lat format)
	query := fmt.Sprintf("%f,%f;%f,%f", start.Lon, start.Lat, end.Lon, end.Lat)

	// Add GeoJSON output format
	queryParams := "?overview=full&geometries=geojson&steps=true"

	// Final URL
	url := baseURL + query + queryParams

	// Make HTTP request
	resp, err := http.Get(url)
	if err != nil {
		return GeoJSONResponse{}, err
	}
	defer resp.Body.Close()

	// Check if the request was successful
	if resp.StatusCode != http.StatusOK {
		return GeoJSONResponse{}, fmt.Errorf("failed to get route: status code %d", resp.StatusCode)
	}

	// Read response body
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return GeoJSONResponse{}, err
	}

	// Parse the response to extract GeoJSON route
	var osrmResponse struct {
		Routes []struct {
			Geometry struct {
				Coordinates [][]float64 `json:"coordinates"`
			} `json:"geometry"`
			Legs []struct {
				Steps    []Step  `json:"steps"`
				Duration float64 `json:"duration"` // Duration in seconds
			} `json:"legs"`
		} `json:"routes"`
	}

	err = json.Unmarshal(body, &osrmResponse)
	if err != nil {
		return GeoJSONResponse{}, err
	}

	// Construct the desired GeoJSON response
	geoJSONResponse := GeoJSONResponse{
		Type: "FeatureCollection",
		Features: []Feature{
			{
				Type: "Feature",
				Geometry: Geometry{
					Type:        "LineString",
					Coordinates: osrmResponse.Routes[0].Geometry.Coordinates,
				},
				Properties: nil,
			},
		},
		Duration: osrmResponse.Routes[0].Legs[0].Duration, // Set duration from OSRM response
	}

	// Collect directions as text, filtering out empty instructions
	var directions []string
	for _, step := range osrmResponse.Routes[0].Legs[0].Steps {
		if step.Maneuver.Modifier != "" {
			direction := fmt.Sprintf("%s onto %s for %.1f meters", step.Maneuver.Modifier, step.Name, step.Distance)
			directions = append(directions, direction)
		}
	}

	// Join directions and assign to the GeoJSON response
	geoJSONResponse.Instructions = strings.Join(directions, ", ")

	if len(geoJSONResponse.Features) == 0 {
		return GeoJSONResponse{}, errors.New("no route found")
	}

	return geoJSONResponse, nil
}

// Example usage
func GetWalkingDirections(start, end Coordinates) GeoJSONResponse {
	geoJSON, err := getRouteFromOSRM(start, end)
	if err != nil {
		fmt.Println("Error getting route:", err)
	}

	return geoJSON
}

func GetDrivingDirections(start, end Coordinates) GeoJSONResponse {
	geoJSON, err := getRouteFromOSRM(start, end)
	if err != nil {
		fmt.Println("Error getting route:", err)
	}
	return geoJSON
}
