import { describe, expect, it } from 'vitest';
import { itineraryToText } from '../lib/shareItinerary.js';

const routes = {
  22: { name: 'Clark' },
  'train-red': { name: 'Red Line', isTrain: true },
  77: { name: 'Belmont' },
};

const plan = {
  totalSeconds: 2400, // 40 min
  newRouteCount: 2,
  legs: [
    {
      rt: '22',
      free: false,
      walkFeet: 200,
      walkSeconds: 45,
      rideSeconds: 12 * 60,
      boardStop: { stopName: 'Clark & Belmont' },
      alightStop: { stopName: 'Clark & Diversey' },
    },
    {
      rt: 'train-red',
      free: true,
      walkFeet: 40,
      walkSeconds: 9,
      rideSeconds: 8 * 60,
      boardStop: { stopName: 'Belmont Red Line' },
      alightStop: { stopName: 'Fullerton' },
    },
    {
      rt: '77',
      free: false,
      walkFeet: 0,
      walkSeconds: 0,
      rideSeconds: 15 * 60,
      boardStop: { stopName: 'Fullerton & Halsted' },
      alightStop: { stopName: 'Belmont & Halsted' },
    },
  ],
};

describe('itineraryToText', () => {
  it('renders a numbered, labeled itinerary with totals and from/to', () => {
    const t = itineraryToText(plan, routes, {
      start: { label: 'Lunt & Ashland' },
      end: { label: '95th & Vanderpoel' },
    });
    expect(t).toContain('CTA Bus Bingo — 40 min, 2 new routes');
    expect(t).toContain('From: Lunt & Ashland');
    expect(t).toContain('To: 95th & Vanderpoel');
    expect(t).toMatch(/1\. 22 Clark\n {3}Walk 200 ft \(1 min\) to Clark & Belmont/);
    expect(t).toContain('2. Red Line [train connector]');
    expect(t).toMatch(/3\. 77 Belmont\n {3}Board at Fullerton & Halsted/); // walk <= 50ft
  });

  it('returns empty string when there is no plan', () => {
    expect(itineraryToText(null, routes)).toBe('');
    expect(itineraryToText({ legs: [] }, routes)).toBe('');
  });
});
