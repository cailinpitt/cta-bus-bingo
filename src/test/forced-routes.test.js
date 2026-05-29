// Regression coverage for the forced-route planning engine that powers the
// remove / swap / lock itinerary edits. Forcing a route list must reproduce
// exactly those bingo routes, in order, and swap candidates must connect.

import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { shapeDataset } from '../lib/data.js';
import { augmentStopsForPlanning, planTrips, swapCandidates } from '../lib/planner.js';
import { buildStopIndex } from '../lib/spatial.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

let dataset;
let stopIndex;
const now = new Date('2026-05-28T14:00:00');
const start = { lat: 41.9, lon: -87.7 };

beforeAll(() => {
  dataset = shapeDataset({
    routes: readJson('public/data/routes.json'),
    routePatterns: readJson('public/data/route-patterns.json'),
    patternList: Object.values(readJson('public/data/patterns.json')),
  });
  stopIndex = buildStopIndex(dataset.stops);
  augmentStopsForPlanning(dataset.stops, stopIndex, dataset.routes);
});

const bingoRoutes = (trip) => trip.legs.filter((l) => !l.free).map((l) => l.rt);

describe('forced-route planning', () => {
  it('reproduces a forced bingo route list, in order', () => {
    const base = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: 3,
      scheduleMode: 'now',
      now,
      stopIndex,
      noise: () => 0.5,
    }).trips[0];
    expect(base).toBeTruthy();
    const routes = bingoRoutes(base);
    expect(routes.length).toBeGreaterThan(0);

    const forced = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: routes.length,
      scheduleMode: 'now',
      now,
      stopIndex,
      forcedRoutes: routes,
    }).trips[0];
    expect(forced).toBeTruthy();
    expect(bingoRoutes(forced)).toEqual(routes);
  });

  it('removing a leg drops that route and keeps the survivors in order', () => {
    const base = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: 3,
      scheduleMode: 'now',
      now,
      stopIndex,
      noise: () => 0.5,
    }).trips[0];
    const routes = bingoRoutes(base);
    if (routes.length < 2) return; // need at least two to remove one
    const removed = routes[Math.floor(routes.length / 2)];
    const kept = routes.filter((rt) => rt !== removed);

    const r = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: kept.length,
      scheduleMode: 'now',
      now,
      stopIndex,
      forcedRoutes: kept,
      bannedRoutes: new Set([removed]),
    }).trips[0];
    expect(r).toBeTruthy();
    const got = bingoRoutes(r);
    // The removed route is gone — never a leg.
    expect(got).not.toContain(removed);
    expect(got.length).toBeGreaterThan(0);
    // Survivors keep their order; the forced chain may stop early if one can't
    // reconnect, so the result is a prefix of `kept` (the app then falls back to
    // a fresh, still-banned plan when even that happens — covered in the UI).
    expect(got).toEqual(kept.slice(0, got.length));
  });

  it('a banned route never appears anywhere — not even as a connector or bridge', () => {
    const base = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: 3,
      scheduleMode: 'now',
      now,
      stopIndex,
      noise: () => 0.5,
    }).trips[0];
    expect(base).toBeTruthy();
    // Ban a route the unbanned plan actually used, then confirm it's absent from
    // every leg (bingo legs, free connectors, and bridge hops alike).
    const banned = base.legs[0].rt;
    const r = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: 3,
      scheduleMode: 'now',
      now,
      stopIndex,
      bannedRoutes: new Set([banned]),
    }).trips[0];
    if (r) expect(r.legs.map((l) => l.rt)).not.toContain(banned);
  });

  it('swap candidates connect and exclude the routes already in the trip', () => {
    const base = planTrips({
      dataset,
      start,
      ridden: new Set(),
      cap: 3,
      scheduleMode: 'now',
      now,
      stopIndex,
      noise: () => 0.5,
    }).trips[0];
    const legIdx = base.legs.findIndex((l) => !l.free);
    const original = base.legs[legIdx].rt;
    const others = bingoRoutes(base).filter((_, i) => i !== 0);

    const cands = swapCandidates({
      dataset,
      start,
      ridden: new Set(),
      scheduleMode: 'now',
      now,
      stopIndex,
      plan: base,
      legIdx,
      max: 6,
    });
    for (const c of cands) {
      const got = bingoRoutes(c.trip);
      expect(got).toContain(c.rt); // the candidate actually rides
      expect(got.length).toBe(bingoRoutes(base).length); // full-length, all stitched
      // The candidate is a genuine alternative, not the route it replaced…
      expect(c.rt).not.toBe(original);
      // …and the other (pinned) routes are preserved.
      for (const rt of others) expect(got).toContain(rt);
    }
  });
});
