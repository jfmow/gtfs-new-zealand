package basemap

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

var BasemapRateLimiterConfig = middleware.RateLimiterConfig{
	Skipper: middleware.DefaultSkipper,

	Store: middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{
			Rate:      300,
			Burst:     600,
			ExpiresIn: 2 * time.Minute,
		},
	),

	IdentifierExtractor: func(ctx echo.Context) (string, error) {
		return ctx.RealIP(), nil
	},

	ErrorHandler: func(ctx echo.Context, err error) error {
		return ctx.JSON(http.StatusInternalServerError, map[string]string{
			"error": "rate limit middleware error",
		})
	},

	DenyHandler: func(ctx echo.Context, identifier string, err error) error {
		return ctx.JSON(http.StatusTooManyRequests, map[string]string{
			"error":       "too many requests",
			"identifier":  identifier,
			"retry_after": "60",
		})
	},
}

func LINZBasemapProxy(c echo.Context) error {
	apiKey := os.Getenv("LINZ_API_KEY")
	if apiKey == "" {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "API key is not defined"})
	}

	z := c.PathParam("z")
	x := c.PathParam("x")
	y := c.PathParam("y")

	// Validate that z, x, y are integers to prevent URL injection
	if _, err := strconv.Atoi(z); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid z parameter"})
	}
	if _, err := strconv.Atoi(x); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid x parameter"})
	}
	if _, err := strconv.Atoi(y); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid y parameter"})
	}

	targetURL := "https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/" + z + "/" + x + "/" + y + ".png"

	// Append API key
	u, err := url.Parse(targetURL)
	if err != nil {
		log.Printf("Error parsing URL: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Invalid target URL"})
	}
	query := u.Query()
	query.Set("api", apiKey)
	u.RawQuery = query.Encode()

	// Forward the request (GET only, as this is an image tile)
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		log.Printf("Error creating request: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed to create request"})
	}
	// Copy only relevant headers
	req.Header.Set("Accept", "image/webp,image/*,*/*;q=0.8")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error fetching data: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Error fetching data"})
	}
	defer resp.Body.Close()

	// Set the content type to match the upstream response
	c.Response().Header().Set(echo.HeaderContentType, resp.Header.Get("Content-Type"))
	c.Response().WriteHeader(resp.StatusCode)
	_, err = io.Copy(c.Response().Writer, resp.Body)
	if err != nil {
		log.Printf("Error writing image response: %v", err)
	}
	return nil
}
