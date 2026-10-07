# syntax=docker/dockerfile:1.7

########################
# Build stage
########################
# Debian (glibc) rather than alpine so the CGO binary runs on the OSRM runtime
# image below. gcc and git are already in this image; git lets `go mod
# download` fetch a module straight from its VCS when proxy.golang.org hasn't
# cached the tag yet.
FROM --platform=$TARGETPLATFORM golang:1.24-bookworm AS builder

WORKDIR /src

# Cache Go deps
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# TARGETARCH is provided by buildx (amd64, arm, etc.)
ARG TARGETARCH

ENV CGO_ENABLED=1 \
    GOOS=linux

# Build per-arch, adding GOARM=7 for Raspberry Pi (32-bit armv7)
RUN if [ "$TARGETARCH" = "arm" ]; then \
    echo "Building CGO binary for linux/arm/v7"; \
    GOARCH=arm GOARM=7 go build -o /trains/base .; \
    else \
    echo "Building CGO binary for linux/$TARGETARCH"; \
    GOARCH=$TARGETARCH go build -o /trains/base .; \
    fi


########################
# Runtime stage
########################
# The official OSRM image (Debian trixie) supplies osrm-extract/-partition/
# -customize/-routed and the lua profiles in /opt. It only publishes amd64 and
# arm64, so there's no arm/v7 build any more.
FROM ghcr.io/project-osrm/osrm-backend:v26.10.0-debian

# curl downloads the .osm.pbf; osmium crops, filters and merges extracts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata ca-certificates curl osmium-tool \
    && rm -rf /var/lib/apt/lists/*

# Everything the container writes lives under DATA_DIR, so compose only needs
# one volume on /data:
#   /data/gtfs           gtfs-<region>.db (static feeds; /trains/gtfs links here)
#   /data/logs           api.log
#   /data/notifications  notifications.db (push subscriptions, reminders)
#   /data/plans          plans.db (shared journey plans)
#   /data/osrm           the bundled OSRM walking graph
#
# Walking routes, pick one:
#   OSRM_PBF_URL set    build a graph from these .osm.pbf URLs (comma or space
#                       separated; several are merged; append
#                       |minLon,minLat,maxLon,maxLat to crop one) and serve it
#                       on 127.0.0.1:OSRM_PORT instead of OSRM_URL. If the
#                       build fails the API falls back to OSRM_URL.
#   OSRM_PBF_URL empty  use the external OSRM server at OSRM_URL.
# OSRM_REBUILD=1 forces a fresh download + build on the next start (unset it
# again afterwards, or every restart rebuilds).
ENV TZ=UTC \
    port="8085" \
    GOMEMLIMIT="500MiB" \
    DATA_DIR="/data" \
    AT_APIKEY="" \
    OSRM_URL="http://router.project-osrm.org/" \
    OSRM_PBF_URL="" \
    OSRM_PROFILE="/opt/foot.lua" \
    OSRM_PORT="5000" \
    OSRM_REBUILD="0"

COPY --from=builder /trains/base /trains/base
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The gtfs library always puts its DB beside the binary (/trains/gtfs), so
# point that at the volume too.
RUN chmod +x /trains/base /usr/local/bin/docker-entrypoint.sh \
    && ln -s /data/gtfs /trains/gtfs

VOLUME /data
EXPOSE 8085

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
