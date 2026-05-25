// A planned trip must survive serialize → storage (JSON) → rehydrate so a mobile
// reload / PWA relaunch restores the exact itinerary instead of losing it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shapeDataset } from '../lib/data.js';
import { augmentStopsForPlanning, planTrips } from '../lib/planner.js';
import { rehydratePlan, serializePlan } from '../lib/planSnapshot.js';
import { buildStopIndex } from '../lib/spatial.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');
function load() {
  const routes = JSON.parse(readFileSync(resolve(DATA, 'routes.json'), 'utf8'));
  const routePatterns = JSON.parse(readFileSync(resolve(DATA, 'route-patterns.json'), 'utf8'));
  const bundled = JSON.parse(readFileSync(resolve(DATA, 'patterns.json'), 'utf8'));
  return shapeDataset({ routes, routePatterns, patternList: Object.values(bundled) });
}
const dataset = load();
const stopIndex = buildStopIndex(dataset.stops);
augmentStopsForPlanning(dataset.stops, stopIndex, dataset.routes);
const now = new Date('2026-05-18T15:30:00-05:00');

function planOne() {
  return planTrips({
    dataset,
    start: { lat: 41.9395, lon: -87.6586 },
    end: null,
    ridden: new Set(),
    cap: 3,
    roundTrip: false,
    scheduleMode: 'today',
    now,
    stopIndex,
    noise: () => 0.5,
  });
}

describe('plan snapshot survives storage round-trip', () => {
  it('rehydrates legs with pattern + board/alight stops matching the original', () => {
    const result = planOne();
    expect(result.trips.length).toBeGreaterThan(0);
    const inputs = { start: { lat: 41.9395, lon: -87.6586, label: 'Belmont & Clark' }, cap: 3 };

    const snap = serializePlan({ result, selectedTrip: 1, inputs });
    const roundTripped = JSON.parse(JSON.stringify(snap)); // simulate localStorage
    const rehydrated = rehydratePlan(roundTripped, dataset);

    expect(rehydrated.trips.length).toBe(result.trips.length);
    for (let i = 0; i < result.trips.length; i++) {
      const orig = result.trips[i];
      const back = rehydrated.trips[i];
      expect(back.legs.length).toBe(orig.legs.length);
      expect(back.totalSeconds).toBe(orig.totalSeconds);
      for (let j = 0; j < orig.legs.length; j++) {
        const o = orig.legs[j];
        const b = back.legs[j];
        expect(b.rt).toBe(o.rt);
        expect(b.boardIdx).toBe(o.boardIdx);
        expect(b.alightIdx).toBe(o.alightIdx);
        expect(b.free).toBe(o.free);
        // Rehydrated geometry references the real dataset (needed by the map).
        expect(b.pattern).toBe(dataset.patterns[String(o.pattern.pid)]);
        expect(b.boardStop.stopId).toBe(o.boardStop.stopId);
        expect(b.alightStop.stopId).toBe(o.alightStop.stopId);
        expect(Array.isArray(b.pattern.points)).toBe(true);
      }
    }
    expect(roundTripped.selectedTrip).toBe(1);
    expect(roundTripped.inputs.cap).toBe(3);
  });

  it('drops trips whose patterns no longer exist instead of breaking', () => {
    const result = planOne();
    const snap = serializePlan({ result, selectedTrip: 0, inputs: {} });
    // Corrupt one trip's first leg to reference a missing pattern.
    snap.trips[0].legs[0].pid = 'does-not-exist';
    const rehydrated = rehydratePlan(JSON.parse(JSON.stringify(snap)), dataset);
    expect(rehydrated.trips.length).toBe(result.trips.length - 1);
  });

  it('returns null for an empty result', () => {
    expect(serializePlan({ result: null, selectedTrip: 0, inputs: {} })).toBe(null);
  });
});
