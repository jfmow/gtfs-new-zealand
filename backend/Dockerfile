FROM alpine:3.20.2

# Install tzdata package to get time zone information
RUN apk add --no-cache tzdata

# Copy the zip file from the local directory to the image
COPY ./base /pb/base

ENV AT_APIKEY="" \
    port="8085" \
    OSRM_URL="http://router.project-osrm.org/route/v1/walking/"\
    REDIS_URL=""
RUN chmod +x /pb/base

# Expose the default port
EXPOSE 8085

# Start PocketBase
CMD ["/bin/sh", "-c", "/pb/base --http=0.0.0.0:$port"]
