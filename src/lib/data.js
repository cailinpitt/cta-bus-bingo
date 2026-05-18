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

export async function loadDataset(base = `${import.meta.env.BASE_URL}data`) {
  if (cached) return cached;

  const [routes, routePatterns, meta] = await Promise.all([
    fetch(`${base}/routes.json`).then((r) => r.json()),
    fetch(`${base}/route-patterns.json`).then((r) => r.json()),
    fetch(`${base}/meta.json`).then((r) => r.json()),
  ]);

  // The route-patterns.json file is bus-only; train pids live on the route
  // record itself (since trains are synthesized post-fetch).
  for (const [rt, r] of Object.entries(routes)) {
    if (r.isTrain && !routePatterns[rt]) routePatterns[rt] = r.patternIds;
  }

  // Fetch every pattern in parallel. With ~300 patterns this is fine over HTTP/2.
  const allPids = Object.values(routePatterns).flat();
  const patternList = await Promise.all(
    allPids.map((pid) =>
      fetch(`${base}/patterns/${pid}.json`)
        .then((r) => r.json())
        .then((p) => ({ ...p, pid: String(p.pid) })),
    ),
  );

  // Map pid -> rt so we can stamp patterns with their route.
  const pidToRoute = {};
  for (const [rt, pids] of Object.entries(routePatterns)) {
    for (const pid of pids) pidToRoute[pid] = rt;
  }

  const patterns = {};
  const stops = {};
  const stopsByRoute = {};

  for (const p of patternList) {
    const rt = pidToRoute[p.pid];
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
    patterns[p.pid] = { ...p, rt, stops: stopPoints };

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

  cached = { routes, patterns, stops, stopsByRoute, routesByStop: stops, meta };
  return cached;
}

export function clearCache() {
  cached = null;
}
