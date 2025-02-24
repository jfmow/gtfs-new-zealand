package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jfmow/at-trains-api/providers/at"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

var rateLimiterConfig = middleware.RateLimiterConfig{
	Skipper: middleware.DefaultSkipper,
	Store: middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{Rate: 10, Burst: 30, ExpiresIn: 3 * time.Minute},
	),
	IdentifierExtractor: func(ctx echo.Context) (string, error) {
		id := ctx.RealIP()
		return id, nil
	},
	ErrorHandler: func(context echo.Context, err error) error {
		return context.JSON(http.StatusForbidden, nil)
	},
	DenyHandler: func(context echo.Context, identifier string, err error) error {
		return context.JSON(http.StatusTooManyRequests, nil)
	},
}

var localTimeZone = time.FixedZone("NZST", 13*60*60)

func main() {
	//Loads a .env file in the current dir
	err := godotenv.Load()
	if err != nil {
		fmt.Println("Error loading .env file")
	}

	e := echo.New()

	//Enables rate limiter middleware for the following routes
	e.Use(middleware.RateLimiterWithConfig(rateLimiterConfig))

	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "OPTIONS"},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	atApi := e.Group("/at")
	mlApi := e.Group("/wel")

	//Auckland Transport
	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://gtfs.at.govt.nz/gtfs.zip", "atfgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	AucklandTransportRealtimeData, err := rt.NewClient(atApiKey, "Ocp-Apim-Subscription-Key", 20*time.Second, "https://api.at.govt.nz/realtime/legacy/vehiclelocations", "https://api.at.govt.nz/realtime/legacy/tripupdates", "https://api.at.govt.nz/realtime/legacy/servicealerts")
	if err != nil {
		panic(err)
	}

	at.SetupProvider(atApi, AucklandTransportGTFSData, AucklandTransportRealtimeData)

	//MetLink
	metlinkApiKey, found := os.LookupEnv("WEL_APIKEY")
	if !found {
		panic("Env not found")
	}

	MetLinkGTFSData, err := gtfs.New("https://static.opendata.metlink.org.nz/v1/gtfs/full.zip", "welgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	MetLinkRealtimeData, err := rt.NewClient(metlinkApiKey, "x-api-key", 20*time.Second, "https://api.opendata.metlink.org.nz/v1/gtfs-rt/vehiclepositions", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/tripupdates", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/servicealerts")
	if err != nil {
		panic(err)
	}

	at.SetupProvider(mlApi, MetLinkGTFSData, MetLinkRealtimeData)

	var httpAddr string
	flag.StringVar(&httpAddr, "http", "0.0.0.0:8090", "HTTP server address (IP:Port)")

	// Parse command line flags
	flag.Parse()

	// Split the address into IP and port
	httpParts := strings.Split(httpAddr, ":")
	if len(httpParts) != 2 {
		log.Fatal("Invalid --http address format. Use IP:PORT")
	}

	var port = httpParts[1]

	ip := httpParts[0] // Extract the IP address

	portEnv, found := os.LookupEnv("port")
	if found {
		port = portEnv
	}

	// Start server using the extracted IP and port
	if err := e.Start(fmt.Sprintf("%s:%s", ip, port)); err != nil {
		log.Fatal(err)
	}
}
