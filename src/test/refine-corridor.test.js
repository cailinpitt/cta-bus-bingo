// Regression: the 93 → 97 "ride north to Mulford, then double back south" case.
// 93 boards at California & Lunt; the natural transfer to the 97 is Howard &
// Dodge (where they cross), but that's only ~0.71 mi north — under MIN_RIDE_FT.
// The old refinement left the transfer at the 97's Mulford terminal, so the 97
// backtracked south before heading east. Corridor-relief should drop the
// transfer to the Howard crossing (both legs >= 0.5 mi, no backtrack).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shapeDataset } from '../lib/data.js';
import { haversineFeet } from '../lib/geo.js';
import { refineTransfers } from '../lib/planner.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');
function load() {
  const routes = JSON.parse(readFileSync(resolve(DATA, 'routes.json'), 'utf8'));
  const routePatterns = JSON.parse(readFileSync(resolve(DATA, 'route-patterns.json'), 'utf8'));
  const bundled = JSON.parse(readFileSync(resolve(DATA, 'patterns.json'), 'utf8'));
  return shapeDataset({ routes, routePatterns, patternList: Object.values(bundled) });
}
const dataset = load();
const now = new Date('2026-05-18T15:30:00-05:00');

function makeLeg(rt, pid, boardStopId, alightStopId) {
  const pattern = dataset.patterns[pid];
  const boardIdx = pattern.stopIdToIdx.get(boardStopId);
  const alightIdx = pattern.stopIdToIdx.get(alightStopId);
  return {
    rt,
    pattern,
    boardIdx,
    alightIdx,
    boardStop: pattern.stops[boardIdx],
    alightStop: pattern.stops[alightIdx],
    rideFt: pattern.stops[alightIdx].pdist - pattern.stops[boardIdx].pdist,
    rideSeconds: 0,
    walkFeet: 0,
    walkSeconds: 0,
    free: false,
  };
}

const MULFORD_LAT = 42.0229; // Dodge & Mulford (terminal); Howard crossing ~42.0193

describe('corridor-backtrack relief (93 → 97)', () => {
  it('moves the transfer to the Howard crossing instead of the Mulford terminal', () => {
    const chain = [
      makeLeg('93', '29254', '11915', '3525'), // California & Lunt -> Dodge & Mulford (overshoot)
      makeLeg('97', '4369', '3620', '3629'), // Dodge & Mulford -> Howard & Ridge (backtracks south)
    ];
    // Sanity: the input really is the out-and-back (transfer at Mulford terminal).
    expect(chain[0].alightStop.lat).toBeGreaterThan(MULFORD_LAT - 0.001);
    expect(chain[1].boardStop.lat).toBeGreaterThan(MULFORD_LAT - 0.001);

    refineTransfers(chain, dataset, now, { allowLastAlightMove: true });

    const [a, b] = chain;
    // Both the 93 alight and the 97 board moved south to the Howard crossing.
    expect(a.alightStop.lat).toBeLessThan(42.021);
    expect(b.boardStop.lat).toBeLessThan(42.021);
    // The transfer is a short walk and the 97 now heads east (no south backtrack).
    expect(haversineFeet(a.alightStop, b.boardStop)).toBeLessThanOrEqual(660);
    expect(b.alightStop.lon).toBeGreaterThan(b.boardStop.lon); // eastbound
    // Both legs still ride at least the 0.5 mi relief floor.
    expect(a.rideFt).toBeGreaterThanOrEqual(2640);
    expect(b.rideFt).toBeGreaterThanOrEqual(2640);
  });
});
