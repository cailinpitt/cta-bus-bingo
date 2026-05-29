// Imperial display formatting. The codebase stores all distances in feet
// (matching CTA's bus pattern pdist field); these helpers render them.

const FT_PER_MILE = 5280;

// Format a walking distance (input feet). Short walks read as feet, longer
// ones as miles to one decimal.
export function fmtWalkDistance(feet) {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const mi = feet / FT_PER_MILE;
  return `${mi.toFixed(1)} mi`;
}

// Format a duration in seconds as minutes, with hours when ≥ 60 min.
export function fmtMin(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Compact variant for tight UI (e.g. the trip-picker tab strip).
export function fmtMinCompact(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h${rem}m` : `${h}h`;
}

// The terminus a leg heads toward = its pattern's final stop (the headsign), e.g.
// "North Avenue Beach". Lets the UI disambiguate "take the 72" into which end of
// the line to board. Pair with directionOf for the cardinal direction.
export function terminusOf(leg) {
  const stops = leg?.pattern?.stops;
  return stops?.length ? stops[stops.length - 1].stopName : null;
}

// The cardinal direction of a leg ("Eastbound"), or null. Only the four compass
// directions read meaningfully to a rider; trains carry synthetic
// "Forward"/"Reverse" labels, which we drop so trains show only their terminus.
export function directionOf(leg) {
  const direction = leg?.pattern?.direction || null;
  return direction && /bound$/i.test(direction) ? direction : null;
}

// Format a ride distance (input feet from the pattern's pdist field).
export function fmtRideDistance(feet) {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const mi = feet / FT_PER_MILE;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
