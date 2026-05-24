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
export function isReducedService(gtfs, now) {
  if (!gtfs) return false;
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  let currentMin = null;
  let maxAcrossWeek = 0;
  for (const d of Object.values(gtfs)) {
    for (const dt of ['weekday', 'saturday', 'sunday']) {
      const dur = d?.durations?.[dt];
      if (!dur) continue;
      for (const v of Object.values(dur)) {
        if (typeof v === 'number' && v > maxAcrossWeek) maxAcrossWeek = v;
      }
    }
    const dur = d?.durations?.[dayType];
    if (dur && dur[hour] != null) {
      if (currentMin == null || dur[hour] < currentMin) currentMin = dur[hour];
    }
  }
  if (currentMin == null || maxAcrossWeek === 0) return false;
  return currentMin < 0.5 * maxAcrossWeek;
}

// Headway (minutes) for a route, picking the direction with data for `hour`.
// Falls back to nearby hours within ±2 if exact hour is missing.
export function headwayMinutes(gtfs, now) {
  if (!gtfs) return null;
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  let best = null;
  for (const d of Object.values(gtfs)) {
    const hw = d?.headways?.[dayType];
    if (!hw) continue;
    for (let delta = 0; delta <= 2; delta++) {
      for (const h of [hour + delta, hour - delta]) {
        if (hw[h] != null) {
          if (best == null || hw[h] < best) best = hw[h];
          break;
        }
      }
      if (best != null) break;
    }
  }
  return best;
}

// Per-mile minutes of travel time on this route at this hour, averaged across directions
// using the GTFS index's reported pattern length (we don't have it here, so we use minutes
// per route-traversal divided by typical CTA bus route length — but better: we use the
// pattern's lengthFt at the call site and compute speed_ft_per_min from durations).
//
// Returns minutes per foot. Caller multiplies by the segment's pdist delta to get
// in-vehicle time. Falls back to a citywide default if the GTFS index doesn't have data.
const DEFAULT_BUS_FT_PER_MIN = 1320; // ~15 mph
export function minutesPerFoot(gtfs, pattern, now) {
  const dayType = dayTypeKey(now);
  const hour = now.getHours();
  if (gtfs) {
    for (const d of Object.values(gtfs)) {
      const dur = d?.durations?.[dayType];
      if (!dur) continue;
      for (let delta = 0; delta <= 2; delta++) {
        for (const h of [hour + delta, hour - delta]) {
          if (dur[h] != null && pattern?.lengthFt) {
            return dur[h] / pattern.lengthFt;
          }
        }
      }
    }
  }
  return 1 / DEFAULT_BUS_FT_PER_MIN;
}
