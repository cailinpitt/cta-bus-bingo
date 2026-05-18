// Load and shape the pre-baked data files into the runtime structures the planner uses.
//
// Public surface:
//   loadDataset() -> { routes, patterns, stops, stopsByRoute, routesByStop, meta }
//     routes:        { rt: { name, gtfs, patternIds: [pid] } }
//     patterns:      { pid: { pid, direction, lengthFt, points: [...], stops: [{stopId,stopName,lat,lon,pdist,seq}], rt } }
//     stops:         { stopId: { stopId, stopName, lat, lon, routes: Set<rt> } }
//     stopsByRoute:  { rt: Set<stopId> }
//     routesByStop:  { stopId: Set<rt> }  (alias to stops[id].routes; kept for clarity at call sites)

let cached = null;

// Pure: take raw routes / routePatterns / patternList (array of pattern objects
// with .pid, .points etc.) and meta, and return the planner-ready dataset.
// Shared by the runtime fetcher below, the smoke script, and the test setup.
export function shapeDataset({ routes, routePatterns, patternList, meta = null }) {
  // The route-patterns.json file is bus-only; train pids live on the route
  // record itself (since trains are synthesized post-fetch).
  for (const [rt, r] of Object.entries(routes)) {
    if (r.isTrain && !routePatterns[rt]) routePatterns[rt] = r.patternIds;
  }

  const pidToRoute = {};
  for (const [rt, pids] of Object.entries(routePatterns)) {
    for (const pid of pids) pidToRoute[pid] = rt;
  }

  const patterns = {};
  const stops = {};
  const stopsByRoute = {};

  for (const p of patternList) {
    const pid = String(p.pid);
    const rt = pidToRoute[pid];
    const stopPoints = p.points
      .filter((pt) => pt.type === 'S' && pt.stopId)
      .map((pt) => ({
        stopId: String(pt.stopId),
        stopName: pt.stopName,
        lat: pt.lat,
        lon: pt.lon,
        pdist: pt.pdist,
        seq: pt.seq,
      }));
    // stopIdToIdx lets the planner do O(1) `find this stop's index along the
    // pattern` lookups instead of scanning p.stops with findIndex on every
    // candidate ride.
    const stopIdToIdx = new Map();
    for (let i = 0; i < stopPoints.length; i++) stopIdToIdx.set(stopPoints[i].stopId, i);
    patterns[pid] = { ...p, pid, rt, stops: stopPoints, stopIdToIdx };

    if (!stopsByRoute[rt]) stopsByRoute[rt] = new Set();
    for (const s of stopPoints) {
      stopsByRoute[rt].add(s.stopId);
      if (!stops[s.stopId]) {
        stops[s.stopId] = {
          stopId: s.stopId,
          stopName: s.stopName,
          lat: s.lat,
          lon: s.lon,
          routes: new Set(),
        };
      }
      stops[s.stopId].routes.add(rt);
    }
  }

  return { routes, patterns, stops, stopsByRoute, routesByStop: stops, meta };
}

export async function loadDataset(base = `${import.meta.env.BASE_URL}data`) {
  if (cached) return cached;

  const [routes, routePatterns, meta, bundledPatterns] = await Promise.all([
    fetch(`${base}/routes.json`).then((r) => r.json()),
    fetch(`${base}/route-patterns.json`).then((r) => r.json()),
    fetch(`${base}/meta.json`).then((r) => r.json()),
    // Single bundled fetch instead of 300+ per-pattern requests. Massive
    // cold-load win on mobile networks (gzipped ~1.5 MB vs 339 tiny
    // sequential requests).
    fetch(`${base}/patterns.json`).then((r) => r.json()),
  ]);

  const patternList = Object.values(bundledPatterns);
  cached = shapeDataset({ routes, routePatterns, patternList, meta });
  return cached;
}

export function clearCache() {
  cached = null;
}
