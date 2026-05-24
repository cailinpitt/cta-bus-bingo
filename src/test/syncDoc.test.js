// LWW-Map sync-doc invariants. The merge must be a proper CRDT join
// (commutative, associative, idempotent) so devices converge regardless of the
// order writes land in — that property is the whole reason the backend can be a
// dumb blob store with no locking.

import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  docsEqual,
  docToSet,
  emptyDoc,
  isDoc,
  mergeDocs,
  migrateRiddenArray,
} from '../lib/syncDoc.js';

const doc = (routes) => ({ v: 1, routes });
const ride = (r, t) => ({ r, t });

describe('mergeDocs', () => {
  it('newer timestamp wins', () => {
    const a = doc({ 22: ride(1, 100) });
    const b = doc({ 22: ride(0, 200) });
    expect(mergeDocs(a, b).routes['22']).toEqual(ride(0, 200));
  });

  it('a tombstone with a newer t out-votes a stale ridden (un-mark propagates)', () => {
    // Laptop still thinks 22 is ridden (t=100); phone un-marked it (t=200).
    const laptop = doc({ 22: ride(1, 100) });
    const phone = doc({ 22: ride(0, 200) });
    expect(docToSet(mergeDocs(laptop, phone)).has('22')).toBe(false);
  });

  it('a stale tombstone loses to a newer ridden (re-mark propagates)', () => {
    const phone = doc({ 22: ride(0, 100) }); // un-marked earlier
    const laptop = doc({ 22: ride(1, 200) }); // re-marked later
    expect(docToSet(mergeDocs(phone, laptop)).has('22')).toBe(true);
  });

  it('tie on t: ridden beats tombstone', () => {
    const a = doc({ 22: ride(0, 500) });
    const b = doc({ 22: ride(1, 500) });
    expect(mergeDocs(a, b).routes['22']).toEqual(ride(1, 500));
    expect(mergeDocs(b, a).routes['22']).toEqual(ride(1, 500));
  });

  it('routes present in only one doc are kept', () => {
    const a = doc({ 22: ride(1, 100) });
    const b = doc({ X9: ride(1, 100) });
    const m = mergeDocs(a, b);
    expect(docToSet(m)).toEqual(new Set(['22', 'X9']));
  });

  it('is commutative', () => {
    const a = doc({ 22: ride(1, 100), 49: ride(0, 300), 8: ride(1, 50) });
    const b = doc({ 22: ride(0, 200), 49: ride(1, 250), 6: ride(1, 999) });
    expect(docsEqual(mergeDocs(a, b), mergeDocs(b, a))).toBe(true);
  });

  it('is idempotent', () => {
    const a = doc({ 22: ride(1, 100), 49: ride(0, 300) });
    expect(docsEqual(mergeDocs(a, a), a)).toBe(true);
  });

  it('is associative', () => {
    const a = doc({ 22: ride(1, 100), 49: ride(0, 300), 8: ride(1, 50) });
    const b = doc({ 22: ride(0, 200), 6: ride(1, 999) });
    const c = doc({ 49: ride(1, 400), 8: ride(0, 50), 22: ride(1, 150) });
    const left = mergeDocs(mergeDocs(a, b), c);
    const right = mergeDocs(a, mergeDocs(b, c));
    expect(docsEqual(left, right)).toBe(true);
  });

  it('does not mutate or alias its inputs', () => {
    const a = doc({ 22: ride(1, 100) });
    const b = doc({ 22: ride(0, 200) });
    const m = mergeDocs(a, b);
    m.routes['22'].t = 999;
    expect(a.routes['22']).toEqual(ride(1, 100));
    expect(b.routes['22']).toEqual(ride(0, 200));
  });

  it('tolerates empty / undefined docs', () => {
    expect(mergeDocs(undefined, undefined)).toEqual(emptyDoc());
    const a = doc({ 22: ride(1, 100) });
    expect(docsEqual(mergeDocs(a, emptyDoc()), a)).toBe(true);
  });
});

describe('docToSet', () => {
  it('returns only ridden (r:1) keys, excluding tombstones', () => {
    const d = doc({ 22: ride(1, 100), 49: ride(0, 200), X9: ride(1, 300) });
    expect(docToSet(d)).toEqual(new Set(['22', 'X9']));
  });

  it('returns an empty set for an empty doc', () => {
    expect(docToSet(emptyDoc())).toEqual(new Set());
  });
});

describe('applyDelta', () => {
  it('stamps added routes ridden and removed routes as tombstones at now', () => {
    const before = emptyDoc();
    const after = applyDelta(before, ['22', '8'], [], 1000);
    expect(after.routes['22']).toEqual(ride(1, 1000));
    expect(after.routes['8']).toEqual(ride(1, 1000));

    const next = applyDelta(after, [], ['22'], 2000);
    expect(next.routes['22']).toEqual(ride(0, 2000)); // tombstone
    expect(next.routes['8']).toEqual(ride(1, 1000)); // untouched
  });

  it('does not mutate the input doc', () => {
    const before = doc({ 22: ride(1, 100) });
    applyDelta(before, ['8'], ['22'], 2000);
    expect(before.routes['8']).toBeUndefined();
    expect(before.routes['22']).toEqual(ride(1, 100));
  });

  it('accepts Sets as well as arrays', () => {
    const after = applyDelta(emptyDoc(), new Set(['22']), new Set(['49']), 1000);
    expect(after.routes['22']).toEqual(ride(1, 1000));
    expect(after.routes['49']).toEqual(ride(0, 1000));
  });
});

describe('migrateRiddenArray', () => {
  it('converts a legacy array into an all-ridden doc stamped at now', () => {
    const d = migrateRiddenArray(['22', '49B', 'X9'], 1000);
    expect(docToSet(d)).toEqual(new Set(['22', '49B', 'X9']));
    expect(d.routes['22']).toEqual(ride(1, 1000));
  });

  it('returns an empty doc for null / undefined / empty input', () => {
    expect(migrateRiddenArray(undefined)).toEqual(emptyDoc());
    expect(migrateRiddenArray([])).toEqual(emptyDoc());
  });
});

describe('docsEqual', () => {
  it('is true for structurally identical docs', () => {
    expect(docsEqual(doc({ 22: ride(1, 100) }), doc({ 22: ride(1, 100) }))).toBe(true);
  });

  it('is false when r, t, or the key set differ', () => {
    expect(docsEqual(doc({ 22: ride(1, 100) }), doc({ 22: ride(0, 100) }))).toBe(false);
    expect(docsEqual(doc({ 22: ride(1, 100) }), doc({ 22: ride(1, 101) }))).toBe(false);
    expect(docsEqual(doc({ 22: ride(1, 100) }), doc({ 22: ride(1, 100), 8: ride(1, 1) }))).toBe(
      false,
    );
  });
});

describe('isDoc', () => {
  it('recognizes docs and rejects legacy arrays / garbage', () => {
    expect(isDoc(emptyDoc())).toBe(true);
    expect(isDoc(['22', '49'])).toBe(false);
    expect(isDoc(null)).toBe(false);
    expect(isDoc('nope')).toBe(false);
  });
});

describe('convergence scenario (two devices, mark + un-mark)', () => {
  it('both devices reach the same ridden set regardless of merge order', () => {
    // Start synced: both have ridden 22 and 49.
    let laptop = applyDelta(emptyDoc(), ['22', '49'], [], 100);
    let phone = mergeDocs(emptyDoc(), laptop);

    // Phone rides 8; laptop un-marks 22 (it was a mistake). Concurrent edits.
    phone = applyDelta(phone, ['8'], [], 200);
    laptop = applyDelta(laptop, [], ['22'], 210);

    // They sync in opposite orders.
    const laptopView = mergeDocs(laptop, phone);
    const phoneView = mergeDocs(phone, laptop);

    expect(docsEqual(laptopView, phoneView)).toBe(true);
    expect(docToSet(laptopView)).toEqual(new Set(['49', '8'])); // 22 un-marked, 8 added
  });
});
