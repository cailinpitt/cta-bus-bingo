// Snapshot a planning result so a trip survives a page reload or PWA relaunch.
// Mobile browsers discard backgrounded tabs / kill installed PWAs to reclaim
// memory; without this you lose your itinerary halfway through a trip (and a
// re-plan would hand back a *different* random chain). The snapshot stores only
// pattern ids + scalars — leg geometry is rehydrated against the in-memory
// dataset on load, so it stays small and never serializes Maps/Sets.

export function serializePlan({ result, selectedTrip, inputs }) {
  if (!result) return null;
  const serializeTrip = (t) => ({
    totalSeconds: t.totalSeconds,
    newRouteCount: t.newRouteCount,
    start: t.start ?? null,
    end: t.end ?? null,
    reachedEnd: t.reachedEnd ?? null,
    reachedStart: t.reachedStart ?? null,
    legs: t.legs.map((l) => ({
      rt: l.rt,
      routeName: l.routeName,
      pid: String(l.pattern.pid),
      boardIdx: l.boardIdx,
      alightIdx: l.alightIdx,
      walkFeet: l.walkFeet,
      walkSeconds: l.walkSeconds,
      rideSeconds: l.rideSeconds,
      rideFt: l.rideFt,
      free: l.free,
    })),
  });
  const sug = result.suggestedStart;
  return {
    inputs, // { start, end, cap, roundTrip, scheduleMode, scheduleAt } at plan time
    selectedTrip,
    start: result.start ?? null,
    end: result.end ?? null,
    suggestedStart: sug
      ? {
          distance: sug.distance,
          stop: {
            stopId: sug.stop.stopId,
            stopName: sug.stop.stopName,
            lat: sug.stop.lat,
            lon: sug.stop.lon,
          },
        }
      : null,
    trips: (result.trips || []).map(serializeTrip),
  };
}

// Rebuild a full result (legs carrying pattern/boardStop/alightStop) from a
// snapshot. Trips whose patterns no longer exist (the baked data changed under
// us) are dropped rather than rendered broken.
export function rehydratePlan(saved, dataset) {
  if (!saved || !dataset) return null;
  const rehydrateLeg = (l) => {
    const pattern = dataset.patterns[l.pid];
    if (!pattern?.stops[l.boardIdx] || !pattern?.stops[l.alightIdx]) return null;
    return {
      ...l,
      pattern,
      boardStop: pattern.stops[l.boardIdx],
      alightStop: pattern.stops[l.alightIdx],
    };
  };
  const trips = [];
  for (const t of saved.trips || []) {
    const legs = t.legs.map(rehydrateLeg);
    if (legs.some((l) => !l)) continue; // a pattern went missing — drop this trip
    trips.push({ ...t, legs });
  }
  return {
    trips,
    suggestedStart: saved.suggestedStart ?? null,
    start: saved.start ?? null,
    end: saved.end ?? null,
  };
}
