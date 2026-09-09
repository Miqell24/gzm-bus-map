#!/usr/bin/env bash
# Downloads input data: two GTFS feeds (ZTM GZM, Koleje Śląskie), the OSM
# networks (Geofabrik + pyosmium) and MapLibre GL.
# Everything is cached — re-running only fetches what is missing.
#
# GZM quirk: like Poznań, ONE feed carries all modes (route_type 0 trams,
# 3 buses, 11 trolleybuses in Tychy) — build.mjs separates them by route_type.
# The open-data portal publishes several dated snapshots per day; we ask the
# CKAN API for the newest ZIP resource instead of hardcoding a dated URL.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/gtfs-ks data/osm web/vendor

# A downloaded extract is only accepted if it PARSES and carries a plausible
# number of elements. `grep -q '"elements"'` — the guard this family used
# everywhere — passes on a truncated response too: Brașov's roads arrived as a
# 65 kB fragment that still contained the string, was taken for complete, and
# silently skipped the city (16.08.2026).
# The minimum differs by extract: a road network runs to tens of thousands of
# ways, a tram network to a few hundred, so the caller passes its own floor
# rather than sharing one.
# A rejected file is deleted rather than left behind — the `[ ! -f … ]` gates
# below only ask whether the file exists, so a fragment on disk would be taken
# for a finished download on the next run.
ok_json () { # $1=file  $2=minimum element count
  python3 - "$1" "$2" <<'PYEOF' 2>/dev/null
import json, sys
try:
    sys.exit(0 if len(json.load(open(sys.argv[1])).get("elements", [])) >= int(sys.argv[2]) else 1)
except Exception:
    sys.exit(1)
PYEOF
}

# 1) GTFS — ZTM GZM (extended GTFS: *_ext.txt files ride along, we ignore them)
if [ ! -f data/gtfs/routes.txt ]; then
  echo "== ZTM GZM GTFS =="
  URL=$(curl -fsS "https://otwartedane.metropoliagzm.pl/api/3/action/package_show?id=rozklady-jazdy-i-lokalizacja-przystankow-gtfs-wersja-rozszerzona" \
    | python3 -c "import json,sys; rs=[r for r in json.load(sys.stdin)['result']['resources'] if r['format']=='ZIP']; print(rs[-1]['url'])")
  echo "-- $URL"
  curl -fL --retry 3 --max-time 600 -o data/ztm_gzm_gtfs.zip "$URL"
  unzip -o data/ztm_gzm_gtfs.zip -d data/gtfs
fi

# 1b) GTFS — Koleje Śląskie, the voivodeship's rail operator. Their own file
#     (koleje-ks.pl, the one odt.org.pl lists), a route per origin–destination
#     pair: eleven of them ride under S82 alone, which is what the
#     representative-variant rule in build.mjs is for.
if [ ! -f data/gtfs-ks/routes.txt ]; then
  echo "== Koleje Śląskie GTFS =="
  curl -fL --retry 3 --max-time 600 -o data/ks-gtfs.zip "https://koleje-ks.pl/gtfs/2025-2026.zip"
  unzip -o data/ks-gtfs.zip -d data/gtfs-ks
fi

# 2) OSM — from the Geofabrik voivodeship extracts, not Overpass. On 9.09.2026
#    every public mirror answered these queries with 504 for an hour (the wall
#    Berlin, London, São Paulo and Vienna hit before), so the cuts are made
#    locally: pipeline/pbf-cut.py (needs `pip3 install --user osmium`) writes
#    exactly the JSON Overpass would have returned, node ids included, for
#    three boxes — the Metropolis' roads, its tram tracks, and the main-line
#    track the Koleje Śląskie trains need. That last one is much larger than
#    the map's own frame because the trains are drawn WHOLE: Racibórz and
#    Zwardoń in the south-west, Chorzew Siemkowice in the north, Kraków and
#    Zakopane in the east, so the cut reads łódzkie and małopolskie too.
if [ ! -f data/osm/gzm.json ] || [ ! -f data/osm/gzm-tram.json ] || [ ! -f data/osm/gzm-rail.json ]; then
  python3 -c "import osmium" 2>/dev/null || { echo "brak pakietu osmium — zainstaluj: pip3 install --user osmium" >&2; exit 1; }
  for V in slaskie malopolskie lodzkie; do
    if [ ! -f "data/$V-latest.osm.pbf" ]; then
      echo "== Geofabrik $V-latest.osm.pbf =="
      curl -fL --retry 5 --retry-delay 5 -C - --max-time 3600 -o "data/$V-latest.osm.pbf"         "https://download.geofabrik.de/europe/poland/$V-latest.osm.pbf"
    fi
  done
  echo "== cutting OSM out of the extracts =="
  python3 pipeline/pbf-cut.py
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/gtfs data/gtfs-ks data/osm/gzm.json data/osm/gzm-tram.json data/osm/gzm-rail.json 2>/dev/null || true
