// Schedule-awareness against the GTFS index shape.
//
// `gtfs` for a route looks like { "0": dirEntry, "1": dirEntry } where dirEntry has:
//   headways:    { weekday: { "<hour>": minutes }, saturday: {...}, sunday: {...} }
//   durations:   same shape, in minutes end-to-end
//   activeByHour: same shape, average number of buses observed
//
// "Running today" = any direction has at least one hour with headway data for today's day type.
// "Running right now" = at least one direction has headway data for the current hour (or near-future).

const DAY_TYPES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function dayTypeKey(date) {
  const day = date.getDay();
  if (day === 0) return 'sunday';
  if (day === 6) return 'saturday';
  return 'weekday';
}

export function dayLabel(date) {
  return DAY_TYPES[date.getDay()];
}

function dirsForDayType(gtfs, dayType) {
  if (!gtfs) return [];
  return Object.values(gtfs).filter(
    (d) => d?.headways?.[dayType] && Object.keys(d.headways[dayType]).length > 0,
  );
}

export function runsToday(gtfs, now) {
  return dirsForDayType(gtfs, dayTypeKey(now)).length > 0;
}

export function runsAtHour(gtfs, now) {
  const dayType = dayTypeKey(now);
  const hour = String(now.getHours());
  // Allow a 1-hour lookahead so a trip planned at 7:45 can still board an 8am-only route.
  const nextHour = String((now.getHours() + 1) % 24);
  return dirsForDayType(gtfs, dayType).some(
    (d) => d.headways[dayType][hour] != null || d.headways[dayType][nextHour] != null,
  );
}

// A route is "running reduced service" when this hour's end-to-end duration
// is dramatically shorter than its peak — the canonical case is the Purple
// Line operating as the Linden↔Howard shuttle outside express hours, where
// the full Loop-going pattern isn't in service. We can't trust pattern-wide
// rides under those conditions, so the planner skips the route.
//
// Evaluated PER DIRECTION against each direction's own weekly peak: a route is
// reduced only when *every* direction with data this hour is truncated. Using a
// global min-across-directions (the old behavior) wrongly excluded a route whose
// late-night short-turn appears in one direction while the other still runs its
// full pattern (e.g. 95th at 10pm: one direction short-turns, the other doesn't).
export function isReducedService(gtfs, now) {
  if (!gtfs) return false;
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  let anyDirHasData = false;
  let allReduced = true;
  for (const d of Object.values(gtfs)) {
    // This direction's own peak duration across the whole week.
    let dirMax = 0;
    for (const dt of ['weekday', 'saturday', 'sunday']) {
      const dur = d?.durations?.[dt];
      if (!dur) continue;
      for (const v of Object.values(dur)) {
        if (typeof v === 'number' && v > dirMax) dirMax = v;
      }
    }
    const curDur = d?.durations?.[dayType]?.[hour];
    if (curDur == null || dirMax === 0) continue; // no data this hour for this direction
    anyDirHasData = true;
    if (curDur >= 0.5 * dirMax) allReduced = false; // this direction runs full → not reduced
  }
  return anyDirHasData && allReduced;
}

// Nearest-hour lookup within ±2 hours for one direction's hourly map. Returns
// the value at the closest hour with data, or null.
function nearestHourValue(map, hour) {
  if (!map) return null;
  for (let delta = 0; delta <= 2; delta++) {
    for (const h of [hour + delta, hour - delta]) {
      if (map[h] != null) return map[h];
    }
  }
  return null;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Headway (minutes) for a route at this hour. We can't map a ride's compass
// direction to a GTFS direction_id (the baked data doesn't carry that link), so
// we take the MEDIAN of the directions' nearest-hour headways rather than the
// optimistic min-across-directions. The min understated the wait whenever the
// boarded direction was the less-frequent one; the two directions of a route are
// usually within a minute or two, so the median is the representative wait.
// Falls back to nearby hours within ±2 per direction if the exact hour is missing.
export function headwayMinutes(gtfs, now) {
  if (!gtfs) return null;
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  const samples = [];
  for (const d of Object.values(gtfs)) {
    const v = nearestHourValue(d?.headways?.[dayType], hour);
    if (v != null) samples.push(v);
  }
  return median(samples);
}

// Per-foot minutes of in-vehicle travel time on this pattern at this hour.
//
// Returns minutes per foot; the caller multiplies by the segment's pdist delta
// to get in-vehicle time. Computed as durations[hour] / pattern.lengthFt for
// each direction with data, then the MEDIAN of the plausible samples.
//
// "Plausible" filters out short-turn artifacts: the baked duration index buckets
// trips by dominant *origin*, but a short-turn that shares the origin and ends
// early still slips in, producing a tiny end-to-end duration. Divided by the
// pattern's full length that implies an impossible speed (e.g. a 10-min "full"
// run of the 9.7-mi 95th route → ~58 mph). We drop any sample faster than a
// mode-specific ceiling so those artifacts don't make legs look 4-5x too fast.
const DEFAULT_BUS_FT_PER_MIN = 1320; // ~15 mph
const DEFAULT_TRAIN_FT_PER_MIN = 2200; // ~25 mph
const MAX_BUS_FT_PER_MIN = 3960; // ~45 mph — faster implies a short-turn artifact
const MAX_TRAIN_FT_PER_MIN = 4400; // ~50 mph

function isTrainPattern(pattern) {
  return typeof pattern?.pid === 'string' && pattern.pid.startsWith('train-');
}

export function minutesPerFoot(gtfs, pattern, now) {
  const isTrain = isTrainPattern(pattern);
  const fallback = 1 / (isTrain ? DEFAULT_TRAIN_FT_PER_MIN : DEFAULT_BUS_FT_PER_MIN);
  if (!gtfs || !pattern?.lengthFt) return fallback;
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  const ceil = isTrain ? MAX_TRAIN_FT_PER_MIN : MAX_BUS_FT_PER_MIN;
  const samples = [];
  for (const d of Object.values(gtfs)) {
    const dur = nearestHourValue(d?.durations?.[dayType], hour);
    if (dur == null) continue;
    const ftPerMin = pattern.lengthFt / dur;
    if (ftPerMin <= ceil) samples.push(dur / pattern.lengthFt); // plausible → keep
  }
  return median(samples) ?? fallback;
}
