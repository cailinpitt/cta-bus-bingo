// Match a CTA bus pattern to its GTFS direction_id by endpoint stop ids. CTA's
// bustime pattern stop ids share the GTFS stop_id space, so the pattern's first
// stop usually equals one direction's dominant origin (and the last stop equals
// the dominant destination). Returns 0 or 1, or null when no match is confident.
export function matchPatternDirection(firstStopId, lastStopId, dirEndpoints) {
  if (!dirEndpoints) return null;
  for (const dir of ['0', '1']) {
    if (dirEndpoints[dir]?.origin === firstStopId) return Number(dir);
  }
  // Origin didn't match (pattern may start at a non-dominant garage pullout) —
  // try the destination as a tiebreaker before giving up.
  for (const dir of ['0', '1']) {
    if (dirEndpoints[dir]?.dest === lastStopId) return Number(dir);
  }
  return null;
}
