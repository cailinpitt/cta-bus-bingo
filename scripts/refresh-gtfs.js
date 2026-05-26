// Re-run buildGtfsIndex and patch each route's `gtfs` field in routes.json
// without re-fetching the bus pattern geometries. Faster than a full
// build-index when only the schedule index changed.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { buildGtfsIndex } from './build-gtfs-index.js';
import { matchPatternDirection } from './match-pattern-direction.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'public', 'data');
const OUT = resolve(DATA, 'routes.json');
const PATTERNS_FILE = resolve(DATA, 'patterns.json');

// Train route id (`train-red`) → GTFS rail key (`Red`). Mirrors build-trains.js.
const TRAIN_GTFS_KEY = {
  red: 'Red',
  blue: 'Blue',
  brn: 'Brn',
  g: 'G',
  org: 'Org',
  p: 'P',
  pink: 'Pink',
  y: 'Y',
};

const gtfs = await buildGtfsIndex();
const routes = JSON.parse(readFileSync(OUT, 'utf8'));
let updated = 0;
let noData = 0;
for (const [rt, route] of Object.entries(routes)) {
  const entry = route.isTrain
    ? (gtfs.lines?.[TRAIN_GTFS_KEY[rt.replace(/^train-/, '')]] ?? null)
    : (gtfs.routes?.[rt] ?? null);
  route.gtfs = entry;
  if (entry) updated++;
  else noData++;
}
writeFileSync(OUT, JSON.stringify(routes));
console.log(`routes refreshed: ${updated} with schedule data, ${noData} without`);

// Also refresh each bus pattern's GTFS-direction tag (it depends on the new
// dominant endpoints). Train patterns are left untouched.
const patterns = JSON.parse(readFileSync(PATTERNS_FILE, 'utf8'));
const pidToRoute = {};
for (const [rt, route] of Object.entries(routes)) {
  if (route.isTrain) continue;
  for (const pid of route.patternIds || []) pidToRoute[pid] = rt;
}
let matched = 0;
let unmatched = 0;
for (const [pid, p] of Object.entries(patterns)) {
  const rt = pidToRoute[pid];
  if (!rt) continue;
  const stops = p.points.filter((pt) => pt.type === 'S');
  if (!stops.length) continue;
  const dir = matchPatternDirection(
    stops[0].stopId,
    stops[stops.length - 1].stopId,
    gtfs.endpoints?.bus?.[rt],
  );
  p.gtfsDirectionId = dir;
  if (dir != null) matched++;
  else unmatched++;
}
writeFileSync(PATTERNS_FILE, JSON.stringify(patterns));
console.log(`pattern directions: ${matched} matched, ${unmatched} unmatched`);
