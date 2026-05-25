// Schedule robustness against short-turn duration pollution (see the planner
// bug writeup). The baked duration index can mix a full run with a same-origin
// short-turn in one direction; these guard the runtime against the fallout.

import { describe, expect, it } from 'vitest';
import {
  dayTypeKey,
  frequencyForDay,
  headwayMinutes,
  isCtaHoliday,
  isReducedService,
  minutesPerFoot,
  runsAtHour,
  runsToday,
} from '../lib/schedule.js';

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

describe('frequencyForDay', () => {
  const freqGtfs = {
    0: {
      headways: { weekday: { 6: 10, 7: 8, 12: 12 } },
      durations: { weekday: { 6: 40, 12: 45 } },
    },
    1: { headways: { weekday: { 6: 12, 7: 9 } } },
  };
  const ordinaryWed = new Date(2026, 4, 20, 12); // a plain weekday

  it('returns sorted per-hour headways/durations for the day type', () => {
    const f = frequencyForDay(freqGtfs, ordinaryWed);
    expect(f.map((x) => x.hour)).toEqual([6, 7, 12]); // hours with a headway, sorted
    expect(f.find((x) => x.hour === 6).headwayMin).toBe(12); // median of [10, 12]
    expect(f.find((x) => x.hour === 6).durationMin).toBe(40);
    expect(f.find((x) => x.hour === 7).durationMin).toBe(null); // no duration that hour
  });

  it('is empty when the route has no service that day type', () => {
    const weekdayOnly = { 0: { headways: { weekday: { 8: 10 } } } };
    expect(frequencyForDay(weekdayOnly, new Date(2026, 4, 24, 12))).toEqual([]); // a Sunday
  });
});

describe('CTA holiday schedule (Sunday service)', () => {
  it('recognizes the six Sunday-schedule holidays', () => {
    expect(isCtaHoliday(new Date(2026, 0, 1))).toBe(true); // New Year's Day
    expect(isCtaHoliday(new Date(2026, 4, 25))).toBe(true); // Memorial Day (Mon)
    expect(isCtaHoliday(new Date(2026, 6, 4))).toBe(true); // Independence Day
    expect(isCtaHoliday(new Date(2026, 8, 7))).toBe(true); // Labor Day (1st Mon Sep)
    expect(isCtaHoliday(new Date(2026, 10, 26))).toBe(true); // Thanksgiving (4th Thu Nov)
    expect(isCtaHoliday(new Date(2026, 11, 25))).toBe(true); // Christmas Day
  });

  it('does not flag ordinary days or the wrong Monday in May', () => {
    expect(isCtaHoliday(new Date(2026, 4, 18))).toBe(false); // 3rd Monday of May
    expect(isCtaHoliday(new Date(2026, 4, 26))).toBe(false); // day after Memorial Day
    expect(isCtaHoliday(new Date(2026, 6, 3))).toBe(false);
  });

  it('maps a weekday holiday to the Sunday day-type', () => {
    expect(dayTypeKey(new Date(2026, 4, 25, 12))).toBe('sunday'); // Memorial Day (Mon)
    expect(dayTypeKey(new Date(2026, 4, 18, 12))).toBe('weekday'); // ordinary Monday
  });

  it('a weekday-only route does not run on a weekday holiday', () => {
    const weekdayOnly = { 0: { headways: { weekday: { 8: 10, 12: 12, 17: 9 } } } };
    const holiday = new Date(2026, 4, 25, 12); // Memorial Day
    const ordinary = new Date(2026, 4, 18, 12); // ordinary Monday
    expect(runsToday(weekdayOnly, ordinary)).toBe(true);
    expect(runsToday(weekdayOnly, holiday)).toBe(false);
    expect(runsAtHour(weekdayOnly, holiday)).toBe(false);
  });
});
