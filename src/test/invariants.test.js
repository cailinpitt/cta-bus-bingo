// Planner invariants — properties that must hold for any plan the planner
// returns, regardless of input. If one of these starts failing, the bug is
// in the planner not in any specific scenario.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shapeDataset } from '../lib/data.js';
import { haversineFeet } from '../lib/geo.js';
import { _consts, augmentStopsForPlanning, planTrips } from '../lib/planner.js';
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

const scenarios = [
  {
    name: 'Belmont & Clark, no ridden',
    start: { lat: 41.9395, lon: -87.6586 },
    end: null,
    ridden: new Set(),
    cap: 3,
    roundTrip: false,
  },
  {
    name: 'Lincoln Square -> Loop, some ridden',
    start: { lat: 41.975, lon: -87.689 },
    end: { lat: 41.882, lon: -87.629 },
    ridden: new Set(['22', '49B', '50', '11']),
    cap: 3,
    roundTrip: false,
  },
  {
    name: 'Round trip from Logan Square',
    start: { lat: 41.9295, lon: -87.7088 },
    end: null,
    ridden: new Set(['56']),
    cap: 3,
    roundTrip: true,
  },
];

const now = new Date('2026-05-18T15:30:00-05:00');

function planAll(s) {
  const { trips } = planTrips({
    dataset,
    start: s.start,
    end: s.end,
    ridden: s.ridden,
    cap: s.cap,
    roundTrip: s.roundTrip,
    scheduleMode: 'today',
    now,
    stopIndex,
    noise: () => 0.5,
  });
  return trips;
}

describe('planner invariants', () => {
  it.each(scenarios)('$name: non-free legs are never an already-ridden route', (s) => {
    for (const t of planAll(s)) {
      for (const leg of t.legs.filter((l) => !l.free)) {
        expect(s.ridden.has(leg.rt), `leg ${leg.rt} is in ridden set but marked non-free`).toBe(
          false,
        );
      }
    }
  });

  it.each(scenarios)('$name: alight stops do not backtrack', (s) => {
    for (const t of planAll(s)) {
      const seen = [];
      for (const leg of t.legs) {
        for (const prior of seen) {
          if (prior === leg.alightStop) continue;
          // Only check strictly prior stops, not the immediate board.
        }
        // The planner's BACKTRACK_FT rule applies to alight vs PRIOR (not
        // current-leg) stops. So check against everything in `seen` before
        // we add this leg's stops.
        for (const prior of seen) {
          const d = haversineFeet(leg.alightStop, prior);
          expect(
            d,
            `leg ${leg.rt} alight ${leg.alightStop.stopName} sits ${Math.round(d)} ft from a prior stop (BACKTRACK_FT=${_consts.BACKTRACK_FT})`,
          ).toBeGreaterThanOrEqual(_consts.BACKTRACK_FT);
        }
        seen.push(leg.boardStop, leg.alightStop);
      }
    }
  });

  it.each(scenarios)('$name: no transfer walk exceeds MAX_WALK_FT', (s) => {
    // refineTransfers must never slide a transfer past the boarding radius.
    for (const t of planAll(s)) {
      for (let i = 1; i < t.legs.length; i++) {
        const w = haversineFeet(t.legs[i - 1].alightStop, t.legs[i].boardStop);
        expect(
          w,
          `transfer ${t.legs[i - 1].rt} -> ${t.legs[i].rt} walks ${Math.round(w)} ft (MAX_WALK_FT=${_consts.MAX_WALK_FT})`,
        ).toBeLessThanOrEqual(_consts.MAX_WALK_FT + 1);
      }
    }
  });

  it('round-trip plans actually return to start (real last leg, not just index cap-1)', { timeout: 30000 }, () => {
    // Stress the early-termination path with a heavy ridden set + several starts.
    const allBus = Object.keys(dataset.routes).filter((r) => !dataset.routes[r].isTrain);
    const heavyRidden = new Set(allBus.filter((_, i) => i % 3 !== 0)); // ~2/3 ridden
    const starts = [
      { lat: 41.9395, lon: -87.6586 },
      { lat: 41.8757, lon: -87.6243 },
      { lat: 41.7983, lon: -87.5938 },
    ];
    for (const start of starts) {
      for (let cap = 1; cap <= 3; cap++) {
        const { trips } = planTrips({
          dataset,
          start,
          end: null,
          ridden: heavyRidden,
          cap,
          roundTrip: true,
          scheduleMode: 'today',
          now,
          stopIndex,
          noise: () => 0.5,
        });
        for (const t of trips) {
          if (t.legs.length === 0) continue;
          // Plans flagged reachedStart!==false claim to loop back; verify the
          // genuine final leg lands within range. (reachedStart===false is the
          // honest "couldn't loop back" fallback and is surfaced in the UI.)
          if (t.reachedStart === false) continue;
          const last = t.legs[t.legs.length - 1];
          const d = haversineFeet(last.alightStop, start);
          expect(
            d,
            `round-trip last leg ${last.alightStop.stopName} sits ${Math.round(d)} ft from start`,
          ).toBeLessThanOrEqual(_consts.ROUND_TRIP_FT);
        }
      }
    }
  });

  it('round-trip plans end within ROUND_TRIP_FT of start', () => {
    const s = scenarios.find((x) => x.roundTrip);
    for (const t of planAll(s)) {
      if (t.legs.length === 0) continue;
      // Last UNRIDDEN leg's alight is the round-trip-binding stop. After
      // that, free-bridge legs may extend somewhere else.
      const lastUnridden = [...t.legs].reverse().find((l) => !l.free);
      if (!lastUnridden) continue;
      const d = haversineFeet(lastUnridden.alightStop, s.start);
      expect(
        d,
        `round-trip last unridden alight ${lastUnridden.alightStop.stopName} sits ${Math.round(d)} ft from start (ROUND_TRIP_FT=${_consts.ROUND_TRIP_FT})`,
      ).toBeLessThanOrEqual(_consts.ROUND_TRIP_FT);
    }
  });

  it.each(scenarios)('$name: no two consecutive bus legs share the same route', (s) => {
    for (const t of planAll(s)) {
      for (let i = 1; i < t.legs.length; i++) {
        const prev = t.legs[i - 1];
        const cur = t.legs[i];
        const prevIsTrain = !!dataset.routes[prev.rt]?.isTrain;
        const curIsTrain = !!dataset.routes[cur.rt]?.isTrain;
        if (prevIsTrain || curIsTrain) continue; // trains can repeat
        expect(
          cur.rt === prev.rt,
          `consecutive same-bus legs (${prev.rt} -> ${cur.rt}) in: ${t.legs.map((l) => l.rt).join(' -> ')}`,
        ).toBe(false);
      }
    }
  });
});
