package at

import (
	"fmt"
	"os"

	"github.com/jfmow/gtfs"
	rt "github.com/jfmow/gtfs/realtime"
	"github.com/labstack/echo/v5"
)

func SetupAucklandTransportAPI(router *echo.Group) {

	//Looks for the at api key from the loaded env vars or sys env if docker
	atApiKey, found := os.LookupEnv("AT_APIKEY")
	if !found {
		panic("Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://gtfs.at.govt.nz/gtfs.zip", "atfgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	realtimeData, err := rt.New(atApiKey, "Ocp-Apim-Subscription-Key", "atrt")
	if err != nil {
		panic(err)
	}

	SetupProvider(router, AucklandTransportGTFSData, realtimeData, "https://api.at.govt.nz/realtime/legacy/vehiclelocations", "https://api.at.govt.nz/realtime/legacy/tripupdates", "https://api.at.govt.nz/realtime/legacy/servicealerts")
}

func SetupMetlinkTransportAPI(router *echo.Group) {

	//Looks for the at api key from the loaded env vars or sys env if docker
	metlinkApiKey, found := os.LookupEnv("WEL_APIKEY")
	if !found {
		panic("Env not found")
	}

	AucklandTransportGTFSData, err := gtfs.New("https://static.opendata.metlink.org.nz/v1/gtfs/full.zip", "welgtfs", localTimeZone, "hi@suddsy.dev")
	if err != nil {
		fmt.Println("Error loading at gtfs db")
	}

	realtimeData, err := rt.New(metlinkApiKey, "x-api-key", "metrt")
	if err != nil {
		panic(err)
	}

	SetupProvider(router, AucklandTransportGTFSData, realtimeData, "https://api.opendata.metlink.org.nz/v1/gtfs-rt/vehiclepositions", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/tripupdates", "https://api.opendata.metlink.org.nz/v1/gtfs-rt/servicealerts")
}
