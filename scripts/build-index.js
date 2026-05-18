// Build the static data layer that the app loads at runtime.
//
// Outputs (under public/data/):
//   routes.json            — { rt: { name, headways, durations, activeByHour } } for every active route
//   route-patterns.json    — { rt: [pid, pid, ...] }
//   patterns/<pid>.json    — { pid, direction, lengthFt, points: [{seq,lat,lon,type,stopId,stopName,pdist}] }
//
// Source of truth:
//   - cta-insights/data/gtfs/index.json supplies per-route headways + ride durations.
//   - cta-insights/src/bus/routes.js supplies human-readable route names.
//   - CTA Bus Tracker `getpatterns?rt=X` supplies pattern geometry (one call per route).
//
// Re-run with: CTA_BUS_KEY=... npm run build-index
// Reads CTA_BUS_KEY from cta-insights/.env if not in the current environment.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { buildTrains } from './build-trains.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INSIGHTS = resolve(ROOT, '..', 'cta-insights');
const OUT_DIR = resolve(ROOT, 'public', 'data');
const OUT_PATTERNS = resolve(OUT_DIR, 'patterns');

// Fall back to cta-insights' .env so the user doesn't have to duplicate the key.
if (!process.env.CTA_BUS_KEY) {
  const envPath = resolve(INSIGHTS, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^CTA_BUS_KEY=(.+)$/);
      if (m) {
        process.env.CTA_BUS_KEY = m[1].trim();
        break;
      }
    }
  }
}
if (!process.env.CTA_BUS_KEY) {
  console.error('CTA_BUS_KEY not set (looked at env and cta-insights/.env)');
  process.exit(1);
}

const BUS_BASE = 'https://www.ctabustracker.com/bustime/api/v3';

async function getPatterns(rt) {
  const url = `${BUS_BASE}/getpatterns?key=${process.env.CTA_BUS_KEY}&format=json&rt=${encodeURIComponent(rt)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for rt=${rt}`);
  const json = await res.json();
  const body = json['bustime-response'];
  if (body.error) {
    // "No data found" is benign — express/event routes have no defined patterns when inactive.
    const errors = Array.isArray(body.error) ? body.error : [body.error];
    const fatal = errors.filter((e) => !/no data found/i.test(e.msg || ''));
    if (fatal.length) throw new Error(`CTA getpatterns rt=${rt}: ${JSON.stringify(fatal)}`);
    return [];
  }
  return (body.ptr || []).map((ptr) => ({
    pid: ptr.pid,
    direction: ptr.rtdir,
    lengthFt: ptr.ln,
    points: ptr.pt.map((p) => ({
      seq: p.seq,
      lat: p.lat,
      lon: p.lon,
      type: p.typ,
      stopId: p.stpid,
      stopName: p.stpnm,
      pdist: p.pdist,
    })),
  }));
}

// Extract the `names` map from cta-insights without requiring it as a CJS module.
function loadRouteNames() {
  const src = readFileSync(resolve(INSIGHTS, 'src', 'bus', 'routes.js'), 'utf8');
  const start = src.indexOf('const names = {');
  if (start < 0) throw new Error('Could not find names map in cta-insights routes.js');
  // Walk braces to find the matching close.
  let depth = 0;
  let i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const objSrc = src.slice(open, i + 1);
  // Eval is safe here — input is our own checked-in source file.
  // eslint-disable-next-line no-new-func
  return new Function(`return ${objSrc};`)();
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(OUT_PATTERNS);

  const gtfs = JSON.parse(readFileSync(resolve(INSIGHTS, 'data', 'gtfs', 'index.json'), 'utf8'));
  const names = loadRouteNames();

  // Union: anything with a display name OR an entry in the GTFS index.
  const allRoutes = Array.from(new Set([...Object.keys(names), ...Object.keys(gtfs.routes)]));
  allRoutes.sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (na !== nb) return (Number.isNaN(na) ? 9999 : na) - (Number.isNaN(nb) ? 9999 : nb);
    return a.localeCompare(b);
  });

  const routes = {};
  const routePatterns = {};
  let fetched = 0;
  let skipped = 0;

  for (const rt of allRoutes) {
    const gtfsEntry = gtfs.routes[rt];
    let patterns = [];
    try {
      patterns = await getPatterns(rt);
    } catch (e) {
      console.warn(`  ${rt}: ${e.message}`);
    }

    if (patterns.length === 0 && !gtfsEntry) {
      // Nothing to say about this route — drop it.
      skipped++;
      continue;
    }

    routes[rt] = {
      name: names[rt] || rt,
      // Schedule shape inherited from cta-insights GTFS index (may be undefined for
      // night/seasonal routes; the planner treats undefined as "not running").
      gtfs: gtfsEntry || null,
      patternIds: patterns.map((p) => String(p.pid)),
    };

    if (patterns.length) {
      routePatterns[rt] = patterns.map((p) => String(p.pid));
      for (const p of patterns) {
        writeFileSync(resolve(OUT_PATTERNS, `${p.pid}.json`), JSON.stringify(p));
      }
      fetched++;
    }

    // Be polite — CTA's bustime endpoint isn't rate-limited per docs but bursts can flake.
    await new Promise((r) => setTimeout(r, 120));
    if ((fetched + skipped) % 20 === 0) {
      console.log(`  progress: ${fetched + skipped}/${allRoutes.length}`);
    }
  }

  // Trains: synthesize routes + patterns from cta-insights's train data files,
  // then merge into the same `routes`/`patterns` outputs so the planner can
  // treat them as just-another-route family with isTrain=true.
  const trains = buildTrains({ insightsRoot: INSIGHTS });
  let trainStops = 0;
  for (const [rt, r] of Object.entries(trains.routes)) {
    const gtfsLine = gtfs.lines?.[r.gtfsLineKey] || null;
    routes[rt] = {
      name: r.name,
      gtfs: gtfsLine, // same shape as bus route gtfs ({ 0: dirEntry, ... })
      patternIds: r.patternIds,
      isTrain: true,
      color: r.color,
      lineCode: r.lineCode,
    };
    routePatterns[rt] = r.patternIds;
  }
  for (const [pid, pattern] of Object.entries(trains.patterns)) {
    writeFileSync(resolve(OUT_PATTERNS, `${pid}.json`), JSON.stringify(pattern));
    trainStops += pattern.points.filter((p) => p.type === 'S').length;
  }

  writeFileSync(resolve(OUT_DIR, 'routes.json'), JSON.stringify(routes));
  writeFileSync(resolve(OUT_DIR, 'route-patterns.json'), JSON.stringify(routePatterns));

  // Bundle every pattern into one file. The runtime fetches this single
  // payload instead of 300+ tiny per-pattern requests, which is a massive
  // cold-load win over mobile networks. Individual patterns/<pid>.json are
  // also kept for the smoke script and ad-hoc tooling.
  const bundled = {};
  for (const pid of Object.keys(routePatterns).flatMap((rt) => routePatterns[rt])) {
    const path = resolve(OUT_PATTERNS, `${pid}.json`);
    if (existsSync(path)) bundled[pid] = JSON.parse(readFileSync(path, 'utf8'));
  }
  writeFileSync(resolve(OUT_DIR, 'patterns.json'), JSON.stringify(bundled));
  writeFileSync(
    resolve(OUT_DIR, 'meta.json'),
    JSON.stringify({
      generatedAt: Date.now(),
      gtfsGeneratedAt: gtfs.generatedAt,
      routeCount: Object.keys(routes).length,
      patternCount: Object.values(routePatterns).reduce((n, ps) => n + ps.length, 0),
      trainLineCount: Object.keys(trains.routes).length,
      trainStopCount: trainStops,
    }),
  );
  console.log(
    `done: ${Object.keys(routes).length} routes (${Object.keys(trains.routes).length} train lines), ${skipped} skipped`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
