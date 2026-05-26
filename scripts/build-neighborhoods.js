// Bake which bus routes serve each Chicago community area, for the neighborhood
// achievements ("ride every route in ___"). Fetches the city's 77 community-area
// polygons, point-in-polygons every baked bus stop to find its area, then unions
// per route. Only the small derived mapping ships — the ~2 MB of polygons stays
// build-time. Output: public/data/neighborhoods.json.
//
// Runs standalone against the already-baked public/data (no CTA key / GTFS
// needed); also invoked at the end of build-index.js so refreshes stay current.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'public', 'data');
const GEOJSON_URL = 'https://data.cityofchicago.org/resource/igwz-8jzy.geojson?$limit=100';
const CACHE = '/tmp/cta-community-areas.geojson';
// A route counts as serving an area only with at least this many stops inside —
// keeps a route that merely clips a boundary from "counting" for that area.
const MIN_STOPS_IN_AREA = 2;

async function loadGeoJSON() {
  if (existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < 30 * 24 * 60 * 60 * 1000) {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const res = await fetch(GEOJSON_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`community areas HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(CACHE, text);
  return JSON.parse(text);
}

// City data is ALL-CAPS; title-case it, with a few names the naive rule mangles.
const NAME_OVERRIDES = { OHARE: "O'Hare", 'MCKINLEY PARK': 'McKinley Park' };
const titleCase = (s) =>
  NAME_OVERRIDES[s] ??
  s.toLowerCase().replace(/(^|[\s\-/'])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInPolygon = (x, y, poly) =>
  pointInRing(x, y, poly[0]) && !poly.slice(1).some((hole) => pointInRing(x, y, hole));
const pointInGeom = (x, y, geom) =>
  geom.type === 'Polygon'
    ? pointInPolygon(x, y, geom.coordinates)
    : geom.coordinates.some((poly) => pointInPolygon(x, y, poly));

function bbox(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eachCoord = (g) =>
    (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2).forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  eachCoord(geom);
  return { minX, minY, maxX, maxY };
}

const routeNum = (rt) => {
  const m = rt.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : 99999;
};

export async function buildNeighborhoods() {
  const geo = await loadGeoJSON();
  const areas = geo.features
    .filter((f) => f.geometry && f.properties?.community)
    .map((f) => ({
      name: titleCase(f.properties.community),
      geom: f.geometry,
      box: bbox(f.geometry),
    }));

  const routes = JSON.parse(readFileSync(resolve(DATA, 'routes.json'), 'utf8'));
  const routePatterns = JSON.parse(readFileSync(resolve(DATA, 'route-patterns.json'), 'utf8'));
  const patterns = JSON.parse(readFileSync(resolve(DATA, 'patterns.json'), 'utf8'));

  const areaOfStop = (lat, lon) => {
    for (const a of areas) {
      if (lon < a.box.minX || lon > a.box.maxX || lat < a.box.minY || lat > a.box.maxY) continue;
      if (pointInGeom(lon, lat, a.geom)) return a.name;
    }
    return null;
  };

  // route -> { areaName -> stopCount } over unique stops.
  const perRoute = new Map();
  const stopAreaCache = new Map(); // stopId -> areaName | null
  for (const [rt, route] of Object.entries(routes)) {
    if (route.isTrain) continue;
    const counts = new Map();
    const seen = new Set();
    for (const pid of routePatterns[rt] || []) {
      const p = patterns[pid];
      if (!p) continue;
      for (const pt of p.points) {
        if (pt.type !== 'S' || !pt.stopId || seen.has(pt.stopId)) continue;
        seen.add(pt.stopId);
        let area = stopAreaCache.get(pt.stopId);
        if (area === undefined) {
          area = areaOfStop(pt.lat, pt.lon);
          stopAreaCache.set(pt.stopId, area);
        }
        if (area) counts.set(area, (counts.get(area) || 0) + 1);
      }
    }
    perRoute.set(rt, counts);
  }

  // Invert to area -> routes (meeting the stop threshold), with a bbox center.
  const areaRoutes = new Map(areas.map((a) => [a.name, []]));
  for (const [rt, counts] of perRoute) {
    for (const [area, n] of counts) {
      if (n >= MIN_STOPS_IN_AREA) areaRoutes.get(area).push(rt);
    }
  }

  const out = areas
    .map((a) => ({
      name: a.name,
      routes: (areaRoutes.get(a.name) || []).sort(
        (x, y) => routeNum(x) - routeNum(y) || x.localeCompare(y),
      ),
      center: [(a.box.minY + a.box.maxY) / 2, (a.box.minX + a.box.maxX) / 2],
    }))
    .filter((a) => a.routes.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  writeFileSync(
    resolve(DATA, 'neighborhoods.json'),
    JSON.stringify({ generatedAt: Date.now(), areas: out }),
  );
  console.log(`  neighborhoods: ${out.length} community areas with bus service`);
  return out;
}

// Allow running directly: `node scripts/build-neighborhoods.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  buildNeighborhoods().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
