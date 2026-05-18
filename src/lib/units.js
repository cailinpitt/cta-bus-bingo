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

// Format a ride distance (input feet from the pattern's pdist field).
export function fmtRideDistance(feet) {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const mi = feet / FT_PER_MILE;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
