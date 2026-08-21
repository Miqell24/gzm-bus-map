# gzm-bus-map

Interactive web map of public transport in the GZM Metropolis (Katowice
conurbation) in the visual logic of a classic printed network map:
**432 bus lines, 8 trolleybus lines and 27 tram lines
(ZTM GZM)** drawn exactly along roadways and tram tracks (own HMM/Viterbi map
matching on an OSM graph), line numbers written parallel to every street they
use, labeled stops, true roundabout arcs.

Fifth city of the family, alongside
[krakow-bus-map](https://github.com/Miqell24/krakow-bus-map),
[athens-bus-map](https://github.com/Miqell24/athens-bus-map),
[thessaloniki-bus-map](https://github.com/Miqell24/thessaloniki-bus-map) and
[poznan-bus-map](https://github.com/Miqell24/poznan-bus-map) — same pipeline and
same visual system, different city and feeds. The largest network of the family:
41 municipalities from Gliwice to Dąbrowa Górnicza.

## Two views

The panel's **Corridors / Lines** switch (ported from the Tricity map, 21.08.2026)
redraws the same network line by line: a roadway carrying up to four lines is
drawn as four coloured strands side by side (each line keeps one colour across the
whole map), anything busier becomes one grey trunk with its numbers beside it in
the lines' colours. `npm run lines` (`pipeline/lines.mjs`) derives the strand
files from `data/out/`; `npm run audit` checks the drawn result (torn ends,
folds, doubles, every line one connected piece).

## Features

- GTFS from ZTM GZM matched onto the OSM road and tram network — weighted mean
  error **1.84 m** over 16 623 km of drawn route.
- **One feed, three vehicle kinds**: the ZTM file carries trams (`route_type`
  0), buses (3) and the Tychy trolleybuses (11) together, so each mode filters
  the same feed by `routeTypes` and matches on its own graph — trams on
  `railway=tram` (the Silesian Interurbans network), buses and trolleybuses on
  roadways (trolleybus lines drawn green).
- KMK-style rendering: one stroke per roadway, aggregated line numbers rotated
  parallel to streets, shared bus+tram corridors get a two-color number row,
  half-disc stops turned to their side of the street, termini with boxed line
  badges that fuse into one complex when they would collide at the current zoom.
- "Paper map" recolor of the base map: warm districts, green parks, real-blue
  water, pale-yellow motorways.
- Panel with mode visibility filters and a clickable line list (click a line to
  see its route with all stops).
- Three PNG exports: current view (WYSIWYG), selected area (poster-grade), and
  the whole network as one print-quality poster.
- GTFS shapes.txt quality report (`npm run report` → `data/gtfs-gaps-report.md`).

## Requirements

Node ≥ 18 (no npm dependencies), `curl`, `unzip`, `python3`, internet on first run.

## Usage

```bash
npm run download   # ZTM GZM GTFS + OSM (Overpass) + MapLibre (cached in data/ and web/vendor/)
npm run build      # extraction + map matching + GeoJSON files into data/out/
npm run serve      # http://localhost:8128
```

The GZM open-data portal publishes several dated GTFS snapshots per day;
`download.sh` asks the CKAN API for the newest one. To pull a fresh feed:

```bash
rm -rf data/gtfs data/ztm_gzm_gtfs.zip && npm run download && npm run build
```

## Structure

- `pipeline/download.sh` — input data download
- `pipeline/build.mjs` — GTFS → OSM graph → HMM/Viterbi → `data/out/*.geojson`
- `pipeline/lib/` — csv (streaming), geo (local projection), graph (graph + Dijkstra), hmm (Viterbi)
- `pipeline/report-gaps.mjs` — GTFS shapes.txt gap report
- `web/` — MapLibre GL frontend (vendored, OpenFreeMap positron tiles)
- `docs/` — static bundle published via GitHub Pages (web + data/out copies)

## Data attribution

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · timetables: GTFS
ZTM GZM (otwartedane.metropoliagzm.pl).
