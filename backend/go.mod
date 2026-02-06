module github.com/jfmow/at-trains-api

go 1.22

toolchain go1.23.4

require (
	github.com/SherClockHolmes/webpush-go v1.4.0
	github.com/google/uuid v1.6.0
	github.com/jfmow/gtfs v1.2.0
	github.com/jmoiron/sqlx v1.4.0
	github.com/joho/godotenv v1.5.1
	github.com/labstack/echo/v5 v5.0.0-20230722203903-ec5b858dab61
	github.com/mattn/go-sqlite3 v1.14.24
	github.com/paulmach/orb v0.11.1
	github.com/robfig/cron/v3 v3.0.0
	github.com/sirupsen/logrus v1.9.3
	gopkg.in/natefinch/lumberjack.v2 v2.2.1
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/golang-jwt/jwt/v5 v5.2.1 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	go.mongodb.org/mongo-driver v1.11.4 // indirect
	golang.org/x/crypto v0.31.0 // indirect
	golang.org/x/net v0.27.0 // indirect
	golang.org/x/sys v0.28.0 // indirect
	golang.org/x/time v0.5.0 // indirect
	google.golang.org/protobuf v1.36.6 // indirect
	modernc.org/gc/v3 v3.0.0-20240107210532-573471604cb6 // indirect
	modernc.org/libc v1.55.3 // indirect
	modernc.org/mathutil v1.6.0 // indirect
	modernc.org/memory v1.8.0 // indirect
	modernc.org/sqlite v1.33.1 // indirect
	modernc.org/strutil v1.2.0 // indirect
	modernc.org/token v1.1.0 // indirect
)

//replace github.com/jfmow/gtfs => ../../gtfs
