// Quick non-React smoke test: load the baked dataset directly from disk and
// run the planner from a known starting point. Confirms data integrity + that
// the planner returns a sensible chain before we wire up the UI.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planTrip, planTrips } from '../src/lib/planner.js';
import { buildStopIndex } from '../src/lib/spatial.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

function loadDatasetSync() {
  const routes = JSON.parse(readFileSync(resolve(DATA, 'routes.json'), 'utf8'));
  const routePatterns = JSON.parse(readFileSync(resolve(DATA, 'route-patterns.json'), 'utf8'));
  // route-patterns.json is bus-only (legacy); train pids are listed in routes.json.
  for (const [rt, r] of Object.entries(routes)) {
    if (r.isTrain && !routePatterns[rt]) routePatterns[rt] = r.patternIds;
  }
  const pidToRoute = {};
  for (const [rt, pids] of Object.entries(routePatterns)) {
    for (const pid of pids) pidToRoute[pid] = rt;
  }
  const patterns = {};
  const stops = {};
  for (const file of readdirSync(resolve(DATA, 'patterns'))) {
    const p = JSON.parse(readFileSync(resolve(DATA, 'patterns', file), 'utf8'));
    const pid = String(p.pid);
    const rt = pidToRoute[pid];
    const stopPoints = p.points
      .filter((pt) => pt.type === 'S' && pt.stopId)
      .map((pt) => ({
        stopId: String(pt.stopId),
        stopName: pt.stopName,
        lat: pt.lat,
        lon: pt.lon,
        pdist: pt.pdist,
        seq: pt.seq,
      }));
    patterns[pid] = { ...p, pid, rt, stops: stopPoints };
    for (const s of stopPoints) {
      if (!stops[s.stopId]) {
        stops[s.stopId] = {
          stopId: s.stopId,
          stopName: s.stopName,
          lat: s.lat,
          lon: s.lon,
          routes: new Set(),
        };
      }
      stops[s.stopId].routes.add(rt);
    }
  }
  return { routes, patterns, stops };
}

const dataset = loadDatasetSync();
console.log(
  `loaded: ${Object.keys(dataset.routes).length} routes, ${Object.keys(dataset.patterns).length} patterns, ${Object.keys(dataset.stops).length} stops`,
);

const stopIndex = buildStopIndex(dataset.stops);

// Belmont & Clark — popular north-side transfer point.
const start = { lat: 41.9395, lon: -87.6586 };
const ridden = new Set();
// Force "weekday afternoon" so we're not at the mercy of when this test runs.
const now = new Date('2026-05-18T15:30:00-05:00');

// Single-plan smoke
const plan = planTrip({
  dataset,
  start,
  ridden,
  cap: 3,
  roundTrip: false,
  scheduleMode: 'today',
  now,
  stopIndex,
});
const totalMin = Math.round(plan.totalSeconds / 60);
console.log(`single: ${plan.legs.length} legs, ${totalMin} min`);
for (const l of plan.legs) {
  const marker = l.free ? '   [FREE]' : '  ';
  console.log(
    `${marker} ${l.rt} board "${l.boardStop.stopName}" -> alight "${l.alightStop.stopName}" walk ${Math.round(l.walkFeet)} ft ride ${Math.round(l.rideSeconds / 60)}min`,
  );
}

// Multi-trip
console.log('\nmulti-trip:');
const t0 = Date.now();
const { trips } = planTrips({
  dataset,
  start,
  ridden,
  cap: 3,
  roundTrip: false,
  scheduleMode: 'today',
  now,
  stopIndex,
});
console.log(`computed ${trips.length} trips in ${Date.now() - t0}ms`);
for (let i = 0; i < trips.length; i++) {
  const t = trips[i];
  const rts = t.legs.map((l) => (l.free ? `[${l.rt}]` : l.rt)).join(' -> ');
  console.log(
    `  trip ${i + 1}: ${t.newRouteCount} new, ${Math.round(t.totalSeconds / 60)} min :: ${rts}`,
  );
}

// Multi-trip from a far-from-buses spot (Wrigley area) to test trains as connector.
console.log('\nfar start (Lincoln Square center, train should help):');
const farStart = { lat: 41.975, lon: -87.689 };
const farRidden = new Set(['22', '11', '49B', '50']); // pretend we've ridden some Lincoln Square buses
const { trips: farTrips } = planTrips({
  dataset,
  start: farStart,
  ridden: farRidden,
  cap: 3,
  roundTrip: false,
  scheduleMode: 'today',
  now,
  stopIndex,
});
for (let i = 0; i < farTrips.length; i++) {
  const t = farTrips[i];
  const rts = t.legs.map((l) => (l.free ? `[${l.rt}]` : l.rt)).join(' -> ');
  console.log(
    `  trip ${i + 1}: ${t.newRouteCount} new, ${Math.round(t.totalSeconds / 60)} min :: ${rts}`,
  );
  for (const l of t.legs) {
    const mk = l.free ? '   [FREE]' : '         ';
    console.log(`${mk} ${l.rt} ${l.boardStop.stopName} -> ${l.alightStop.stopName}`);
  }
}
