# ---- Build stage ----
FROM golang:1.23-alpine AS builder

# Build deps for CGO (gcc, musl-dev, etc.)
RUN apk add --no-cache build-base tzdata

WORKDIR /src

# Cache deps
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build linux/amd64 binary with CGO enabled
ENV CGO_ENABLED=1 \
    GOOS=linux \
    GOARCH=amd64

RUN go build -o /trains/base .

# ---- Runtime stage ----
FROM alpine:3.20.2

# Install tzdata for time zone info
RUN apk add --no-cache tzdata

ENV TZ=UTC \
    AT_APIKEY="" \
    port="8085" \
    OSRM_URL="http://router.project-osrm.org/route/v1/walking/" \
    GOMEMLIMIT="500MiB"

# Copy the built binary from the builder stage
COPY --from=builder /trains/base /trains/base

RUN chmod +x /trains/base

EXPOSE 8085

CMD ["/bin/sh", "-c", "/trains/base --http=0.0.0.0:$port"]
