package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jfmow/at-trains-api/providers"
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

var localTimeZone, _ = time.LoadLocation("Pacific/Auckland")

//var aestZone, _ = time.LoadLocation("Australia/Sydney") // or Brisbane, etc.

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
	//mlApi := e.Group("/wel")
	//seqAPI := e.Group("/seq")
	//christchurchApi := e.Group("/christ")

	//Auckland Transport
	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Auckland transport api key Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://gtfs.at.govt.nz/gtfs.zip", gtfs.ApiKey{Header: "", Value: ""}, "atfgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	AucklandTransportRealtimeData, err := rt.NewClient(atApiKey, "Ocp-Apim-Subscription-Key", 20*time.Second, "https://api.at.govt.nz/realtime/legacy/vehiclelocations", "https://api.at.govt.nz/realtime/legacy/tripupdates", "https://api.at.govt.nz/realtime/legacy/servicealerts")
	if err != nil {
		panic(err)
	}

	providers.SetupProvider(atApi, AucklandTransportGTFSData, AucklandTransportRealtimeData, localTimeZone)

	/*//MetLink
	metlinkApiKey, found := os.LookupEnv("WEL_APIKEY")
	if !found {
		panic("metlink api key Env not found")
	}

	MetLinkGTFSData, err := gtfs.New("https://static.opendata.metlink.org.nz/v1/gtfs/full.zip", gtfs.ApiKey{Header: "", Value: ""}, "welgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	MetLinkRealtimeData, err := rt.NewClient(metlinkApiKey, "x-api-key", 10*time.Second, "https://api.opendata.metlink.org.nz/v1/gtfs-rt/vehiclepositions", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/tripupdates", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/servicealerts")
	if err != nil {
		panic(err)
	}

	providers.SetupProvider(mlApi, MetLinkGTFSData, MetLinkRealtimeData, localTimeZone)

	christchurchApiKey, found := os.LookupEnv("CHRISTCHURCH_APIKEY")
	if !found {
		panic("Christchurch api key Env not found")
	}

	ChristChurchGTFSData, err := gtfs.New("https://apis.metroinfo.co.nz/rti/gtfs/v1/gtfs.zip", gtfs.ApiKey{Header: "Ocp-Apim-Subscription-Key", Value: christchurchApiKey}, "christgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	ChristChurchRealtimeData, err := rt.NewClient(christchurchApiKey, "Ocp-Apim-Subscription-Key", 20*time.Second, "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/vehicle-positions.pb", "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/trip-updates.pb", "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/service-alerts.pb")
	if err != nil {
		panic(err)
	}

	providers.SetupProvider(christchurchApi, ChristChurchGTFSData, ChristChurchRealtimeData, localTimeZone)
	*/
	/*
		SEQGTFSData, err := gtfs.New("https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip", gtfs.ApiKey{Header: "", Value: ""}, "seqGTFS", aestZone, "hi@suddsy.dev")
		if err != nil {
			fmt.Println("Error loading at gtfs db")
		}

		SEQRealtimeData, err := rt.NewClient("", "", 20*time.Second, "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions", "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates", "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/alerts")
		if err != nil {
			panic(err)
		}

		providers.SetupProvider(seqAPI, SEQGTFSData, SEQRealtimeData, aestZone)
	*/
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
	fmt.Println("Server is running on: http://" + ip + ":" + port + "/")
	s := http.Server{Addr: ip + ":" + port, Handler: e}
	if err := s.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
