// Slim baked pattern geometry to cut cold-load weight (download + parse) on
// mobile. Three lossless-for-our-purposes reductions:
//   1. Round lat/lon to 5 decimals (~1 m) — strips float noise like
//      -87.624855999998.
//   2. Drop the unused pdist:0 (and absent name fields) from shape waypoints.
//   3. Douglas–Peucker the waypoint runs between stops (every stop is kept, so
//      routing is untouched; only redundant near-collinear shaping points go).
// Used by build-index.js at bake time, and runnable standalone to slim the
// already-baked public/data/patterns.json in place.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DECIMALS = 5;
const EPSILON = 0.00008; // ~8 m perpendicular tolerance in degrees

const round = (n) => {
  const f = 10 ** DECIMALS;
  return Math.round(n * f) / f;
};

function perpDist(p, a, b) {
  const dx = b.lat - a.lat;
  const dy = b.lon - a.lon;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(p.lat - a.lat, p.lon - a.lon);
  let t = ((p.lat - a.lat) * dx + (p.lon - a.lon) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lat - (a.lat + t * dx), p.lon - (a.lon + t * dy));
}

// Douglas–Peucker over an array of point objects (keeps endpoints).
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

export function slimPattern(pattern, { decimals = DECIMALS, epsilon = EPSILON } = {}) {
  const r = decimals === DECIMALS ? round : (n) => Math.round(n * 10 ** decimals) / 10 ** decimals;
  // Simplify the waypoint runs between stops; stops are fixed anchors.
  const kept = [];
  let run = [];
  const flush = () => {
    if (run.length) for (const p of simplify(run, epsilon)) kept.push(p);
    run = [];
  };
  for (const p of pattern.points) {
    if (p.type === 'S') {
      flush();
      kept.push(p);
    } else {
      run.push(p);
    }
  }
  flush();
  const points = kept.map((p) =>
    p.type === 'S'
      ? {
          seq: p.seq,
          lat: r(p.lat),
          lon: r(p.lon),
          type: 'S',
          stopId: p.stopId,
          stopName: p.stopName,
          pdist: Math.round(p.pdist),
        }
      : { seq: p.seq, lat: r(p.lat), lon: r(p.lon), type: 'W' },
  );
  return { ...pattern, points };
}

export function slimPatternsMap(map, opts) {
  const out = {};
  for (const [pid, pattern] of Object.entries(map)) out[pid] = slimPattern(pattern, opts);
  return out;
}

// Standalone: slim the baked bundle in place.
if (import.meta.url === `file://${process.argv[1]}`) {
  const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
  const file = resolve(DATA, 'patterns.json');
  const before = readFileSync(file, 'utf8');
  const slim = slimPatternsMap(JSON.parse(before));
  const after = JSON.stringify(slim);
  writeFileSync(file, after);
  console.log(
    `patterns.json: ${(before.length / 1e6).toFixed(2)}MB -> ${(after.length / 1e6).toFixed(2)}MB`,
  );
}
