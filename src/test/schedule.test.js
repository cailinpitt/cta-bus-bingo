// Schedule robustness against short-turn duration pollution (see the planner
// bug writeup). The baked duration index can mix a full run with a same-origin
// short-turn in one direction; these guard the runtime against the fallout.

import { describe, expect, it } from 'vitest';
import { headwayMinutes, isReducedService, minutesPerFoot } from '../lib/schedule.js';

// dir 0 short-turns at 10pm (10-min "full" run); dir 1 runs the full pattern.
const gtfs = {
  0: { headways: { weekday: { 22: 20 } }, durations: { weekday: { 14: 50, 22: 10 } } },
  1: { headways: { weekday: { 22: 22 } }, durations: { weekday: { 14: 48, 22: 45 } } },
};
const pattern = { pid: '999', lengthFt: 51000 }; // ~9.7 mi bus route
const now = new Date(2026, 4, 18, 22, 30); // Mon 10:30pm (local)

describe('isReducedService is per-direction', () => {
  it('does NOT flag a route whose other direction runs the full pattern', () => {
    // Old min-across-directions behavior wrongly excluded this route entirely.
    expect(isReducedService(gtfs, now)).toBe(false);
  });

  it('DOES flag a route reduced in every direction (e.g. Purple Line shuttle)', () => {
    const both = {
      0: { durations: { weekday: { 14: 50, 22: 10 } } },
      1: { durations: { weekday: { 14: 48, 22: 9 } } },
    };
    expect(isReducedService(both, now)).toBe(true);
  });

  it('returns false with no current-hour data', () => {
    const noData = { 0: { durations: { weekday: { 14: 50 } } } };
    expect(isReducedService(noData, now)).toBe(false);
  });
});

describe('minutesPerFoot drops short-turn artifacts', () => {
  it('ignores the implausibly-fast direction and uses the full run', () => {
    const estMin = pattern.lengthFt * minutesPerFoot(gtfs, pattern, now);
    // dir 0's 10-min sample (~58 mph) is dropped; dir 1's 45-min (~13 mph) wins.
    expect(estMin).toBeGreaterThan(30);
    expect(estMin).toBeLessThan(60);
  });

  it('falls back to a mode default when no plausible sample exists', () => {
    const allFast = { 0: { durations: { weekday: { 22: 5 } } } }; // ~116 mph, rejected
    const mpf = minutesPerFoot(allFast, pattern, now);
    // ~15 mph bus default => 51000 ft / 1320 ft/min ≈ 38.6 min
    expect(pattern.lengthFt * mpf).toBeCloseTo(51000 / 1320, 0);
  });

  it('uses a faster default for trains', () => {
    const trainPattern = { pid: 'train-red-fwd', lengthFt: 51000 };
    const mpf = minutesPerFoot(null, trainPattern, now);
    expect(pattern.lengthFt * mpf).toBeCloseTo(51000 / 2200, 0); // ~25 mph
  });
});

describe('headwayMinutes is direction-representative', () => {
  it('returns the median wait across directions, not the optimistic min', () => {
    expect(headwayMinutes(gtfs, now)).toBe(22); // median of [20, 22]
  });
});
