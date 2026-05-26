import { describe, expect, it } from 'vitest';
import { leastCoveredArea } from '../lib/coverage.js';

const areas = [
  { name: 'A', routes: ['1', '2', '3'], center: [41.9, -87.7] }, // 3 unridden
  { name: 'B', routes: ['4', '5'], center: [41.8, -87.6] }, // 2 unridden
  { name: 'C', routes: ['6'], center: [41.7, -87.6] }, // 1 unridden
];

describe('leastCoveredArea', () => {
  it('picks the area with the most unridden routes', () => {
    expect(leastCoveredArea(new Set(), areas).name).toBe('A');
  });

  it('accounts for what you have ridden', () => {
    // A drops to 1 unridden, B stays 2 → B wins.
    const best = leastCoveredArea(new Set(['1', '2']), areas);
    expect(best.name).toBe('B');
    expect(best.unridden).toBe(2);
  });

  it('breaks ties by proximity to `from`', () => {
    const two = [
      { name: 'Near', routes: ['1', '2'], center: [41.85, -87.65] },
      { name: 'Far', routes: ['3', '4'], center: [42.0, -87.9] },
    ];
    expect(leastCoveredArea(new Set(), two, { lat: 41.85, lon: -87.65 }).name).toBe('Near');
  });

  it('returns null when everything is ridden', () => {
    expect(leastCoveredArea(new Set(['1', '2', '3', '4', '5', '6']), areas)).toBe(null);
  });
});
