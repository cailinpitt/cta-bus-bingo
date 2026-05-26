// Integration test of the journey App drives end to end (minus the React/MapLibre
// shell): plan a trip, survive a reload via the snapshot, respect a newly-ridden
// route on replan, and target a coverage gap. Ties planner + planSnapshot +
// syncDoc + coverage together the way the UI wires them.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { leastCoveredArea } from '../lib/coverage.js';
import { shapeDataset } from '../lib/data.js';
import { augmentStopsForPlanning, planTrips } from '../lib/planner.js';
import { rehydratePlan, serializePlan } from '../lib/planSnapshot.js';
import { buildStopIndex } from '../lib/spatial.js';
import { applyDelta, docToSet } from '../lib/syncDoc.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');
const read = (f) => JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));

const dataset = shapeDataset({
  routes: read('routes.json'),
  routePatterns: read('route-patterns.json'),
  patternList: Object.values(read('patterns.json')),
});
const stopIndex = buildStopIndex(dataset.stops);
augmentStopsForPlanning(dataset.stops, stopIndex, dataset.routes);
const neighborhoods = read('neighborhoods.json').areas;

const start = { lat: 41.9395, lon: -87.6586 }; // Belmont & Clark
const now = new Date('2026-05-18T15:30:00-05:00');
const plan = (ridden) =>
  planTrips({
    dataset,
    start,
    end: null,
    ridden,
    cap: 3,
    roundTrip: false,
    scheduleMode: 'today',
    now,
    stopIndex,
    noise: () => 0.5,
  });

describe('planning flow', () => {
  it('plans, restores the exact trip after a reload, and drops newly-ridden routes', () => {
    const { trips } = plan(new Set());
    expect(trips.length).toBeGreaterThan(0);
    const trip = trips[0];
    const newRoutes = trip.legs.filter((l) => !l.free).map((l) => l.rt);
    expect(newRoutes.length).toBeGreaterThan(0);

    // Reload: serialize → storage (JSON) → rehydrate restores the same legs.
    const snap = JSON.parse(
      JSON.stringify(
        serializePlan({
          result: { trips, suggestedStart: null, start, end: null },
          selectedTrip: 0,
          inputs: {},
        }),
      ),
    );
    const restored = rehydratePlan(snap, dataset);
    expect(restored.trips[0].legs.map((l) => l.rt)).toEqual(trip.legs.map((l) => l.rt));

    // Mark the first new route ridden (the LWW-doc path) → it's never a new leg
    // in a subsequent plan.
    const ridden = docToSet(applyDelta(undefined, [newRoutes[0]], [], Date.now()));
    for (const t of plan(ridden).trips) {
      for (const leg of t.legs.filter((l) => !l.free)) {
        expect(leg.rt).not.toBe(newRoutes[0]);
      }
    }
  });

  it('targets a community area that still has unridden routes', () => {
    const target = leastCoveredArea(new Set(), neighborhoods, start);
    expect(target).not.toBe(null);
    expect(target.unridden).toBeGreaterThan(0);
    expect(target.center).toHaveLength(2);
  });
});
