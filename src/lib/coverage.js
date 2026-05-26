// Pick a planning target from coverage: the community area with the most routes
// you haven't ridden (bingo-maximizing by geography). Ties broken by proximity
// to `from` so it doesn't fling you across the city unnecessarily. Returns the
// area + its unridden count, or null when every area is fully ridden.
export function leastCoveredArea(ridden, areas, from = null) {
  let best = null;
  for (const a of areas || []) {
    if (!a.routes?.length || !a.center) continue;
    let unridden = 0;
    for (const rt of a.routes) if (!ridden.has(rt)) unridden++;
    if (unridden === 0) continue;
    const dist = from ? (a.center[0] - from.lat) ** 2 + (a.center[1] - from.lon) ** 2 : 0;
    if (!best || unridden > best.unridden || (unridden === best.unridden && dist < best.dist)) {
      best = { name: a.name, center: a.center, routes: a.routes, unridden, dist };
    }
  }
  return best;
}
