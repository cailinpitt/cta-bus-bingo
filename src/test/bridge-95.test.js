// Regression: from Devon & Glenwood (far north) to 95th & Vanderpoel (deep
// south), with 95 + Red Line already ridden, every trip that "reachedEnd"
// should include the 95 bus as a free bridge hop (or at least land within
// reasonable walking distance of the destination). Without it the user is
// asked to walk ~2 mi from the Red Line terminus.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { augmentStopsForPlanning, planTrips } from '../lib/planner.js';
import { buildStopIndex } from '../lib/spatial.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

function loadDatasetSync() {
  const routes = JSON.parse(readFileSync(resolve(DATA, 'routes.json'), 'utf8'));
  const routePatterns = JSON.parse(readFileSync(resolve(DATA, 'route-patterns.json'), 'utf8'));
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
    const stopIdToIdx = new Map();
    for (let i = 0; i < stopPoints.length; i++) stopIdToIdx.set(stopPoints[i].stopId, i);
    patterns[pid] = { ...p, pid, rt, stops: stopPoints, stopIdToIdx };
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

describe('bridge phase picks ridden buses to close the last mile', () => {
  const dataset = loadDatasetSync();
  const stopIndex = buildStopIndex(dataset.stops);
  augmentStopsForPlanning(dataset.stops, stopIndex, dataset.routes);

  // Devon & Glenwood (far north Edgewater) -> 1818 W 99th St (Beverly).
  // The destination is 0.5 mi SOUTH of 95th, off the 95-bus's east-west
  // route — so the closest transit drop-off is ~95th & Wood, ~0.5 mi away.
  const start = { lat: 41.998, lon: -87.665 };
  const end = { lat: 41.713, lon: -87.671 };
  // Actual ridden export from the user's localStorage. Trains are always
  // free connectors regardless of ridden state.
  const ridden = new Set([
    '146',
    '147',
    '152',
    '155',
    '157',
    '21',
    '22',
    '28',
    '31',
    '35',
    '37',
    '4',
    '49',
    '50',
    '53',
    '55',
    '56',
    '6',
    '62',
    '65',
    '66',
    '67',
    '70',
    '72',
    '73',
    '74',
    '76',
    '77',
    '8',
    '80',
    '81',
    '9',
    '94',
    '95',
    'J14',
    'X49',
    'X9',
  ]);
  const now = new Date('2026-05-18T15:30:00-05:00');

  // Direct repro of the user's complaint: "Option 2 reaches the destination
  // but Options 1 and 3 strand me 2+ miles away." The pool filter is
  // supposed to enforce: when ANY plan reaches, only reaching plans are
  // returned. Run many times to flush out intermittency.
  it('never returns a mix of reaching and non-reaching trips', { timeout: 30000 }, () => {
    let violations = 0;
    let runs = 0;
    let totalReached = 0;
    for (let i = 0; i < 10; i++) {
      const { trips } = planTrips({
        dataset,
        start,
        end,
        ridden,
        cap: 3,
        roundTrip: false,
        scheduleMode: 'today',
        now,
        stopIndex,
      });
      if (trips.length === 0) continue;
      runs++;
      const reached = trips.filter((t) => t.reachedEnd);
      totalReached += reached.length;
      if (reached.length > 0 && reached.length < trips.length) {
        violations++;
        // Throw on first violation so the assertion message is informative.
        const mixed = trips.map((t, idx) => {
          const last = t.legs[t.legs.length - 1];
          return `  Option ${idx + 1} [${t.reachedEnd ? 'REACHED' : 'STRANDED'}]: ${t.legs.map((l) => l.rt).join(' -> ')} (ends at ${last.alightStop.stopName})`;
        });
        throw new Error(`Pool mixed reaching + non-reaching trips:\n${mixed.join('\n')}`);
      }
    }
    expect(violations).toBe(0);
    expect(runs).toBeGreaterThan(0);
    expect(totalReached).toBeGreaterThan(0);
  });

  it('most planning runs surface multiple distinct trips that reach', { timeout: 30000 }, () => {
    // A user shouldn't see "Option 1 reached, Options 2-3 strand you 2 mi
    // away" — that was the wandering-Phase-1 bug. Across many runs, the
    // majority of returned trips should reach the destination.
    let totalTrips = 0;
    let reachedTrips = 0;
    for (let i = 0; i < 12; i++) {
      const { trips } = planTrips({
        dataset,
        start,
        end,
        ridden,
        cap: 3,
        roundTrip: false,
        scheduleMode: 'today',
        now,
        stopIndex,
      });
      totalTrips += trips.length;
      reachedTrips += trips.filter((t) => t.reachedEnd).length;
    }
    expect(reachedTrips / totalTrips).toBeGreaterThan(0.8);
  });

  it('produces at least one trip that reaches the destination', () => {
    const { trips } = planTrips({
      dataset,
      start,
      end,
      ridden,
      cap: 3,
      roundTrip: false,
      scheduleMode: 'today',
      now,
      stopIndex,
      noise: () => 0.5, // deterministic — no per-run randomness
    });
    expect(trips.length).toBeGreaterThan(0);
    expect(trips.some((t) => t.reachedEnd)).toBe(true);
  });

  // Run a non-deterministic batch so the intermittent "Option 1 has no 95"
  // failure mode has a chance to surface. With Math.random as noise, some
  // Phase-1 chains end at awkward positions and the bridge has to recover.
  function runMany(iterations) {
    const reachedTrips = [];
    for (let i = 0; i < iterations; i++) {
      const { trips } = planTrips({
        dataset,
        start,
        end,
        ridden,
        cap: 3,
        roundTrip: false,
        scheduleMode: 'today',
        now,
        stopIndex,
      });
      for (const t of trips.filter((p) => p.reachedEnd)) reachedTrips.push(t);
    }
    return reachedTrips;
  }

  it('every reached-end trip lands within 0.75 mi of the destination', () => {
    const trips = runMany(8);
    expect(trips.length).toBeGreaterThan(0);
    for (const t of trips) {
      const last = t.legs[t.legs.length - 1];
      const dLat = last.alightStop.lat - end.lat;
      const dLon = last.alightStop.lon - end.lon;
      const ft = Math.sqrt((dLat * 364000) ** 2 + (dLon * 278900) ** 2);
      expect(
        ft,
        `trip ${t.legs.map((l) => l.rt).join(' -> ')} ends at ${last.alightStop.stopName} (${Math.round(ft)} ft from end)`,
      ).toBeLessThan(0.75 * 5280);
    }
  });

  it('also reaches with scheduleMode=now (the app default)', { timeout: 30000 }, () => {
    // Mirrors the browser default: 'now' + real current time.
    let runs = 0;
    let violations = 0;
    let reached = 0;
    for (let i = 0; i < 6; i++) {
      const { trips } = planTrips({
        dataset,
        start,
        end,
        ridden,
        cap: 3,
        roundTrip: false,
        scheduleMode: 'now',
        now: new Date(),
        stopIndex,
      });
      if (trips.length === 0) continue;
      runs++;
      const r = trips.filter((t) => t.reachedEnd);
      reached += r.length;
      if (r.length > 0 && r.length < trips.length) {
        violations++;
        const mixed = trips.map((t, idx) => {
          const last = t.legs[t.legs.length - 1];
          return `  Option ${idx + 1} [${t.reachedEnd ? 'REACHED' : 'STRANDED'}]: ${t.legs.map((l) => l.rt).join(' -> ')} (ends at ${last.alightStop.stopName})`;
        });
        throw new Error(`Mixed reaching + non-reaching (now mode):\n${mixed.join('\n')}`);
      }
    }
    expect(violations).toBe(0);
    expect(runs).toBeGreaterThan(0);
    expect(reached).toBeGreaterThan(0);
  });
});
