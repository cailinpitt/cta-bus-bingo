// Great-circle distance in feet between two {lat, lon} points.
export function haversineFeet(a, b) {
  const R_FT = 20902231; // Earth radius in feet
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_FT * Math.asin(Math.sqrt(h));
}

// Walking-pace assumption: 4.6 ft/s (~3.1 mph) including signal waits.
export const WALK_FPS = 4.6;

export function walkSeconds(feet) {
  return feet / WALK_FPS;
}
