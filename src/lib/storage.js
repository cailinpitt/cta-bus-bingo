// localStorage persistence for the ridden-routes sync doc (an LWW-Map; see
// syncDoc.js). The legacy format was a plain JSON array of route ids under
// `cta-bus-bingo:ridden`; loadDoc migrates it to the doc format on first read
// and leaves the old key in place as a backup.

import { emptyDoc, isDoc, migrateRiddenArray } from './syncDoc.js';

const DOC_KEY = 'cta-bus-bingo:doc';
const LEGACY_KEY = 'cta-bus-bingo:ridden';
const SYNC_KEY = 'cta-bus-bingo:syncKey';

// Exposed so App can react to cross-tab `storage` events (another tab of the
// same browser editing the doc or sync key).
export const STORAGE_KEYS = { doc: DOC_KEY, syncKey: SYNC_KEY };

// Load the sync doc, migrating the legacy ridden-array if no doc exists yet.
// Returns an empty doc on any failure (private-mode Safari, corrupt JSON, etc.).
export function loadDoc() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isDoc(parsed)) return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        const doc = migrateRiddenArray(arr, Date.now());
        saveDoc(doc);
        return doc;
      }
    }
  } catch {
    // fall through to empty
  }
  return emptyDoc();
}

export function saveDoc(doc) {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    // Private-mode Safari and quota errors land here. In-memory state still
    // works; we just can't persist across reloads.
  }
}

// The cross-device sync key (a random bearer capability). Absent = sync off.
export function loadSyncKey() {
  try {
    return localStorage.getItem(SYNC_KEY) || null;
  } catch {
    return null;
  }
}

export function saveSyncKey(key) {
  try {
    localStorage.setItem(SYNC_KEY, key);
  } catch {
    // best-effort; private mode disables cross-device sync but the app still runs
  }
}

export function clearSyncKey() {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {
    // ignore
  }
}
