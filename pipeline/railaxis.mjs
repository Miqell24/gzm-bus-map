// Koleje Śląskie on ONE clean axis per corridor (user 18.09.2026, on the first
// cut of the coloured stripes: "czemu ten pociąg nagle skręca na inną linię …
// kolory się zrywają, pojawiają … losowe trasy, które nawet nie jadą po torach").
//
// The matcher draws every line-direction on the physical track its shape lies
// nearest to. For a thin one-colour stroke that was good enough; a bundle of
// coloured stripes shows every flaw of it at once:
//   * a double-track main line is two OSM ways 4–9 m apart — one direction rides
//     one, the other direction the other, and at every crossover the path hops
//     across: the bundle split in two, each half with its own subset of colours;
//   * at stations the path wanders onto a loop or a siding and back — a hairpin
//     or a little rectangle hanging off the main line;
//   * every run has its own geometry direction, so the stripes swapped sides.
// None of that is how a line map reads. This pass rebuilds the railway from the
// matched line-directions (route.geojson) as a network of AXES:
//   1. every route is resampled (15 m), its out-and-back excursions are cut
//      (unless one of ITS OWN stations sits out there — a real stub terminus),
//      and the rest is smoothed, which also irons the 4–9 m crossover jogs;
//   2. routes are laid down longest first; a route rides an existing axis
//      wherever it runs within 55 m of it (85 m to let go) in the same
//      direction, and only where it truly leaves does it found a new axis —
//      peeled back to where the two tracks were still 12 m apart, so a branch
//      leaves the corridor the way the rails do, not in a sideways jump — and
//      anchored on the axis it left: a corridor of two, four or six parallel
//      tracks is one axis, and a junction is a point;
//   3. each axis is cut where the set of lines riding it changes; a cut shorter
//      than 150 m is noise from the letting-go distance and joins its neighbour.
// Written back: the rail runs of streets.geojson (oriented — every axis runs
// eastwards, so the stripes keep their sides), the rail routes of
// route.geojson, the rail stations of stops.geojson (moved onto the axis) and
// the rail number rows of labels.geojson (one per cut, repeated every 3 km,
// `rk` = the number of stripes, so the row stands clear of the bundle).
//
// Usage: import { railAxis } from './railaxis.mjs'; railAxis(dir, { log })
//    or: node pipeline/railaxis.mjs <dir>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STEP = 15, ATTACH = 55, DETACH = 85, PEEL = 12, COS_MAX = Math.cos(40 * Math.PI / 180);
// EXC_MAX is generous on purpose: S51 to Częstochowa was matched with a 57 km
// run from Bielsko-Biała out to Kalwaria and back, with none of its stations there
const NEAR = 14, NEAR_BACK = 45, EXC_MIN = 60, EXC_MAX = 250000, SMOOTH = 3, SHORT = 150, CELL = 70;
const LAT0 = 50.2, LON0 = 19.0, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
const toXY = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const toLL = ([x, y]) => [Math.round((x / KX + LON0) * 1e6) / 1e6, Math.round((y / KY + LAT0) * 1e6) / 1e6];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const natKey = (s) => { const m = /^(\D*)(\d*)(.*)$/.exec(s); return [m[1], m[2] ? Number(m[2]) : Infinity, m[3]]; };
const natSort = (a, b) => { const A = natKey(a), B = natKey(b); return A[0].localeCompare(B[0]) || (A[1] - B[1]) || A[2].localeCompare(B[2]); };

function densify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b);
    if (d < 0.01) continue;
    const n = Math.max(1, Math.round(d / STEP));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
function cumLen(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; }

// out-and-back excursions: the path returns to where it was after EXC_MIN…
// EXC_MAX m of travel — within NEAR m, or within NEAR_BACK m when it comes back
// HEADING THE OTHER WAY (out on one track of a double line, back on the other,
// 25 m beside it: no train does that, and the fold drew a Z into the bundle).
// Kept only when one of the line's own stations is out there and NOT reachable
// from the main path (a stub, or a station where the train reverses, as at
// Rybnik) — and then everything inside it is kept too.
function cutExcursions(pts, stops) {
  let cut = 0;
  const log = [];
  for (let guard = 0; guard < 300; guard++) {
    const cum = cumLen(pts), T = tangents(pts);
    const grid = new Map();
    const key = (p) => Math.floor(p[0] / 50) + ',' + Math.floor(p[1] / 50);
    pts.forEach((p, i) => { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    let found = null;
    for (let i = 0; i < pts.length && !found; i++) {
      const cx = Math.floor(pts[i][0] / 50), cy = Math.floor(pts[i][1] / 50);
      let best = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
          if (j <= i + 3 || j <= best) continue;
          const L = cum[j] - cum[i];
          if (L < EXC_MIN || L > EXC_MAX) continue;
          const d = dist(pts[i], pts[j]);
          if (d < NEAR || (d < NEAR_BACK && T[i][0] * T[j][0] + T[i][1] * T[j][1] < -0.7)) best = j;
        }
      }
      if (best < 0) continue;
      let apex = 0;
      for (let t = i; t <= best; t++) apex = Math.max(apex, dist(pts[i], pts[t]));
      if (apex < 30) continue;
      const needed = (stops || []).some((s) => dist(s, pts[i]) > 200 && pts.slice(i, best + 1).some((q) => dist(s, q) < 80));
      if (needed) { i = best; continue; }
      found = [i, best];
    }
    if (!found) break;
    { let ap = pts[found[0]], ad = 0; for (let t = found[0]; t <= found[1]; t++) { const d = dist(pts[found[0]], pts[t]); if (d > ad) { ad = d; ap = pts[t]; } }
      const near = (q) => Math.round(Math.min(...(stops || [[1e9, 1e9]]).map((s) => dist(s, q))));
      log.push({ at: pts[found[0]], len: cum[found[1]] - cum[found[0]], apex: ap, apexStop: near(ap), atStop: near(pts[found[0]]) }); }
    pts = [...pts.slice(0, found[0] + 1), ...pts.slice(found[1])];
    cut++;
  }
  return { pts, cut, log };
}
function smooth(pts) {
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const w = Math.min(SMOOTH, i, n - 1 - i);
    let x = 0, y = 0;
    for (let k = -w; k <= w; k++) { x += pts[i + k][0]; y += pts[i + k][1]; }
    out[i] = [x / (2 * w + 1), y / (2 * w + 1)];
  }
  return out;
}
const tangents = (pts) => pts.map((_, i) => { const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)]; const L = dist(a, b) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; });
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0] - ax, by = pts[b][1] - ay, L = Math.hypot(bx, by) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * by - (pts[i][1] - ay) * bx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function railAxis(dir, opts = {}) {
  const log = opts.log || (() => {});
  const F = (n) => join(dir, n);
  if (!['route.geojson', 'streets.geojson', 'stops.geojson', 'labels.geojson', 'meta.json'].every((n) => existsSync(F(n)))) return 0;
  const rd = (n) => JSON.parse(readFileSync(F(n), 'utf8'));
  const meta = rd('meta.json');
  const railLines = (meta.lines || []).filter((l) => l.rail);
  if (!railLines.length) return 0;
  const colorOf = new Map(railLines.map((l) => [l.line, l.color]));
  const modeColor = '#a518a3';
  const routes = rd('route.geojson'), streets = rd('streets.geojson'), stops = rd('stops.geojson'), labels = rd('labels.geojson');

  // The pass rewrites its own inputs, so the matched routes and the station
  // positions it started from are kept beside the outputs (rail-input.raw — not
  // a .json, the publishing copy leaves it behind): a rerun starts from them
  // again instead of from its own previous result. A fresh build resets it.
  const rawFile = F('rail-input.raw');
  if (opts.fresh || !existsSync(rawFile)) {
    writeFileSync(rawFile, JSON.stringify({
      routes: routes.features.filter((f) => f.properties.rail).map((f) => [f.properties.line, f.properties.dir, f.geometry.coordinates]),
      stops: stops.features.filter((f) => f.properties.rail).map((f) => [f.properties.name, f.geometry.coordinates]),
    }), 'utf8');
  } else {
    const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
    const rk = new Map(raw.routes.map(([l, d, c]) => [l + '|' + d, c])), sk = new Map(raw.stops);
    for (const f of routes.features) if (f.properties.rail && rk.has(f.properties.line + '|' + f.properties.dir)) f.geometry.coordinates = rk.get(f.properties.line + '|' + f.properties.dir);
    for (const f of stops.features) if (f.properties.rail && sk.has(f.properties.name)) f.geometry.coordinates = sk.get(f.properties.name);
  }

  const stopsOf = new Map();
  for (const f of stops.features) {
    if (!f.properties.rail) continue;
    for (const l of f.properties.arr || []) { if (!stopsOf.has(l)) stopsOf.set(l, []); stopsOf.get(l).push(toXY(f.geometry.coordinates)); }
  }

  // ---- 1) the routes, cleaned ----
  const R = [];
  let cuts = 0;
  const cutLog = [];
  for (const f of routes.features) {
    if (!f.properties.rail || f.geometry.type !== 'LineString') continue;
    let pts = densify(f.geometry.coordinates.map(toXY));
    const c = cutExcursions(pts, stopsOf.get(f.properties.line));
    cuts += c.cut;
    for (const e of c.log) cutLog.push({ line: f.properties.line, dir: f.properties.dir, len: Math.round(e.len), at: toLL(e.at), apex: toLL(e.apex), apexStop: e.apexStop, atStop: e.atStop });
    pts = smooth(densify(c.pts));
    R.push({ f, line: f.properties.line, pts, len: cumLen(pts).pop() });
  }
  R.sort((a, b) => b.len - a.len);

  // ---- 2) the axes ----
  const axes = [];            // { pts, tan, edges: Set[] }
  const grid = new Map();
  const cellOf = (p) => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
  const index = (a, from, to) => { for (let i = from; i < to; i++) { const [cx, cy] = cellOf(axes[a].pts[i]); const k = cx + ',' + cy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a, i]); } };
  for (const r of R) {
    const P = r.pts, n = P.length, T = tangents(P);
    let map = null;
    const runsOf = () => { const out = []; let s = 0; for (let t = 1; t <= n; t++) { const a = map[t - 1] ? map[t - 1][0] : -1, b = t < n && map[t] ? map[t][0] : (t < n ? -1 : -2); if (a !== b) { out.push([s, t - 1, a]); s = t; } } return out; };
    // One free stretch at a time, then the route is read against the axes
    // again: a route that comes back along its own track (the trains that
    // reverse at Rybnik) must find, on the way back, the axis it founded on the
    // way out — laid down in one piece, the two passes became two parallel axes.
    // pins: points of a stretch too short to found an axis ride the neighbour's
    const pins = new Map();
    const nearestOn = (a, p, around) => { let bi = around, bd = Infinity; for (let i = Math.max(0, around - 80); i <= Math.min(axes[a].pts.length - 1, around + 80); i++) { const d = dist(p, axes[a].pts[i]); if (d < bd) { bd = d; bi = i; } } return [a, bi]; };
    for (let round = 0; round < 200; round++) {
      map = new Array(n).fill(null);
      let prev = null;
      for (let t = 0; t < n; t++) {
        const [cx, cy] = cellOf(P[t]);
        let best = null, bestScore = Infinity;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const [a, i] of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
            const d = dist(P[t], axes[a].pts[i]);
            const same = prev && prev[0] === a;
            if (d > (same ? DETACH : ATTACH)) continue;
            const tn = axes[a].tan[i];
            if (Math.abs(tn[0] * T[t][0] + tn[1] * T[t][1]) < COS_MAX) continue;
            const score = d - (same ? 20 : 0);
            if (score < bestScore) { bestScore = score; best = [a, i]; }
          }
        }
        map[t] = best || pins.get(t) || null; prev = map[t];
      }
      // flicker: a short free gap inside one axis is ridden through, a short
      // touch of an axis between two free stretches is let go
      for (const [s, e, a] of runsOf()) {
        if (a !== -1 || e - s + 1 > 5 || s === 0 || e === n - 1) continue;
        const A = map[s - 1], B = map[e + 1];
        if (!A || !B || A[0] !== B[0]) continue;
        for (let t = s; t <= e; t++) map[t] = [A[0], Math.round(A[1] + (B[1] - A[1]) * (t - s + 1) / (e - s + 2))];
      }
      for (const [s, e, a] of runsOf()) {
        if (a < 0 || e - s + 1 > 4) continue;
        const before = s > 0 ? map[s - 1] : null, after = e < n - 1 ? map[e + 1] : null;
        if (!before && !after) for (let t = s; t <= e; t++) map[t] = null;
      }
      const free = runsOf().find((x) => x[2] === -1);
      if (!free) break;
      let [s, e] = free;
      // peel: the route was let go 85 m out, but the rails parted long before.
      // The free stretch grows back (and forth) along the route to where it
      // still ran within PEEL m of the axis — at most 600 m, else to the nearest
      // point in that window — so the new axis leaves the old one at the points.
      const gapTo = (t) => dist(P[t], axes[map[t][0]].pts[map[t][1]]);
      for (const dir of [-1, 1]) {
        let t = dir < 0 ? s - 1 : e + 1, bestT = -1, bestD = Infinity, steps = 0;
        const first = t;
        while (t > 0 && t < n - 1 && map[t] && steps < 40) {
          const d = gapTo(t);
          if (d < bestD) { bestD = d; bestT = t; }
          if (d <= PEEL) break;
          t += dir; steps++;
        }
        if (bestT < 0) continue;
        for (let u = first; u !== bestT; u += dir) map[u] = null;
        if (dir < 0) s = bestT + 1; else e = bestT - 1;
      }
      // …and it ends where the route comes back to its own earlier track
      for (let u = s + 25; u <= e; u++) {
        let back = false;
        for (let v = s; v <= u - 25 && !back; v += 2) if (dist(P[u], P[v]) < ATTACH && Math.abs(T[u][0] * T[v][0] + T[u][1] * T[v][1]) >= COS_MAX) back = true;
        if (back) { e = u - 1; break; }
      }
      const A = s > 0 ? map[s - 1] : null, B = e < n - 1 ? map[e + 1] : null;
      // a parallel track that never came within PEEL m: leave a gentle diagonal
      // instead of a sideways step — the first 120 m ride the anchor
      if (A && e - s > 14 && dist(P[s], axes[A[0]].pts[A[1]]) > 20) s += 8;
      if (B && e - s > 14 && dist(P[e], axes[B[0]].pts[B[1]]) > 20) e -= 8;
      if (e - s < 2) {
        // nothing left to found an axis with: the stretch rides its neighbour
        const N = A || B;
        if (!N) break;
        let any = false;
        for (let t = Math.min(free[0], s); t <= Math.max(free[1], e); t++) if (!map[t] && !pins.has(t)) { pins.set(t, nearestOn(N[0], P[t], N[1])); any = true; }
        if (!any) break;
        continue;
      }
      let pts = [];
      if (A) pts.push(axes[A[0]].pts[A[1]]);
      const off = pts.length;
      for (let t = s; t <= e; t++) pts.push(P[t]);
      if (B) pts.push(axes[B[0]].pts[B[1]]);
      pts = smooth(pts);
      const id = axes.length;
      axes.push({ pts, tan: tangents(pts), edges: Array.from({ length: pts.length - 1 }, () => new Set()) });
      index(id, off, off + (e - s + 1));
    }
    for (let t = 1; t < n; t++) {
      const A = map[t - 1], B = map[t];
      if (!A || !B || A[0] !== B[0] || Math.abs(A[1] - B[1]) > 40) continue;
      for (let i = Math.min(A[1], B[1]); i < Math.max(A[1], B[1]); i++) axes[A[0]].edges[i].add(r.line);
    }
    r.map = map;
  }

  // ---- 3) the cuts: one feature per stretch of an axis with one set of lines ----
  const segs = [];
  for (const ax of axes) {
    const keyOf = (s) => [...s].sort(natSort).join(', ');
    let runs = [];
    ax.edges.forEach((s, i) => { const k = keyOf(s); const last = runs[runs.length - 1]; if (last && last.k === k) last.i1 = i; else runs.push({ k, i0: i, i1: i }); });
    const lenOf = (r) => { let L = 0; for (let i = r.i0; i <= r.i1; i++) L += dist(ax.pts[i], ax.pts[i + 1]); return L; };
    for (let guard = 0; guard < 1000; guard++) {
      let pick = -1, pl = Infinity;
      runs.forEach((r, i) => { const L = lenOf(r); const nb = [runs[i - 1], runs[i + 1]].filter((x) => x && x.k); if ((L < SHORT || !r.k) && nb.length && L < pl) { pl = L; pick = i; } });
      if (pick < 0) break;
      const nb = [runs[pick - 1], runs[pick + 1]].filter((x) => x && x.k).sort((a, b) => lenOf(b) - lenOf(a))[0];
      runs[pick].k = nb.k;
      const merged = [];
      for (const r of runs) { const last = merged[merged.length - 1]; if (last && last.k === r.k) last.i1 = r.i1; else merged.push({ ...r }); }
      if (merged.length === runs.length && runs[pick].k === nb.k && lenOf(runs[pick]) >= SHORT) break;
      runs = merged;
    }
    // every axis runs eastwards (north-east breaks the tie): MapLibre offsets to
    // the right of a line's direction, so the stripes keep their sides
    const a = ax.pts[0], b = ax.pts[ax.pts.length - 1];
    const flip = ((b[0] - a[0]) * 0.94 + (b[1] - a[1]) * 0.34) < 0;
    for (const r of runs) {
      if (!r.k) continue;
      let pts = ax.pts.slice(r.i0, r.i1 + 2);
      if (flip) pts = pts.slice().reverse();
      segs.push({ lines: r.k.split(', '), pts, len: cumLen(pts).pop() });
    }
  }

  // ---- 4) written back ----
  const colourOfSet = (lines) => { const c = new Set(lines.map((l) => (colorOf.get(l) || modeColor).toLowerCase())); return c.size === 1 ? [...c][0] : modeColor; };
  const coloursIn = (lines) => new Set(lines.map((l) => (colorOf.get(l) || modeColor).toLowerCase())).size;
  streets.features = streets.features.filter((f) => !f.properties.rail);
  for (const s of segs) {
    streets.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: simplify(s.pts, 1.5).map(toLL) },
      properties: { name: '', lines: s.lines.join(', '), arr: s.lines, roundabout: 0, mode: 'tram', color: colourOfSet(s.lines), metro: 1, rail: 1, oriented: 1 } });
  }
  let recut = 0;
  for (const r of R) {
    let pts = [];
    r.map.forEach((m, t) => { const p = m ? axes[m[0]].pts[m[1]] : r.pts[t]; const q = pts[pts.length - 1]; if (!q || dist(p, q) > 0.5) pts.push(p); });
    // riding the axis vertex by vertex can fold a route back on itself for a
    // few metres where it changes axes — the same cut, once more
    const c = cutExcursions(densify(pts), stopsOf.get(r.line));
    recut += c.cut;
    r.f.geometry.coordinates = simplify(c.pts, 1.5).map(toLL);
  }
  // stations onto the axis that carries one of their lines
  const vgrid = new Map();
  segs.forEach((s, si) => s.pts.forEach((p, i) => { const k = Math.floor(p[0] / 150) + ',' + Math.floor(p[1] / 150); if (!vgrid.has(k)) vgrid.set(k, []); vgrid.get(k).push([si, i]); }));
  let moved = 0;
  for (const f of stops.features) {
    if (!f.properties.rail) continue;
    const p = toXY(f.geometry.coordinates), cx = Math.floor(p[0] / 150), cy = Math.floor(p[1] / 150);
    let best = null, bd = 160, bestSeg = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [si, i] of vgrid.get((cx + dx) + ',' + (cy + dy)) || []) {
      if (!(f.properties.arr || []).some((l) => segs[si].lines.includes(l))) continue;
      const d = dist(p, segs[si].pts[i]); if (d < bd) { bd = d; best = segs[si].pts[i]; bestSeg = si; }
    }
    if (best && bd > 0.5) { f.geometry.coordinates = toLL(best); moved++; }
    // rk: how many stripes the station sits in — its name stands clear of them
    if (best) f.properties.rk = coloursIn(segs[bestSeg].lines);
  }
  // the number rows of the railway: one per cut, repeated every 3 km
  labels.features = labels.features.filter((f) => !f.properties.rail);
  let rows = 0;
  for (const s of segs) {
    if (s.len < 250) continue;
    const cum = cumLen(s.pts);
    const at = (d) => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const a = s.pts[Math.max(0, i - 2)], b = s.pts[Math.min(s.pts.length - 1, i + 1)]; let ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; return { p: s.pts[i], ang }; };
    const base = { lines: s.lines.join(', '), color: colourOfSet(s.lines), mode: 'tram', arr: s.lines, rail: 1, rk: coloursIn(s.lines) };
    const put = (d, extra, ei) => { const q = at(d); labels.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: toLL(q.p) }, properties: { ...base, angle: Math.round(q.ang * 10) / 10, ...(extra ? { extra: 1, ei } : {}) } }); rows++; };
    put(s.len / 2, false);
    let ei = 0;
    for (let d = 1500; d < s.len - 800; d += 3000) if (Math.abs(d - s.len / 2) > 1200) put(d, true, ei++);
  }
  const wr = (n, o) => writeFileSync(F(n), JSON.stringify(o), 'utf8');
  wr('streets.geojson', streets); wr('route.geojson', routes); wr('stops.geojson', stops); wr('labels.geojson', labels);
  const km = segs.reduce((a, s) => a + s.len, 0) / 1000;
  log(`Rail axes: ${R.length} line-directions on ${axes.length} axes, ${segs.length} cuts, ${km.toFixed(0)} km; ${cuts} out-and-back excursions cut, ${moved} stations moved onto the axis, ${rows} number rows`);
  if (opts.debug) { const L = axes.map((ax) => ({ len: cumLen(ax.pts).pop(), used: ax.edges.filter((e) => e.size).length, n: ax.edges.length })); log(`  axes: ${L.length}; shorter than 100 m: ${L.filter((x) => x.len < 100).length}; without any line: ${L.filter((x) => !x.used).length}; lengths of the 12 longest: ${L.map((x) => Math.round(x.len / 1000)).sort((p, q) => q - p).slice(0, 12).join(', ')} km`); }
  if (opts.debug) { cutLog.sort((x, y) => y.len - x.len); for (const c of cutLog.slice(0, 25)) log(`  cut ${c.len} m  ${c.line} → ${c.dir}  @ ${c.at[1]},${c.at[0]}  apex ${c.apex[1]},${c.apex[0]} (own stop ${c.apexStop} m from the apex, ${c.atStop} m from the junction)`); const b = [0, 0, 0, 0]; for (const c of cutLog) b[c.len < 150 ? 0 : c.len < 500 ? 1 : c.len < 1500 ? 2 : 3]++; log(`  excursions by length: <150 m ${b[0]}, <500 m ${b[1]}, <1500 m ${b[2]}, longer ${b[3]}`); }
  return segs.length;
}

if (process.argv[1] && /railaxis\.mjs$/.test(process.argv[1]) && process.argv[2]) {
  railAxis(process.argv[2], { log: (m) => console.log(process.argv[2], m), debug: process.argv.includes('--debug') });
}
