#!/usr/bin/env bash
# Starts the bundled OSRM walking router (when OSRM_PBF_URL is set) alongside
# the API. Without OSRM_PBF_URL the API just uses OSRM_URL as before.
#
#   OSRM_PBF_URL   one or more .osm.pbf sources (space or comma separated).
#                  Each is a URL, optionally cropped to a bounding box with
#                  |minLon,minLat,maxLon,maxLat, e.g.
#                    https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf,
#                    https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf|152.0,-28.3,153.7,-26.0
#                  Several sources are merged into one routing graph.
#   OSRM_PROFILE   lua profile to build with (default /opt/foot.lua)
#   OSRM_REBUILD   set to 1 to re-download and rebuild the graph on start
#   OSRM_PORT      port the bundled router listens on (default 5000, loopback only)
#
# The graph and the downloads are cached in $DATA_DIR/osrm, so they're only
# fetched/built once per volume. If a build fails (usually out of memory) the
# API still starts, on OSRM_URL, and the build isn't retried until the sources
# change or OSRM_REBUILD=1.
set -euo pipefail
shopt -s inherit_errexit

# /trains/gtfs is a symlink to /data/gtfs, which must exist before the gtfs
# library opens its DB.
mkdir -p "${DATA_DIR:-/data}" /data/gtfs

OSRM_DATA_DIR="${DATA_DIR:-/data}/osrm"
OSRM_PROFILE="${OSRM_PROFILE:-/opt/foot.lua}"
OSRM_PORT="${OSRM_PORT:-5000}"

log() { echo "[osrm] $*"; }

# fetch URL -> prints the cached path, downloading only when it isn't cached
# yet (or OSRM_REBUILD=1). Geofabrik extracts are ~1 GB, so a crash-looping
# container mustn't pull them on every start.
fetch() {
	local url="$1"
	local dest
	dest="$OSRM_DATA_DIR/src/$(printf '%s' "$url" | sha1sum | cut -c1-16).osm.pbf"
	mkdir -p "$OSRM_DATA_DIR/src"
	if [ "${OSRM_REBUILD:-0}" = "1" ] || [ ! -s "$dest" ]; then
		log "downloading $url" >&2
		curl -fL --retry 3 -sS -o "$dest.part" "$url"
		mv "$dest.part" "$dest"
	else
		log "using cached $url" >&2
	fi
	printf '%s' "$dest"
}

build_graph() {
	local work="$OSRM_DATA_DIR/build"
	rm -rf "$work"
	mkdir -p "$work"

	local pbfs=()
	local i=0
	for entry in "$@"; do
		local url="${entry%%|*}" bbox=""
		[ "$url" != "$entry" ] && bbox="${entry#*|}"

		local src
		src="$(fetch "$url")"

		local input="$src"
		if [ -n "$bbox" ]; then
			log "cropping to $bbox"
			osmium extract -b "$bbox" "$src" -o "$work/crop$i.osm.pbf" --overwrite
			input="$work/crop$i.osm.pbf"
		fi

		# Keep only what foot.lua's process_way looks at (plus the nodes those
		# ways reference). Buildings, land use etc. are most of an extract and
		# blow osrm-extract's memory for nothing.
		log "filtering to walkable ways"
		osmium tags-filter "$input" \
			w/highway w/route=ferry w/bridge w/man_made=pier w/railway=platform \
			w/platform w/amenity=parking,parking_entrance w/public_transport=platform \
			r/type=restriction \
			-o "$work/part$i.osm.pbf" --overwrite
		[ "$input" != "$src" ] && rm -f "$input"

		pbfs+=("$work/part$i.osm.pbf")
		i=$((i + 1))
	done

	if [ "${#pbfs[@]}" -gt 1 ]; then
		log "merging ${#pbfs[@]} extracts"
		osmium merge "${pbfs[@]}" -o "$work/map.osm.pbf" --overwrite
		rm -f "${pbfs[@]}"
	else
		mv "${pbfs[0]}" "$work/map.osm.pbf"
	fi

	log "extracting with $OSRM_PROFILE"
	osrm-extract -p "$OSRM_PROFILE" "$work/map.osm.pbf"
	osrm-partition "$work/map.osrm"
	osrm-customize "$work/map.osrm"
	rm -f "$work/map.osm.pbf"

	# Swap the finished graph in only once every step succeeded, so a failed
	# rebuild leaves the previous graph usable.
	rm -rf "$OSRM_DATA_DIR/current"
	mv "$work" "$OSRM_DATA_DIR/current"
	log "graph ready"
}

# Sets OSRM_READY=1 once osrm-routed is serving; leaves it 0 when there's no
# usable graph, so the API runs on OSRM_URL instead.
OSRM_READY=0
start_osrm() {
	mkdir -p "$OSRM_DATA_DIR"
	# Split on whitespace and on commas that start a new URL (a bbox has commas too).
	local spec="${OSRM_PBF_URL//,http/ http}"
	read -r -a entries <<<"$spec"

	local want
	want="$(printf '%s\n' "${entries[@]}" "$OSRM_PROFILE")"

	if [ "${OSRM_REBUILD:-0}" != "1" ] &&
		[ -f "$OSRM_DATA_DIR/current/map.osrm.mldgr" ] &&
		[ "$(cat "$OSRM_DATA_DIR/current/.source" 2>/dev/null)" = "$want" ]; then
		log "reusing graph in $OSRM_DATA_DIR/current"
	elif [ "${OSRM_REBUILD:-0}" != "1" ] &&
		[ "$(cat "$OSRM_DATA_DIR/.failed" 2>/dev/null)" = "$want" ]; then
		log "last build from these sources failed; not retrying (set OSRM_REBUILD=1 to try again)"
		return
	else
		# Subshell so a failing step lands here instead of killing the container,
		# which would only restart into the same failure. Not called from an
		# `if`: bash ignores set -e inside a condition, even in a subshell.
		set +e
		(
			set -e
			build_graph "${entries[@]}"
		)
		local rc=$?
		set -e
		if [ "$rc" -eq 0 ]; then
			printf '%s\n' "$want" >"$OSRM_DATA_DIR/current/.source"
			rm -f "$OSRM_DATA_DIR/.failed"
		else
			log "graph build failed (out of memory? try a smaller extract or a bbox)"
			printf '%s\n' "$want" >"$OSRM_DATA_DIR/.failed"
			rm -rf "$OSRM_DATA_DIR/build"
			[ -f "$OSRM_DATA_DIR/current/map.osrm.mldgr" ] || return 0
			log "falling back to the previous graph"
		fi
	fi

	osrm-routed --algorithm mld --ip 127.0.0.1 --port "$OSRM_PORT" \
		"$OSRM_DATA_DIR/current/map.osrm" &
	OSRM_PID=$!

	for _ in $(seq 1 120); do
		if (exec 3<>"/dev/tcp/127.0.0.1/$OSRM_PORT") 2>/dev/null; then
			log "listening on 127.0.0.1:$OSRM_PORT"
			OSRM_READY=1
			return
		fi
		kill -0 "$OSRM_PID" 2>/dev/null || { log "osrm-routed exited during startup"; exit 1; }
		sleep 1
	done
	log "osrm-routed did not start listening in time"
	exit 1
}

if [ -z "${OSRM_PBF_URL:-}" ]; then
	exec /trains/base --http="0.0.0.0:${port}"
fi

start_osrm
if [ "$OSRM_READY" != "1" ]; then
	log "bundled router unavailable; walking routes use OSRM_URL=${OSRM_URL:-<unset>}"
	exec /trains/base --http="0.0.0.0:${port}"
fi
export OSRM_URL="http://127.0.0.1:$OSRM_PORT"

/trains/base --http="0.0.0.0:${port}" &
APP_PID=$!

trap 'kill -TERM "$APP_PID" "$OSRM_PID" 2>/dev/null' TERM INT

# If either process dies, take the container down so the orchestrator restarts it.
set +e
wait -n "$APP_PID" "$OSRM_PID"
status=$?
kill -TERM "$APP_PID" "$OSRM_PID" 2>/dev/null
wait
exit "$status"
