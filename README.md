# gzm-bus-map

Interactive web map of public transport in the GZM Metropolis (Katowice
conurbation) in the visual logic of a classic printed network map:
**345 bus and trolleybus lines and 24 tram lines (ZTM GZM)**, and — since
9.09.2026 — the **25 rail lines of Koleje Śląskie**, drawn exactly along
roadways, tram tracks and main-line track (own HMM/Viterbi map matching on an
OSM graph), line numbers written parallel to every street they use, labeled
stops, true roundabout arcs. **394 lines / 22 727 km**, weighted mean matching
error 1.8 m.

## Koleje Śląskie

The voivodeship's rail operator rides its own toggle and its own slice of the
graph, from its own GTFS (koleje-ks.pl, the file odt.org.pl lists). The trains
are drawn **whole**, the way the Berlin map draws its RB/RE and the Vienna map
its REX: Racibórz and Zwardoń in the south-west, Chorzew Siemkowice in the
north, Kraków and Zakopane in the east — 8 453 km of the sheet's 22 727, run
far beyond the Metropolis' own 40-odd municipalities.

Three things that feed needs and this pipeline learned for it:

- **A route per origin–destination pair.** S82 alone arrives as eleven routes
  (Chorzów Batory – Chorzew Siemkowice, Bytom – Kłobuck, and so on) under one
  number, so a line reaches the matcher as a dozen patterns. The
  representative-variant rule the family learned in Tricity was ported here for
  it: the drawn pattern is the LONGEST still worked by ≥15 % of the busiest
  pattern's trips. It lengthened 92 bus line-directions too (+326 km).
- **Crossovers are track, and so is a building site.** Excluded from the rail
  graph, crossovers tore the Koleje Śląskie lines into 148 pieces at the
  station throats of Bytom, Nędza and Pszczyna — a train changes tracks at a
  junction over exactly those ways. Heavy rail now keeps its crossovers and
  sidings, the way Warsaw's SKM does (tram yards, spurs and sidings stay out),
  and every `construction` / `disused` / `proposed` way that is through track
  is admitted and renamed to what it is being built as before the graph is
  built — `usage=main` alone was not enough, because Bytom's and Zabrze's
  rebuilt throats carry no usage tag at all. 148 breaks → 15.
- **Fifteen lines carry a colour, the rest do not.** The feed ships the
  operator's livery for S1, S3, S4, S5, S6, S7, S8, S13, S18, S31, S61, S62,
  S71, S72 and S78; the others take one rail purple. That is the Berlin
  arrangement — official colours where the operator publishes them, one colour
  where it does not.
- **The trains the feed leaves unnumbered stay out**: "POCIĄG", "KSL", "NA",
  "AIR" and the Slovak "ZSSK" to Skalité carry no line a passenger could read
  off a platform. A **combined designation is not a line either**: "S1/S5" is a
  through train, S1 as far as Katowice and S5 beyond it, and the feed files
  thirteen such pairs (S1/S5, S6/S62, S72/S7, S71/S72…) as routes of their own.
  No destination board ever shows one as a number, so each folds onto the
  number the train DEPARTS under. The mirror route carries the pair the other
  way round (S5/S1 → S5), so the joint section still ends up drawn under both
  numbers — which is exactly what it carries. 38 "lines" → 25 real ones.
- **Two tracks are one axis.** A double-track main line is two OSM ways 8–9 m
  apart with sparse crossovers, and the matcher takes whichever one each shape
  happens to sit on: south of Rudyszwałd S71 landed on one track of line 151
  and S78 on the other, so the pair never formed a shared run and their joint
  approach to Chałupki drew as two ribbons side by side instead of one purple
  corridor. Every node now gets a synthetic zero-length link to the nodes of
  other ways within 9 m on the same level and layer (`weldParallelTracks`, the
  New York rule for four-track trunks): 51 343 links, and the rail matching
  went from 15 breaks to **none**.

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
npm run download   # GTFS (ZTM GZM, Koleje Śląskie) + OSM (Geofabrik + pyosmium) + MapLibre (cached in data/ and web/vendor/)
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
