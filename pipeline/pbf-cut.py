#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cuts the OSM extracts out of the Geofabrik voivodeship .pbf files — the same
JSON shape Overpass returns ('elements': ways with tags, node ids and
geometry), so build.mjs cannot tell the difference.

Three cuts:
  data/osm/gzm.json       roads, the bus box download.sh asks Overpass for
  data/osm/gzm-tram.json  railway=tram / light_rail, the tram box
  data/osm/gzm-rail.json  main-line track for the Koleje Slaskie trains, drawn
                          whole the way Berlin draws its RB/RE: Raciborz and
                          Zwardon in the south-west, Chorzew Siemkowice in the
                          north, Zakopane and Krakow in the east, so the box
                          reaches into lodzkie and malopolskie and the cut
                          reads all three extracts

Written 9.09.2026, when every public Overpass mirror answered 504 for an hour
(the wall Berlin, London, Sao Paulo and Vienna hit before).
"""
import json, os, re, sys
import osmium

ROOT = os.path.join(os.path.dirname(__file__), '..')
PBFS = [os.path.join(ROOT, 'data', n) for n in
        ('slaskie-latest.osm.pbf', 'malopolskie-latest.osm.pbf', 'lodzkie-latest.osm.pbf')]
ROAD_BOX = (49.93, 18.35, 50.62, 19.52)       # S, W, N, E — as download.sh
TRAM_BOX = (50.18, 18.68, 50.44, 19.31)
RAIL_BOX = (49.25, 18.15, 51.30, 20.10)       # Koleje Slaskie, drawn whole
HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway|construction|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$')
TRAM = re.compile(r'^(tram|light_rail)$')
# construction/disused/proposed ride along the way Vienna's Verbindungsbahn did:
# a line being rebuilt is tagged for what it is becoming, and build.mjs renames
# the admitted ways back to `rail` before the graph is built
RAIL = re.compile(r'^(rail|construction|disused|proposed|narrow_gauge)$')

road_file = os.path.join(ROOT, 'data/osm/gzm.json')
tram_file = os.path.join(ROOT, 'data/osm/gzm-tram.json')
rail_file = os.path.join(ROOT, 'data/osm/gzm-rail.json')
need_road = not os.path.exists(road_file)
need_tram = not os.path.exists(tram_file)
need_rail = not os.path.exists(rail_file)
print('drogi:', need_road, '| tramwaje:', need_tram, '| kolej:', need_rail, flush=True)
if not (need_road or need_tram or need_rail):
    sys.exit(0)
os.makedirs(os.path.join(ROOT, 'data/osm'), exist_ok=True)
out_road, out_tram, out_rail = [], [], []


def inside(box, la0, lo0, la1, lo1):
    return la1 >= box[0] and la0 <= box[2] and lo1 >= box[1] and lo0 <= box[3]


class H(osmium.SimpleHandler):
    def way(self, w):
        tags = w.tags
        hw, rw = tags.get('highway'), tags.get('railway')
        is_road = need_road and hw is not None and HW.match(hw)
        is_tram = need_tram and rw is not None and TRAM.match(rw)
        is_rail = need_rail and rw is not None and RAIL.match(rw)
        if not (is_road or is_tram or is_rail):
            return
        geom, ids = [], []
        la0, la1, lo0, lo1 = 90.0, -90.0, 180.0, -180.0
        for n in w.nodes:
            try:
                lo, la = n.lon, n.lat
            except osmium.InvalidLocationError:
                continue
            # node ids ride along: buildGraph() builds topology from el.nodes
            # and SILENTLY skips ways without them (the London t13 hole)
            ids.append(n.ref)
            geom.append({'lat': la, 'lon': lo})
            if la < la0: la0 = la
            if la > la1: la1 = la
            if lo < lo0: lo0 = lo
            if lo > lo1: lo1 = lo
        if len(geom) < 2:
            return
        el = {'type': 'way', 'id': w.id, 'nodes': ids,
              'tags': {t.k: t.v for t in tags}, 'geometry': geom}
        if is_road and inside(ROAD_BOX, la0, lo0, la1, lo1):
            out_road.append(el)
        if is_tram and inside(TRAM_BOX, la0, lo0, la1, lo1):
            out_tram.append(el)
        if is_rail and inside(RAIL_BOX, la0, lo0, la1, lo1):
            out_rail.append(el)


for pbf in PBFS:
    if not os.path.exists(pbf):
        sys.exit('brak ' + pbf + ' — pobierz go (pipeline/download.sh)')
    print('czytam', os.path.basename(pbf), flush=True)
    H().apply_file(pbf, locations=True, idx='flex_mem')

GEN = 'pbf-cut.py (Geofabrik slaskie + malopolskie + lodzkie)'
seen = set()
for need, path, els, what in ((need_road, road_file, out_road, 'drogi'),
                              (need_tram, tram_file, out_tram, 'torowiska'),
                              (need_rail, rail_file, out_rail, 'tory kolejowe')):
    if not need:
        continue
    uniq, ids = [], set()
    for e in els:                      # a way on a voivodeship border is in both
        if e['id'] in ids:
            continue
        ids.add(e['id'])
        uniq.append(e)
    json.dump({'version': 0.6, 'generator': GEN, 'elements': uniq}, open(path, 'w'))
    print(f'{what}: {len(uniq)}', flush=True)
print('gotowe', flush=True)
