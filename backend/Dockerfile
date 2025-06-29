# Stage 1: Build Go binary for target platform
FROM golang:1.23.4-alpine AS builder

WORKDIR /app

# Install git if your module dependencies require it
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build the Go binary for the target platform (auto)
RUN go build -o base .

# Stage 2: Minimal runtime image
FROM alpine:3.20.2

# Install tzdata package to get time zone info
RUN apk add --no-cache tzdata

ENV TZ=UTC

# Copy the compiled binary from builder stage
COPY --from=builder /app/base /trains/base

ENV AT_APIKEY="" \
    port="8085" \
    OSRM_URL="http://router.project-osrm.org/route/v1/walking/" \
    GOMEMLIMIT="500MiB"

RUN chmod +x /trains/base

EXPOSE 8085

CMD ["/bin/sh", "-c", "/trains/base --http=0.0.0.0:$port"]
