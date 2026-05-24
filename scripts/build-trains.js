// Train-side data extraction. Imported by build-index.js to add L lines to the
// output alongside buses.
//
// For each of the 8 L lines we produce two "patterns" (forward + reverse) so
// the planner — which assumes ride direction == increasing pdist — can consider
// both directions of a line without special-casing trains.
//
// Pdist is in feet to match the bus pattern format; station pdist values are
// the projected position onto the line's polyline.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EARTH_RADIUS_FT = 20902231; // Earth radius in feet

// Vendored rail geometry — station coords + line polylines. Rail geometry is
// effectively static, so a checked-in snapshot stays valid; schedules still
// refresh from GTFS on every build.
const TRAIN_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'train');

// Match the canonical rail route_id in the GTFS index (route_type=1).
const GTFS_KEY = {
  red: 'Red',
  blue: 'Blue',
  brn: 'Brn',
  g: 'G',
  org: 'Org',
  p: 'P',
  pink: 'Pink',
  y: 'Y',
};

const LINE_NAMES = {
  red: 'Red Line',
  blue: 'Blue Line',
  brn: 'Brown Line',
  g: 'Green Line',
  org: 'Orange Line',
  p: 'Purple Line',
  pink: 'Pink Line',
  y: 'Yellow Line',
};

const LINE_COLORS = {
  red: '#c60c30',
  blue: '#00a1de',
  brn: '#62361b',
  g: '#009b3a',
  org: '#f9461c',
  p: '#522398',
  pink: '#e27ea6',
  y: '#f9e300',
};

function haversineFt(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(h));
}

// Project `pt` onto the segment (a,b). Returns { lat, lon, t, distFt } where
// t in [0,1] is the parametric position along the segment.
function projectOnSegment(pt, a, b) {
  // Lat/lon are close enough to planar at city scale for projection. Convert to
  // local feet using equirectangular projection centered at midpoint.
  const lat0 = (a.lat + b.lat) / 2;
  const ftPerLon = 365221 * Math.cos((lat0 * Math.PI) / 180);
  const ftPerLat = 362630;
  const ax = a.lon * ftPerLon;
  const ay = a.lat * ftPerLat;
  const bx = b.lon * ftPerLon;
  const by = b.lat * ftPerLat;
  const px = pt.lon * ftPerLon;
  const py = pt.lat * ftPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return { lat: a.lat, lon: a.lon, t: 0, distFt: Math.hypot(px - ax, py - ay) };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projx = ax + t * dx;
  const projy = ay + t * dy;
  return {
    lat: projy / ftPerLat,
    lon: projx / ftPerLon,
    t,
    distFt: Math.hypot(px - projx, py - projy),
  };
}

// Given a polyline (array of [lat, lon]), compute cumulative pdist per vertex.
function cumulative(line) {
  let pd = 0;
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    pd += haversineFt(
      { lat: line[i - 1][0], lon: line[i - 1][1] },
      { lat: line[i][0], lon: line[i][1] },
    );
    cum.push(pd);
  }
  return cum;
}

// Find the closest projection of `station` onto the polyline. Returns
// { segIdx, pdist, snappedLat, snappedLon }.
function snapStation(station, line, cum) {
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lat: line[i][0], lon: line[i][1] };
    const b = { lat: line[i + 1][0], lon: line[i + 1][1] };
    const proj = projectOnSegment({ lat: station.lat, lon: station.lon }, a, b);
    const segFt = haversineFt(a, b);
    const pd = cum[i] + segFt * proj.t;
    if (!best || proj.distFt < best.distFt) {
      best = {
        segIdx: i,
        pdist: pd,
        snappedLat: proj.lat,
        snappedLon: proj.lon,
        distFt: proj.distFt,
      };
    }
  }
  return best;
}

// Build a single direction's pattern. Stations end up interleaved with the line
// vertices, in pdist order. Each station becomes a stop point (type 'S') with a
// synthetic stopId (`train:<line>:<stationname>`); each line vertex becomes a
// waypoint (type 'W').
function buildPattern(lineCode, lineSegments, stations, reverse) {
  // Concatenate the multi-segment polyline into a single flat array.
  // Some lines are stored as arrays-of-segments to skip non-rail gaps
  // (e.g. Purple shuttle); we lose those gaps in pdist but it's close enough
  // for routing/rendering. (Could iterate to handle gaps later.)
  const flat = [];
  for (const seg of lineSegments) flat.push(...seg);
  const cum = cumulative(flat);
  const total = cum[cum.length - 1];

  // Snap each station onto the polyline.
  const stationStops = stations
    .map((s) => {
      const snap = snapStation(s, flat, cum);
      return {
        type: 'S',
        stopId: `train-${lineCode}-${s.name.replace(/[^a-z0-9]/gi, '_')}`,
        stopName: s.name,
        lat: snap.snappedLat,
        lon: snap.snappedLon,
        pdist: snap.pdist,
      };
    })
    // De-duplicate stations that snapped to nearly the same point (rare).
    .sort((a, b) => a.pdist - b.pdist);

  // Build waypoint points from the line vertices.
  const waypoints = flat.map(([lat, lon], i) => ({
    type: 'W',
    lat,
    lon,
    pdist: cum[i],
  }));

  // Merge sorted by pdist.
  const merged = [...waypoints, ...stationStops].sort((a, b) => a.pdist - b.pdist);
  // Assign sequential seq numbers.
  merged.forEach((p, i) => {
    p.seq = i + 1;
  });

  if (reverse) {
    // Flip pdist to be increasing in the opposite direction.
    const out = merged
      .slice()
      .reverse()
      .map((p, i) => ({ ...p, pdist: total - p.pdist, seq: i + 1 }));
    return { lengthFt: total, points: out };
  }
  return { lengthFt: total, points: merged };
}

export function buildTrains({ dataDir = TRAIN_DATA_DIR } = {}) {
  const stations = JSON.parse(readFileSync(resolve(dataDir, 'trainStations.json'), 'utf8'));
  const rawLines = JSON.parse(readFileSync(resolve(dataDir, 'trainLines.json'), 'utf8'));

  // Some lines are stored as a flat array of [lat,lon] pairs; others as an
  // array of segments. Normalize both to "array of segments".
  function asSegments(raw) {
    if (!raw.length) return [];
    if (Array.isArray(raw[0][0])) return raw;
    return [raw];
  }

  const routes = {};
  const patterns = {};

  for (const code of Object.keys(rawLines)) {
    const lineStations = stations.filter((s) => (s.lines || []).includes(code));
    const segs = asSegments(rawLines[code]);

    const fwd = buildPattern(code, segs, lineStations, false);
    const rev = buildPattern(code, segs, lineStations, true);

    const fwdPid = `train-${code}-fwd`;
    const revPid = `train-${code}-rev`;
    patterns[fwdPid] = {
      pid: fwdPid,
      direction: 'Forward',
      ...fwd,
    };
    patterns[revPid] = {
      pid: revPid,
      direction: 'Reverse',
      ...rev,
    };

    routes[`train-${code}`] = {
      name: LINE_NAMES[code],
      color: LINE_COLORS[code],
      isTrain: true,
      lineCode: code,
      gtfsLineKey: GTFS_KEY[code], // caller wires up gtfs from index.lines[GTFS_KEY[code]]
      patternIds: [fwdPid, revPid],
    };
  }

  return { routes, patterns };
}
