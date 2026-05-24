// Conflict-free sync document for the ridden-routes set.
//
// The synced state is a LWW-Map (last-writer-wins per route):
//   { v: 1, routes: { [rt]: { r: 0|1, t: number } } }
// where `r` is the ridden flag and `t` is the epoch-ms of that route's last
// change.
//
// Routes the user has never touched are absent (absence = implicitly unridden).
// A route un-marked after being ridden becomes a tombstone `{ r: 0, t }` — kept,
// not deleted — so the removal can out-vote a stale `{ r: 1 }` on another device
// instead of looking identical to "never had this route."
//
// `mergeDocs` is a CRDT join: commutative, associative, and idempotent. As long
// as every device eventually re-reads after another writes, all devices converge
// with no locking. See plan.md for the full rationale.

export const DOC_VERSION = 1;

export function emptyDoc() {
  return { v: DOC_VERSION, routes: {} };
}

// True if `value` is a parsed sync doc (vs the legacy ridden array or garbage).
export function isDoc(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !!value.routes &&
    typeof value.routes === 'object'
  );
}

// Per-route join of two docs. The entry with the larger `t` wins; on an exact
// tie the ridden state (r:1) wins. That tie rule keeps the join commutative and
// associative (it's a max over (t, r)), so merge order never matters. Returns a
// new doc with freshly-copied entries — inputs are not mutated or aliased.
export function mergeDocs(a, b) {
  const ra = a?.routes ?? {};
  const rb = b?.routes ?? {};
  const routes = {};
  for (const rt of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const ea = ra[rt];
    const eb = rb[rt];
    let chosen;
    if (!ea) chosen = eb;
    else if (!eb) chosen = ea;
    else if (ea.t > eb.t) chosen = ea;
    else if (eb.t > ea.t) chosen = eb;
    else chosen = ea.r >= eb.r ? ea : eb; // tie on t: ridden beats tombstone
    routes[rt] = { r: chosen.r, t: chosen.t };
  }
  return { v: DOC_VERSION, routes };
}

// The set of currently-ridden route ids (entries where r === 1). Tombstones are
// excluded. This is the view the rest of the app consumes.
export function docToSet(doc) {
  const routes = doc?.routes ?? {};
  const set = new Set();
  for (const rt of Object.keys(routes)) {
    if (routes[rt].r === 1) set.add(rt);
  }
  return set;
}

// Stamp newly-ridden routes as { r:1, t:now } and un-marked routes as tombstones
// { r:0, t:now }. `added`/`removed` are any iterables of route ids. Returns a new
// doc; the input is not mutated.
export function applyDelta(doc, added = [], removed = [], now = Date.now()) {
  const routes = { ...(doc?.routes ?? {}) };
  for (const rt of added) routes[rt] = { r: 1, t: now };
  for (const rt of removed) routes[rt] = { r: 0, t: now };
  return { v: DOC_VERSION, routes };
}

// Convert the legacy localStorage format (a plain array of ridden route ids)
// into a sync doc, stamping every route ridden at `now`.
export function migrateRiddenArray(arr, now = Date.now()) {
  const routes = {};
  for (const rt of arr ?? []) routes[rt] = { r: 1, t: now };
  return { v: DOC_VERSION, routes };
}

// Structural equality on the route map (same keys, same r and t per key). Used
// by the sync engine to decide whether a merged doc differs from what's stored,
// i.e. whether a PUT is needed.
export function docsEqual(a, b) {
  const ra = a?.routes ?? {};
  const rb = b?.routes ?? {};
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  for (const rt of ka) {
    const ea = ra[rt];
    const eb = rb[rt];
    if (!eb || ea.r !== eb.r || ea.t !== eb.t) return false;
  }
  return true;
}
