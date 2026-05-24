// Cross-device sync engine. Talks to the Cloudflare Worker blob store (see
// worker/src/index.js) to converge the ridden-routes doc across devices.
//
// One sync = GET remote -> mergeDocs(remote, local) -> adopt merged locally if it
// gained anything -> PUT merged if the remote is missing anything. Because the
// merge is a convergent CRDT join (see syncDoc.js), no locking is needed: a
// stale read only causes a temporary divergence that the next sync repairs.
//
// Triggers: app load, tab refocus, a slow poll while visible, and (debounced)
// after each local edit. A single-flight guard means at most one request is in
// flight; edits that arrive mid-sync set a dirty flag so one more sync follows.
//
// The transport is injectable so the engine can be unit-tested without a network.

import { docsEqual, emptyDoc, mergeDocs } from './syncDoc.js';

// 16 random bytes -> base64url (22 chars), an unguessable bearer key that
// addresses exactly one document. Matches the worker's KEY_RE.
export function generateSyncKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Default fetch transport. getDoc resolves to the stored doc or null; putDoc
// resolves on success and throws on any non-2xx so the engine can mark offline.
export const fetchTransport = {
  async getDoc(baseUrl, key) {
    const res = await fetch(`${baseUrl}/d/${key}`);
    if (!res.ok) throw new Error(`GET ${res.status}`);
    const body = await res.json();
    return body.doc ?? null;
  },
  async putDoc(baseUrl, key, doc) {
    const res = await fetch(`${baseUrl}/d/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(`PUT ${res.status}`);
  },
};

export function createSyncEngine({
  baseUrl,
  getKey, // () => string | null
  getLocalDoc, // () => doc (latest local truth)
  onMergedDoc, // (doc) => void — adopt merged doc as new local truth
  onStatus = () => {}, // (status) => void
  transport = fetchTransport,
  now = () => Date.now(),
  debounceMs = 1500,
  pollMs = 60000,
}) {
  let running = false;
  let dirty = false;
  let debounceTimer = null;
  let pollTimer = null;
  let visHandler = null;

  function setStatus(state, extra = {}) {
    onStatus({ state, ...extra });
  }

  async function runOnce() {
    const key = getKey();
    setStatus('syncing');
    const remote = (await transport.getDoc(baseUrl, key)) ?? emptyDoc();
    const local = getLocalDoc();
    const merged = mergeDocs(remote, local);
    // Adopt anything the remote contributed that we didn't already have.
    if (!docsEqual(merged, local)) onMergedDoc(merged);
    // Push anything the remote is missing.
    if (!docsEqual(merged, remote)) await transport.putDoc(baseUrl, key, merged);
    setStatus('idle', { lastSyncedAt: now() });
  }

  // Run a sync now, coalescing concurrent requests. If a sync is already in
  // flight, mark dirty so exactly one more runs after it; many edits collapse
  // into a single follow-up. On failure, report offline and stop — the next
  // trigger (poll / focus / edit) retries; local edits are already persisted.
  async function sync() {
    if (!getKey()) {
      setStatus('disabled');
      return;
    }
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        await runOnce();
      } while (dirty);
    } catch (e) {
      setStatus('offline', { error: e?.message ?? String(e) });
    } finally {
      running = false;
    }
  }

  // Debounced sync for the after-edit trigger: rapid toggles collapse into one
  // GET/merge/PUT once the user pauses.
  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      sync();
    }, debounceMs);
  }

  // Register lifecycle triggers and do an initial sync. Idempotent — calling it
  // again (e.g. after a key is set) tears down and re-arms.
  function start() {
    stop();
    if (!getKey()) {
      setStatus('disabled');
      return;
    }
    sync();
    if (typeof document !== 'undefined') {
      visHandler = () => {
        if (document.visibilityState === 'visible') sync();
      };
      document.addEventListener('visibilitychange', visHandler);
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') sync();
      }, pollMs);
    }
  }

  function stop() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (visHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visHandler);
    }
    debounceTimer = null;
    pollTimer = null;
    visHandler = null;
  }

  return { sync, scheduleSync, start, stop };
}
