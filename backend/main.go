package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jfmow/at-trains-api/basemap"
	"github.com/jfmow/at-trains-api/providers"
	"github.com/jfmow/at-trains-api/providers/caches"
	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	"github.com/sirupsen/logrus"
	"gopkg.in/natefinch/lumberjack.v2"
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

// region bundles everything needed to stand up one transit region's API.
type region struct {
	name    string
	group   *echo.Group
	gtfsURL string
	gtfsKey gtfs.ApiKey
	dbName  string

	rtKey      string
	rtHeader   string
	rtInterval time.Duration
	rtVehicles string
	rtTrips    string
	rtAlerts   string

	gtfs   gtfs.Database
	rt     rt.Realtime
	rtErr  error
	caches caches.Caches
}

//var aestZone, _ = time.LoadLocation("Australia/Brisbane")

func main() {
	//Loads a .env file in the current dir
	err := godotenv.Load()
	if err != nil {
		fmt.Println("Error loading .env file")
	}

	logrus.SetOutput(&lumberjack.Logger{
		Filename:   filepath.Join(getWorkDir(), "logs", "api.log"),
		MaxSize:    100, // megabytes
		MaxBackups: 10,
		MaxAge:     7,    // days
		Compress:   true, // gzip old logs
	})
	logrus.SetFormatter(&logrus.JSONFormatter{})

	e := echo.New()

	nzApi := e.Group("/nz")
	nzApi.Use(middleware.RateLimiterWithConfig(basemap.BasemapRateLimiterConfig))

	nzApi.GET("/tiles/:z/:x/:y", basemap.LINZBasemapProxy)

	//Enables rate limiter middleware for the following routes
	e.Use(TraceIDMiddleware())
	e.Use(RequestLoggerMiddleware())

	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "OPTIONS"},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization, "X-Trace-ID"},
	}))

	//e.GET("/logs", GetLogsHandler)

	atApi := e.Group("/at")
	atApi.Use(middleware.RateLimiterWithConfig(rateLimiterConfig))
	mlApi := e.Group("/wel")
	//seqAPI := e.Group("/seq")
	christchurchApi := e.Group("/christ")

	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Auckland transport api key Env not found")
	}
	metlinkApiKey, found := os.LookupEnv("WEL_APIKEY")
	if !found {
		panic("metlink api key Env not found")
	}
	christchurchApiKey, found := os.LookupEnv("CHRISTCHURCH_APIKEY")
	if !found {
		panic("Christchurch api key Env not found")
	}

	regions := []*region{
		{
			name: "at", group: atApi,
			gtfsURL: "https://gtfs.at.govt.nz/gtfs.zip", dbName: "atfgtfs",
			rtKey: atApiKey, rtHeader: "Ocp-Apim-Subscription-Key", rtInterval: 17 * time.Second,
			rtVehicles: "https://api.at.govt.nz/realtime/legacy/vehiclelocations",
			rtTrips:    "https://api.at.govt.nz/realtime/legacy/tripupdates",
			rtAlerts:   "https://api.at.govt.nz/realtime/legacy/servicealerts",
		},
		{
			name: "wel", group: mlApi,
			gtfsURL: "https://static.opendata.metlink.org.nz/v1/gtfs/full.zip", dbName: "welgtfs",
			rtKey: metlinkApiKey, rtHeader: "x-api-key", rtInterval: 5 * time.Second,
			rtVehicles: "https://api.opendata.metlink.org.nz/v1/gtfs-rt/vehiclepositions",
			rtTrips:    "https://api.opendata.metlink.org.nz/v1/gtfs-rt/tripupdates",
			rtAlerts:   "https://api.opendata.metlink.org.nz/v1/gtfs-rt/servicealerts",
		},
		{
			name: "christ", group: christchurchApi,
			gtfsURL: "https://apis.metroinfo.co.nz/rti/gtfs/v1/gtfs.zip", dbName: "christgtfs",
			gtfsKey: gtfs.ApiKey{Header: "Ocp-Apim-Subscription-Key", Value: christchurchApiKey},
			rtKey:   christchurchApiKey, rtHeader: "Ocp-Apim-Subscription-Key", rtInterval: 20 * time.Second,
			rtVehicles: "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/vehicle-positions.pb",
			rtTrips:    "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/trip-updates.pb",
			rtAlerts:   "https://apis.metroinfo.co.nz/rti/gtfsrt/v1/service-alerts.pb",
		},
	}

	// The three regions are independent (separate DB files, separate route
	// groups) - build each region's GTFS DB + realtime client in parallel, so
	// startup is bounded by the slowest single region rather than their sum.
	// Concurrency is capped at 2 so that a cold start where all three DBs need
	// a full rebuild (each buffering a GTFS zip) stays within the memory limit.
	var wg sync.WaitGroup
	sem := make(chan struct{}, 2)
	for _, r := range regions {
		wg.Add(1)
		go func(r *region) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			data, err := gtfs.New(r.gtfsURL, r.gtfsKey, r.dbName, localTimeZone, "hi@suddsy.dev")
			if err != nil {
				fmt.Printf("Error loading %s gtfs db: %v\n", r.name, err)
			}
			r.gtfs = data
			client, err := rt.NewClient(r.rtKey, r.rtHeader, r.rtInterval, r.rtVehicles, r.rtTrips, r.rtAlerts, *localTimeZone)
			if err != nil {
				r.rtErr = err
				return
			}
			r.rt = client
			// Warm this region's DB-backed caches here too - it's the other
			// heavy synchronous step and, like gtfs.New, only touches this
			// region's own SQLite file.
			r.caches = caches.CreateCaches(data)
		}(r)
	}
	wg.Wait()

	// Route registration touches shared echo state, so it runs serially after
	// the parallel per-region build + cache warm-up.
	for _, r := range regions {
		if r.rtErr != nil {
			panic(r.rtErr)
		}
		providers.SetupProvider(r.group, r.gtfs, r.rt, r.name, localTimeZone, r.caches)
	}
	/*
		SEQGTFSData, err := gtfs.New("https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip", gtfs.ApiKey{Header: "", Value: ""}, "seqGTFS", aestZone, "hi@suddsy.dev")
		if err != nil {
			fmt.Println("Error loading at gtfs db")
		}

		SEQRealtimeData, err := rt.NewClient("", "", 15*time.Second, "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions", "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates", "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/alerts")
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

func getWorkDir() string {
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
