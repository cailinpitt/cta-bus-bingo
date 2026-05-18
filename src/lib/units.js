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

// Format a ride distance (input feet from the pattern's pdist field).
export function fmtRideDistance(feet) {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const mi = feet / FT_PER_MILE;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
