# syntax=docker/dockerfile:1.7

########################
# Build stage
########################
FROM --platform=$TARGETPLATFORM golang:1.24-alpine AS builder

# We need a compiler + libc headers for CGO
RUN apk add --no-cache build-base tzdata

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
FROM alpine:latest

# Install tzdata package to get time zone information
RUN apk add --no-cache tzdata

ENV TZ=UTC \
    AT_APIKEY="" \
    port="8085" \
    OSRM_URL="http://router.project-osrm.org/route/v1/walking/" \
    GOMEMLIMIT="500MiB"

# Copy the binary built in the builder stage
COPY --from=builder /trains/base /trains/base

RUN chmod +x /trains/base

# Expose the default port
EXPOSE 8085

# Start your app
CMD ["/bin/sh", "-c", "/trains/base --http=0.0.0.0:$port"]
