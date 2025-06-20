package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jfmow/gtfs"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

func setupNavigationRoutes(primaryRoute *echo.Group, gtfsData gtfs.Database) {
	navigationRoute := primaryRoute.Group("/map")
	navigationRoute.Use(middleware.GzipWithConfig(gzipConfig))

	//Returns the route of a route as geo json
	navigationRoute.POST("/geojson/shapes", func(c echo.Context) error {
		tripId := c.FormValue("tripId")
		routeId := c.FormValue("routeId")

		shapes, err := gtfsData.GetShapeByTripID(tripId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid trip id", nil, ResponseDetails("tripId", tripId, "details", "No route line available for the given trip ID in the GTFS data", "error", err.Error()))
		}
		geoJson, err := shapes.ToGeoJSON()
		if err != nil {
			return JsonApiResponse(c, http.StatusInternalServerError, "", nil, ResponseDetails("tripId", tripId, "details", "Error generating GeoJSON for the route", "error", err.Error()))
		}

		//No cache because this route isn't used a lot (yet)
		route, err := gtfsData.GetRouteByID(routeId)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid route id", nil, ResponseDetails("routeId", routeId, "details", "No route found for the given route ID", "error", err.Error()))
		}

		type MapResponse struct {
			Color   string `json:"color"`
			GeoJson any    `json:"geojson"`
		}

		return JsonApiResponse(c, http.StatusOK, "", MapResponse{
			GeoJson: geoJson,
			Color:   route.RouteColor,
		})
	})

	//Finds a walking route from lat,lon to lat,lon using osrm
	navigationRoute.POST("/nav", func(c echo.Context) error {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
		defer cancel()

		slatStr := c.FormValue("startLat")
		slonStr := c.FormValue("startLon")
		elatStr := c.FormValue("endLat")
		elonStr := c.FormValue("endLon")
		method := c.FormValue("method")

		if method == "" {
			return JsonApiResponse(c, http.StatusBadRequest, "missing movement method", nil, ResponseDetails("method", method, "details", "Method is required to determine the type of navigation"))
		}

		// Convert lat and lon to float64
		slat, err := strconv.ParseFloat(slatStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid start lat", nil, ResponseDetails("startLat", slatStr, "details", "Invalid start latitude format", "error", err.Error()))
		}

		slon, err := strconv.ParseFloat(slonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid start lon", nil, ResponseDetails("startLon", slonStr, "details", "Invalid start longitude format", "error", err.Error()))
		}

		elat, err := strconv.ParseFloat(elatStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid end lat", nil, ResponseDetails("endLat", elatStr, "details", "Invalid end latitude format", "error", err.Error()))
		}

		elon, err := strconv.ParseFloat(elonStr, 64)
		if err != nil {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid end lon", nil, ResponseDetails("endLon", elonStr, "details", "Invalid end longitude format", "error", err.Error()))
		}

		if slat == 0 || slon == 0 {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid start lat & lon", nil, ResponseDetails("startLat", slatStr, "startLon", slonStr))
		}
		if elat == 0 || elon == 0 {
			return JsonApiResponse(c, http.StatusBadRequest, "invalid end lat & lon", nil, ResponseDetails("endLat", elatStr, "endLon", elonStr))
		}

		start := Coordinates{Lat: slat, Lon: slon} // Start point
		end := Coordinates{Lat: elat, Lon: elon}   // End point

		var result GeoJSONResponse
		done := make(chan struct{})

		go func() {
			defer close(done)
			switch method {
			case "walking":
				result = GetWalkingDirections(start, end)
			default:
				JsonApiResponse(c, http.StatusBadRequest, "invalid movement method", nil, ResponseDetails("method", method, "details", "Method is required to determine the type of navigation"))
				return
			}
		}()

		select {
		case <-ctx.Done():
			log.Println("Request timed out")
			return JsonApiResponse(c, http.StatusRequestTimeout, "", nil, ResponseDetails("details", "Request timed out while fetching route data"))
		case <-done:
			if len(result.Features) == 0 {
				return JsonApiResponse(c, http.StatusNotFound, "", nil, ResponseDetails("details", "No route found for the given coordinates"))
			}
			return JsonApiResponse(c, http.StatusOK, "", result)
		}
	})
}

type Coordinates struct {
	Lat, Lon float64
}

// GeoJSON structure for the desired response format
type GeoJSONResponse struct {
	Type         string    `json:"type"`
	Features     []Feature `json:"features"`
	Instructions string    `json:"instructions"`
	Duration     float64   `json:"duration"` // Duration in seconds
	Distance     float64   `json:"distance"`
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
	body, err := io.ReadAll(resp.Body)
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
				Distance float64 `json:"distance"`
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
		Distance: 0,
	}

	// Collect directions as text, filtering out empty instructions
	var directions []string
	for _, step := range osrmResponse.Routes[0].Legs[0].Steps {
		if step.Maneuver.Modifier != "" {
			geoJSONResponse.Distance = geoJSONResponse.Distance + step.Distance
			var direction string
			if step.Name == "" {
				direction = fmt.Sprintf("%s for %.1f meters", step.Maneuver.Modifier, step.Distance)
			} else {
				direction = fmt.Sprintf("%s onto %s for %.1f meters", step.Maneuver.Modifier, step.Name, step.Distance)
			}

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
