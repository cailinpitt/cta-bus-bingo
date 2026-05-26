import { describe, expect, it } from 'vitest';
import {
  countAchievements,
  countCardContent,
  neighborhoodAchievements,
  neighborhoodCardContent,
} from '../lib/achievements.js';

describe('countAchievements', () => {
  it('marks milestones at/below the ridden count as earned', () => {
    const a = countAchievements(50, 123);
    const earned = a.filter((m) => m.earned).map((m) => m.threshold);
    expect(earned).toEqual([10, 25, 50]);
    expect(a.find((m) => m.threshold === 75).remaining).toBe(25);
  });

  it('drops milestones at or above the route total and adds an "every route" one', () => {
    const a = countAchievements(0, 80);
    expect(a.some((m) => m.threshold === 100)).toBe(false); // 100 >= 80
    const all = a.find((m) => m.id === 'count-all');
    expect(all.threshold).toBe(80);
    expect(all.earned).toBe(false);
  });

  it('earns "every route" only at full coverage', () => {
    expect(countAchievements(123, 123).find((m) => m.id === 'count-all').earned).toBe(true);
    expect(countAchievements(122, 123).find((m) => m.id === 'count-all').earned).toBe(false);
  });
});

describe('countCardContent', () => {
  it('shows the milestone and its share of the network', () => {
    const c = countCardContent(50, { total: 123, isAll: false });
    expect(c.title).toBe('50 routes ridden');
    expect(c.sub).toBe('41% of all 123 CTA bus routes');
    expect(c.ring).toEqual({ value: 50, max: 123, big: '50', label: 'routes' });
  });

  it('has a full-bingo variant', () => {
    const c = countCardContent(123, { total: 123, isAll: true });
    expect(c.ring.big).toBe('✓');
    expect(c.ring.value).toBe(123);
  });
});

describe('neighborhoodAchievements', () => {
  const areas = [
    { name: 'Hegewisch', routes: ['30'] },
    { name: 'Rogers Park', routes: ['22', '36', '147'] },
  ];

  it('earns an area only when every serving route is ridden', () => {
    const a = neighborhoodAchievements(new Set(['30', '22']), areas);
    const heg = a.find((h) => h.name === 'Hegewisch');
    const rp = a.find((h) => h.name === 'Rogers Park');
    expect(heg.earned).toBe(true);
    expect(rp.earned).toBe(false);
    expect(rp.riddenCount).toBe(1);
    expect(rp.remaining).toBe(2);
  });

  it('handles empty/absent areas', () => {
    expect(neighborhoodAchievements(new Set(), undefined)).toEqual([]);
  });

  it('builds a completion card naming the area', () => {
    const c = neighborhoodCardContent({ name: 'Rogers Park', routes: ['22', '36', '147'] });
    expect(c.title).toBe('Rogers Park — bingo!');
    expect(c.ring).toEqual({ value: 3, max: 3, big: '3', label: 'routes' });
  });
});
