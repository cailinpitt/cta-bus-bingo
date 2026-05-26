// Self-contained CTA GTFS schedule indexer. Downloads the public CTA GTFS feed
// and computes, per route · direction · day-type · hour, the median headway and
// median end-to-end duration that the planner's schedule logic consumes.
//
// It keeps the service-resolution / short-turn / dominance logic needed for
// accurate headways but emits only the fields the planner reads (headways +
// durations), and derives the route list + display names straight from GTFS
// routes.txt. No API key needed — the GTFS zip is a public download.
//
// Output shape (matches what src/lib/schedule.js expects for `route.gtfs`):
//   { generatedAt, routes: { busId: { "0": dir, "1": dir } }, lines: { Red: {...} },
//     names: { routeId: longName }, busRouteIds: [...] }
//   where dir = { headways: { weekday|saturday|sunday: { hour: min } }, durations: {...} }

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const GTFS_URL = 'https://www.transitchicago.com/downloads/sch_data/google_transit.zip';
const ZIP_PATH = '/tmp/cta-bus-bingo-gtfs.zip';

async function downloadGtfs() {
  if (existsSync(ZIP_PATH)) {
    const age = Date.now() - statSync(ZIP_PATH).mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      console.log('  using cached GTFS zip (< 1 day old)');
      return;
    }
  }
  console.log(`  downloading GTFS from ${GTFS_URL} …`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const resp = await fetch(GTFS_URL, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`GTFS download HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(ZIP_PATH, buf);
    console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  } finally {
    clearTimeout(timer);
  }
}

function readFromZip(filename) {
  return execFileSync('unzip', ['-p', ZIP_PATH, filename], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
  });
}

function streamFromZip(filename, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn('unzip', ['-p', ZIP_PATH, filename]);
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', onLine);
    rl.on('close', resolve);
    proc.on('error', reject);
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
}

// RFC 4180-aware — stops.txt / routes.txt have quoted fields with embedded commas.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = parts[j];
    rows.push(row);
  }
  return rows;
}

// GTFS times can exceed 24h ("25:15:00" = 1:15am next day). Caller mods by 24.
function parseGtfsTime(s) {
  if (!s) return null;
  const [h, m, sec] = s.split(':').map((x) => parseInt(x, 10));
  return h * 3600 + m * 60 + (sec || 0);
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Coarse day_type bucket — Sat/Sun stay separate since headways differ a lot.
function dayTypeFor(cal) {
  const weekday =
    cal.monday === '1' &&
    cal.tuesday === '1' &&
    cal.wednesday === '1' &&
    cal.thursday === '1' &&
    cal.friday === '1';
  const sat = cal.saturday === '1';
  const sun = cal.sunday === '1';
  if (weekday && !sat && !sun) return 'weekday';
  if (!weekday && sat && !sun) return 'saturday';
  if (!weekday && !sat && sun) return 'sunday';
  // mixed/unusual services skipped so we don't mash weekday + weekend together.
  return null;
}

// Map each service_id active in today's calendar window to its day-type
// (weekday / saturday / sunday). The day-type buckets represent *typical*
// service for that day-type, so we deliberately do NOT honor today's
// calendar_dates exceptions: removing weekday services that are excepted out for
// a holiday (e.g. Memorial Day) on the rebuild date would silently wipe the
// weekday bucket for a whole week; adding event-day services (e.g. United
// Center game days) would let them leak into the bucket every day. The runtime
// holiday-aware dayTypeKey handles per-date day-type selection.
function resolveServiceDayTypes({ calendars, todayStr }) {
  const out = new Map();
  for (const c of calendars) {
    const dt = dayTypeFor(c);
    if (!dt) continue;
    if (todayStr < c.start_date || todayStr > c.end_date) continue;
    out.set(c.service_id, dt);
  }
  return { serviceDayType: out };
}

// Day-level dominant origin per (route, dir): garage pullouts / short-turns
// staggered with revenue trips collapse the headway median below the
// rider-facing frequency, so headway/duration buckets only count trips from the
// dominant origin. ≥60% threshold keeps all origins when none dominates.
const BUS_DOMINANCE_THRESHOLD = 0.6;
function computeDominantOrigin(tripMeta, firstStopId, modeFilter, threshold) {
  const counts = new Map();
  for (const [tripId, meta] of tripMeta) {
    if (meta.mode !== modeFilter) continue;
    const origin = firstStopId.get(tripId);
    if (!origin) continue;
    const k = `${meta.route}|${meta.dir}`;
    if (!counts.has(k)) counts.set(k, new Map());
    const m = counts.get(k);
    m.set(origin, (m.get(origin) || 0) + 1);
  }
  const dominant = new Map();
  for (const [k, c] of counts) {
    let best = null;
    let bestCount = -1;
    let total = 0;
    for (const [stopId, n] of c) {
      total += n;
      if (n > bestCount) {
        bestCount = n;
        best = stopId;
      }
    }
    // Rail: always lock to the dominant origin (short-turns share direction_id
    // with full runs). Bus: only when it clears the threshold.
    if (best && (threshold == null || bestCount / total >= threshold)) dominant.set(k, best);
  }
  return dominant;
}

export async function buildGtfsIndex() {
  await downloadGtfs();

  // Route list + display names straight from GTFS. route_type 3 = bus, 1 = rail.
  const routeRows = parseCsv(readFromZip('routes.txt'));
  const names = {};
  const busRouteIds = [];
  const railRouteIds = [];
  for (const r of routeRows) {
    names[r.route_id] = r.route_long_name || r.route_short_name || r.route_id;
    if (r.route_type === '3') busRouteIds.push(r.route_id);
    else if (r.route_type === '1') railRouteIds.push(r.route_id);
  }
  busRouteIds.sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (na !== nb) return (Number.isNaN(na) ? 9999 : na) - (Number.isNaN(nb) ? 9999 : nb);
    return a.localeCompare(b);
  });

  const calendars = parseCsv(readFromZip('calendar.txt'));
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const { serviceDayType } = resolveServiceDayTypes({ calendars, todayStr });

  const busRouteSet = new Set(busRouteIds);
  const railRouteSet = new Set(railRouteIds);
  const trips = parseCsv(readFromZip('trips.txt'));
  const tripMeta = new Map();
  for (const t of trips) {
    let mode = null;
    if (busRouteSet.has(t.route_id)) mode = 'bus';
    else if (railRouteSet.has(t.route_id)) mode = 'rail';
    if (!mode) continue;
    const dt = serviceDayType.get(t.service_id);
    if (!dt) continue;
    tripMeta.set(t.trip_id, {
      route: t.route_id,
      dir: t.direction_id,
      dayType: dt,
      serviceId: t.service_id,
      mode,
    });
  }

  // First-stop departure + origin per trip (last-stop arrival/stop for durations).
  const firstDeparture = new Map();
  const firstSeq = new Map();
  const firstStopId = new Map();
  const lastArrival = new Map();
  const lastSeq = new Map();
  const lastStopId = new Map();
  let header = null;
  let tripIdIdx = -1;
  let stopIdIdx = -1;
  let depIdx = -1;
  let arrIdx = -1;
  let seqIdx = -1;
  await streamFromZip('stop_times.txt', (line) => {
    if (!header) {
      header = line.split(',').map((s) => s.replace(/"/g, '').trim());
      tripIdIdx = header.indexOf('trip_id');
      stopIdIdx = header.indexOf('stop_id');
      depIdx = header.indexOf('departure_time');
      arrIdx = header.indexOf('arrival_time');
      seqIdx = header.indexOf('stop_sequence');
      return;
    }
    const parts = line.split(',');
    const tripId = parts[tripIdIdx];
    if (!tripMeta.has(tripId)) return;
    const seq = parseInt(parts[seqIdx], 10);
    const prevFirst = firstSeq.get(tripId);
    if (prevFirst === undefined || seq < prevFirst) {
      firstSeq.set(tripId, seq);
      firstDeparture.set(tripId, parseGtfsTime(parts[depIdx]));
      firstStopId.set(tripId, parts[stopIdIdx]);
    }
    const prevLast = lastSeq.get(tripId);
    if (prevLast === undefined || seq > prevLast) {
      lastSeq.set(tripId, seq);
      lastArrival.set(tripId, parseGtfsTime(parts[arrIdx]));
      lastStopId.set(tripId, parts[stopIdIdx]);
    }
  });

  // Concurrent service_ids (daytime + Owl) overlap one dayType — resolve
  // dominance per hour so each picks the right one.
  const serviceTripCounts = new Map();
  for (const [tripId, meta] of tripMeta) {
    const dep = firstDeparture.get(tripId);
    if (dep == null) continue;
    const hour = Math.floor(dep / 3600) % 24;
    const k = `${meta.route}|${meta.dir}|${meta.dayType}|${hour}|${meta.serviceId}`;
    serviceTripCounts.set(k, (serviceTripCounts.get(k) || 0) + 1);
  }
  const dominantService = new Map();
  for (const [k, c] of serviceTripCounts) {
    const [route, dir, dayType, hour, serviceId] = k.split('|');
    const rdth = `${route}|${dir}|${dayType}|${hour}`;
    const prev = dominantService.get(rdth);
    if (!prev || c > prev.count) dominantService.set(rdth, { serviceId, count: c });
  }

  const railDominantOrigin = computeDominantOrigin(tripMeta, firstStopId, 'rail', null);
  const busDominantOrigin = computeDominantOrigin(
    tripMeta,
    firstStopId,
    'bus',
    BUS_DOMINANCE_THRESHOLD,
  );
  // Same dominance treatment, but on the trip's LAST stop — short-turns share
  // the dominant origin so they pass the origin filter and pollute durations
  // (e.g. 95th's dir-0 "full" run looks like 10 min at 10pm). Requiring the
  // dominant destination too drops them at the source.
  const railDominantDest = computeDominantOrigin(tripMeta, lastStopId, 'rail', null);
  const busDominantDest = computeDominantOrigin(
    tripMeta,
    lastStopId,
    'bus',
    BUS_DOMINANCE_THRESHOLD,
  );

  const buckets = new Map();
  const durationBuckets = new Map();
  const bucketKey = (route, dir, dayType, hour) => `${route}|${dir}|${dayType}|${hour}`;
  for (const [tripId, meta] of tripMeta) {
    const dep = firstDeparture.get(tripId);
    if (dep == null) continue;
    const hour = Math.floor(dep / 3600) % 24;
    const rdth = `${meta.route}|${meta.dir}|${meta.dayType}|${hour}`;
    const dominant = dominantService.get(rdth);
    if (!dominant || dominant.serviceId !== meta.serviceId) continue;
    const domOrigin =
      meta.mode === 'rail'
        ? railDominantOrigin.get(`${meta.route}|${meta.dir}`)
        : busDominantOrigin.get(`${meta.route}|${meta.dir}`);
    if (domOrigin && firstStopId.get(tripId) !== domOrigin) continue;
    const domDest =
      meta.mode === 'rail'
        ? railDominantDest.get(`${meta.route}|${meta.dir}`)
        : busDominantDest.get(`${meta.route}|${meta.dir}`);
    if (domDest && lastStopId.get(tripId) !== domDest) continue;

    const key = bucketKey(meta.route, meta.dir, meta.dayType, hour);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(dep);

    const arr = lastArrival.get(tripId);
    if (arr != null && arr > dep) {
      if (!durationBuckets.has(key)) durationBuckets.set(key, []);
      durationBuckets.get(key).push((arr - dep) / 60);
    }
  }

  const routeMode = new Map();
  for (const meta of tripMeta.values()) routeMode.set(meta.route, meta.mode);

  const out = { generatedAt: Date.now(), routes: {}, lines: {}, names, busRouteIds };
  for (const [key, times] of buckets) {
    if (times.length < 2) continue;
    const [route, dir, dayType, hourStr] = key.split('|');
    const hour = parseInt(hourStr, 10);
    const sorted = [...times].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / 60);
    const medMin = median(gaps);
    if (medMin == null) continue;
    const bucket = routeMode.get(route) === 'rail' ? out.lines : out.routes;
    if (!bucket[route]) bucket[route] = {};
    if (!bucket[route][dir]) bucket[route][dir] = { headways: {} };
    if (!bucket[route][dir].headways[dayType]) bucket[route][dir].headways[dayType] = {};
    bucket[route][dir].headways[dayType][hour] = Math.round(medMin * 10) / 10;

    const durations = durationBuckets.get(key);
    if (durations?.length) {
      const medDur = median(durations);
      if (medDur != null) {
        if (!bucket[route][dir].durations) bucket[route][dir].durations = {};
        if (!bucket[route][dir].durations[dayType]) bucket[route][dir].durations[dayType] = {};
        bucket[route][dir].durations[dayType][hour] = Math.round(medDur * 10) / 10;
      }
    }
  }

  console.log(
    `  GTFS index: ${Object.keys(out.routes).length} bus routes, ${Object.keys(out.lines).length} rail lines`,
  );
  return out;
}
