// Simple lat/lon grid index for nearest-stop queries.
//
// Chicago is small enough that a flat grid keyed by floor(lat*100), floor(lon*100)
// — ~1km cells — gives O(1) neighbor lookups without pulling in a real spatial library.

const CELL = 100; // degrees -> 0.01° cells, ~1.1km at Chicago latitude

function cellKey(lat, lon) {
  return `${Math.floor(lat * CELL)},${Math.floor(lon * CELL)}`;
}

export function buildStopIndex(stops) {
  const grid = new Map();
  for (const s of Object.values(stops)) {
    const key = cellKey(s.lat, s.lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s);
  }
  return grid;
}

// All stops within an axis-aligned bounding box of ~`feet`. The neighborhood is
// over-collected and the caller filters with haversine to get the true radius.
export function stopsNear(grid, { lat, lon }, feet) {
  // 1 deg lat ≈ 364,000 ft; 1 deg lon ≈ 271,000 ft at Chicago latitude (41.85°,
  // 364,000·cos 41.85° ≈ 270,960). The old 278,900 made the E/W half-width a hair
  // too small, so a stop near the radius edge could fall in an uncollected cell.
  const dLat = feet / 364000;
  const dLon = feet / 271000;
  const minLat = Math.floor((lat - dLat) * CELL);
  const maxLat = Math.floor((lat + dLat) * CELL);
  const minLon = Math.floor((lon - dLon) * CELL);
  const maxLon = Math.floor((lon + dLon) * CELL);

  const out = [];
  for (let la = minLat; la <= maxLat; la++) {
    for (let lo = minLon; lo <= maxLon; lo++) {
      const bucket = grid.get(`${la},${lo}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}
