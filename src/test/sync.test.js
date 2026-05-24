// Sync-engine behavior with an injected mock transport (no network). Covers the
// GET/merge/PUT decision logic, single-flight coalescing, debounce, and offline
// handling. The convergence math itself is tested in syncDoc.test.js.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncEngine } from '../lib/sync.js';
import { applyDelta, docToSet, emptyDoc } from '../lib/syncDoc.js';

const KEY = 'k'.repeat(22);

// A mock transport backed by an in-memory "remote" doc.
function makeTransport(initialRemote = null) {
  let remote = initialRemote;
  return {
    get: vi.fn(async () => remote),
    put: vi.fn(async (doc) => {
      remote = doc;
    }),
    getRemote: () => remote,
    setRemote: (d) => {
      remote = d;
    },
  };
}

// Wire an engine over a mutable local doc + a transport.
function setup({ local = emptyDoc(), remote = null, key = KEY, transport } = {}) {
  let localDoc = local;
  let keyVal = key;
  const statuses = [];
  const t = transport ?? makeTransport(remote);
  const engine = createSyncEngine({
    baseUrl: 'http://test',
    getKey: () => keyVal,
    getLocalDoc: () => localDoc,
    onMergedDoc: (d) => {
      localDoc = d;
    },
    onStatus: (s) => statuses.push(s),
    transport: { getDoc: t.get, putDoc: (_b, _k, d) => t.put(d) },
    now: () => 42,
  });
  return {
    engine,
    transport: t,
    getLocal: () => localDoc,
    statuses,
    setKey: (k) => {
      keyVal = k;
    },
  };
}

const ride = (r, t) => ({ r, t });
const doc = (routes) => ({ v: 1, routes });

afterEach(() => {
  vi.useRealTimers();
});

describe('sync()', () => {
  it('PUTs local changes when the remote is empty, without adopting anything', async () => {
    const local = applyDelta(emptyDoc(), ['22'], [], 100);
    const { engine, transport, getLocal } = setup({ local });
    await engine.sync();
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(docToSet(transport.getRemote())).toEqual(new Set(['22']));
    expect(docToSet(getLocal())).toEqual(new Set(['22'])); // unchanged locally
  });

  it('adopts remote changes and pushes the union when both sides differ', async () => {
    const local = doc({ 8: ride(1, 100) });
    const remote = doc({ 22: ride(1, 100) });
    const { engine, transport, getLocal } = setup({ local, remote });
    await engine.sync();
    // Local adopts the merged union...
    expect(docToSet(getLocal())).toEqual(new Set(['8', '22']));
    // ...and the remote is updated with what it was missing.
    expect(docToSet(transport.getRemote())).toEqual(new Set(['8', '22']));
    expect(transport.put).toHaveBeenCalledTimes(1);
  });

  it('a remote tombstone wins and un-marks the route locally', async () => {
    const local = doc({ 22: ride(1, 100) }); // we think 22 is ridden
    const remote = doc({ 22: ride(0, 200) }); // another device un-marked it later
    const { engine, getLocal } = setup({ local, remote });
    await engine.sync();
    expect(docToSet(getLocal()).has('22')).toBe(false);
  });

  it('does nothing (no PUT, no adopt) when already in sync', async () => {
    const same = doc({ 22: ride(1, 100) });
    const { engine, transport } = setup({ local: same, remote: same });
    await engine.sync();
    expect(transport.put).not.toHaveBeenCalled();
  });

  it('is a no-op and reports disabled when there is no key', async () => {
    const { engine, transport, statuses } = setup({ key: null });
    await engine.sync();
    expect(transport.get).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toEqual({ state: 'disabled' });
  });

  it('reports offline on a transport error and leaves local data intact', async () => {
    const local = applyDelta(emptyDoc(), ['22'], [], 100);
    const transport = {
      get: vi.fn(async () => {
        throw new Error('network down');
      }),
      put: vi.fn(),
      getRemote: () => null,
      setRemote: () => {},
    };
    const { engine, getLocal, statuses } = setup({ local, transport });
    await engine.sync();
    expect(statuses.at(-1).state).toBe('offline');
    expect(docToSet(getLocal())).toEqual(new Set(['22'])); // not lost
    // A later successful sync still works.
    const { engine: e2, transport: t2 } = setup({ local });
    await e2.sync();
    expect(t2.put).toHaveBeenCalled();
  });

  it('records lastSyncedAt on success', async () => {
    const { engine, statuses } = setup({ local: applyDelta(emptyDoc(), ['22'], [], 1) });
    await engine.sync();
    expect(statuses.at(-1)).toEqual({ state: 'idle', lastSyncedAt: 42 });
  });
});

describe('single-flight coalescing', () => {
  it('collapses many concurrent syncs into one in-flight + one follow-up', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    let getCount = 0;
    const transport = {
      getDoc: async () => {
        getCount++;
        await gate;
        return null;
      },
      putDoc: async () => {},
    };
    const engine = createSyncEngine({
      baseUrl: 'http://test',
      getKey: () => KEY,
      getLocalDoc: () => emptyDoc(),
      onMergedDoc: () => {},
      transport,
    });
    const first = engine.sync(); // starts, blocks on gate
    engine.sync(); // running -> dirty
    engine.sync(); // running -> dirty (collapses)
    engine.sync(); // running -> dirty (collapses)
    expect(getCount).toBe(1);
    release();
    await first;
    expect(getCount).toBe(2); // exactly one follow-up, not four
  });
});

describe('scheduleSync() debounce', () => {
  it('coalesces rapid edits into a single sync after the debounce window', async () => {
    vi.useFakeTimers();
    const transport = makeTransport(null);
    const engine = createSyncEngine({
      baseUrl: 'http://test',
      getKey: () => KEY,
      getLocalDoc: () => emptyDoc(),
      onMergedDoc: () => {},
      transport: { getDoc: transport.get, putDoc: (_b, _k, d) => transport.put(d) },
      debounceMs: 1500,
    });
    engine.scheduleSync();
    engine.scheduleSync();
    engine.scheduleSync();
    expect(transport.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(transport.get).toHaveBeenCalledTimes(1);
  });
});
