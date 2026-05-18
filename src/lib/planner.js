// Bus-bingo planner. Picks chains of unridden bus routes; can use trains or
// already-ridden buses as free connectors (don't count toward cap).
//
// Top-level API:
//   planTrips({ dataset, start, ridden, cap, roundTrip, scheduleMode, ... })
//     → { trips: Plan[], suggestedStart }
//
// Each Plan has `legs: Leg[]` where each leg has `free: boolean`. Free legs
// are train rides or ridden-bus rides used to reach a useful boarding point;
// they contribute to `totalSeconds` but don't count against `cap`.
//
// Algorithm at each unridden-leg step:
//   A. expandReachable(position) — build map stopId → { time, viaFreeLeg }
//      capturing every stop reachable via (walk) or (walk + 1 free ride + walk).
//   B. For each reachable stop, for each unridden bus route there, simulate
//      riding to every alighting stop along the pattern and score.
//   C. Pick best (with optional randomization noise for multi-trip variety).
//   D. Append free leg (if best entry used one) + the unridden leg to the chain.
//
// Multi-trip search runs the greedy planner N times with score noise + caches
// reachable expansions across runs to stay fast. Dedupe by sorted route-set.

import { haversineFeet, walkSeconds } from './geo.js';
import {
  headwayMinutes,
  isReducedService,
  minutesPerFoot,
  runsAtHour,
  runsToday,
} from './schedule.js';
import { stopsNear } from './spatial.js';

const MAX_WALK_FT = 2640; // 0.5 mi — boarding/alighting walk radius
const TRANSFER_FT = 660; // 1/8 mi — stops "share a transfer point" within this radius
const ROUND_TRIP_FT = 3960; // 0.75 mi — last alight must end within this of start (wider when trains allowed)
const END_NEAR_FT = 3960; // 0.75 mi — chain is "at the destination" within this radius
// Bias the last unridden leg's score by distance-to-end so the chain trends
// toward the destination; the post-chain bridge fills any remaining gap.
const END_BIAS_PENALTY_PER_FT = 0.00015;
// Bridge to end: after the unridden chain finishes, append up to N free
// (train / already-ridden bus) hops to reduce distance to the destination.
const MAX_BRIDGE_HOPS = 3;
const MAX_BRIDGE_RIDE_FT = 5280 * 15; // 15-mile cap per bridge hop (L trains)
const BRIDGE_TIME_PENALTY_PER_SEC = 3.28; // ft of progress required per sec of travel
const MIN_RIDE_FT = 5280; // 1 mile — hard floor on unridden leg length
const BACKTRACK_FT = 1000; // alight must be at least this far from a prior leg stop
const SUGGEST_MAX_FT = 10000; // ~1.9 mi — fallback start search radius
const MAX_FREE_RIDE_FT = 5280 * 5; // ~5 miles on a free connector
const FREE_RIDE_MIN_FT = 2000; // skip tiny free hops — barely worth the wait
// Performance bounds. The reachable map can balloon when a free leg is used
// (every nearby stop of every alight). Cap to keep per-run scoring bounded.
const MAX_REACHABLE = 1500;
// Subsample alights along each pattern to keep the inner loop tractable on
// long trains (Red line has 33 stops per direction; we don't need them all
// as boarding candidates).
const ALIGHT_STRIDE_FREE = 3;

const TIME_PENALTY_PER_SEC = 0.001;

function chooseSchedule(scheduleMode, gtfs, now) {
  if (!gtfs) return false;
  // Reject routes operating reduced/shuttle service — even though they're
  // "running", their pattern-wide schedule data overstates which stations
  // are actually reachable (Purple Line outside express hours, etc.).
  if (scheduleMode === 'now' && isReducedService(gtfs, now)) return false;
  if (scheduleMode === 'now') return runsAtHour(gtfs, now);
  return runsToday(gtfs, now);
}

function isFreeConnector(route, rt, ridden) {
  if (!route) return false;
  if (route.isTrain) return true;
  return ridden.has(rt);
}

// Find every alight on this pattern strictly after the boarding index, up to
// MAX_FREE_RIDE_FT (or unbounded if maxFt is null for unridden legs).
function* alightsAfter(pattern, boardIdx, maxFt) {
  const board = pattern.stops[boardIdx];
  for (let i = boardIdx + 1; i < pattern.stops.length; i++) {
    const a = pattern.stops[i];
    if (maxFt != null && a.pdist - board.pdist > maxFt) break;
    yield i;
  }
}

// Walk-only + walk-free-ride-walk reachability from `point`. Returns a Map of
// stopId → { time, viaFreeLeg, walkFromPoint? }. viaFreeLeg captures the leg
// details so we can prepend it to the chain when this entry is chosen.
//
// `allowFree=false` disables the free-ride expansion (used for the first run
// of the smoke test or callers that want pure walking).
function expandReachable({ point, dataset, ridden, scheduleMode, now, stopIndex, allowFree }) {
  const { routes, patterns } = dataset;
  const reachable = new Map(); // stopId -> { time, viaFreeLeg, walkFromPoint, finalWalkFeet }

  // 1. Walk-only entries.
  const nearby = stopsNear(stopIndex, point, MAX_WALK_FT);
  for (const s of nearby) {
    const d = haversineFeet(s, point);
    if (d > MAX_WALK_FT) continue;
    reachable.set(s.stopId, {
      time: walkSeconds(d),
      viaFreeLeg: null,
      walkFromPoint: d,
    });
  }
  if (!allowFree) return reachable;

  // 2. Walk + free ride + walk. For each nearby stop served by a free route,
  // ride to each alight (within MAX_FREE_RIDE_FT), then walk from alight to
  // every stop within MAX_WALK_FT. Keep the lowest-time path per destination.
  for (const board of nearby) {
    const walkFt1 = haversineFeet(board, point);
    if (walkFt1 > MAX_WALK_FT) continue;
    const walkSec1 = walkSeconds(walkFt1);

    for (const rt of board.routes) {
      const route = routes[rt];
      if (!isFreeConnector(route, rt, ridden)) continue;
      if (!chooseSchedule(scheduleMode, route.gtfs, now)) continue;
      const headway = headwayMinutes(route.gtfs, now) ?? 8;
      const waitSec = (headway * 60) / 2;

      for (const pid of route.patternIds) {
        const p = patterns[pid];
        if (!p) continue;
        const boardIdx = p.stops.findIndex((s) => s.stopId === board.stopId);
        if (boardIdx < 0) continue;

        let strideCount = 0;
        for (const alightIdx of alightsAfter(p, boardIdx, MAX_FREE_RIDE_FT)) {
          // Subsample alights along long free patterns (every Nth stop) to
          // keep expansion bounded on trains and very long bus routes.
          strideCount++;
          if (route.isTrain && strideCount % ALIGHT_STRIDE_FREE !== 0) continue;
          const alight = p.stops[alightIdx];
          const rideFt = alight.pdist - p.stops[boardIdx].pdist;
          if (rideFt < FREE_RIDE_MIN_FT) continue;
          const minPerFt = minutesPerFoot(route.gtfs, p, now);
          const rideSec = rideFt * minPerFt * 60;
          const freeLegTime = walkSec1 + waitSec + rideSec;

          // Walk from alight to nearby stops.
          const aroundAlight = stopsNear(stopIndex, alight, MAX_WALK_FT);
          for (const dest of aroundAlight) {
            const walkFt2 = haversineFeet(dest, alight);
            if (walkFt2 > MAX_WALK_FT) continue;
            const total = freeLegTime + walkSeconds(walkFt2);
            const existing = reachable.get(dest.stopId);
            if (existing && existing.time <= total) continue;
            reachable.set(dest.stopId, {
              time: total,
              walkFromPoint: walkFt1, // walk from `point` to board this free leg
              finalWalkFeet: walkFt2,
              viaFreeLeg: {
                rt,
                routeName: route.name,
                pattern: p,
                boardIdx,
                alightIdx,
                boardStop: p.stops[boardIdx],
                alightStop: alight,
                walkFeet: walkFt1,
                walkSeconds: walkSec1,
                rideSeconds: rideSec + waitSec,
                rideFt,
                free: true,
              },
            });
          }
        }
      }
    }
  }
  // Cap size — keep the lowest-time entries. Critical for performance when
  // long train rides cause the map to grow into the thousands.
  if (reachable.size > MAX_REACHABLE) {
    const entries = [...reachable.entries()].sort((a, b) => a[1].time - b[1].time);
    return new Map(entries.slice(0, MAX_REACHABLE));
  }
  return reachable;
}

function legTimeSeconds({ pattern, boardIdx, alightIdx }, gtfs, now) {
  const board = pattern.stops[boardIdx];
  const alight = pattern.stops[alightIdx];
  const rideFt = Math.max(0, alight.pdist - board.pdist);
  const minPerFt = minutesPerFoot(gtfs, pattern, now);
  const rideMin = rideFt * minPerFt;
  const headwayMin = headwayMinutes(gtfs, now) ?? 15;
  const waitMin = headwayMin / 2;
  return (rideMin + waitMin) * 60;
}

// Distance-weighted count of unridden, in-service bus routes accessible from
// `stop`. Each route contributes (1 - d/MAX_WALK_FT) using the *closest* stop
// of that route within walking range — so a transfer right at your feet
// counts ~1.0 and one at 700m counts ~0.1. This replaces the old binary
// "anything within 200m counts equally" so the planner prefers alights that
// are actually close to where the next bus stops, not just within shouting
// distance of one.
function transferAccess(stop, stopIndex, ridden, currentChain, mySelf, routes, scheduleMode, now) {
  const nearby = stopsNear(stopIndex, stop, MAX_WALK_FT);
  const bestDistByRt = new Map();
  for (const s of nearby) {
    const d = haversineFeet(s, stop);
    if (d > MAX_WALK_FT) continue;
    for (const rt of s.routes) {
      if (rt === mySelf) continue;
      if (ridden.has(rt) || currentChain.has(rt)) continue;
      const route = routes[rt];
      if (!route || route.isTrain) continue;
      if (!chooseSchedule(scheduleMode, route.gtfs, now)) continue;
      const prev = bestDistByRt.get(rt);
      if (prev === undefined || d < prev) bestDistByRt.set(rt, d);
    }
  }
  let score = 0;
  for (const d of bestDistByRt.values()) {
    score += Math.max(0, 1 - d / MAX_WALK_FT);
  }
  return score;
}

function* candidateUnriddenRides(route, boardStopId, patterns) {
  for (const pid of route.patternIds) {
    const p = patterns[pid];
    if (!p) continue;
    const boardIdx = p.stops.findIndex((s) => s.stopId === boardStopId);
    if (boardIdx < 0) continue;
    for (let alightIdx = boardIdx + 1; alightIdx < p.stops.length; alightIdx++) {
      yield { pattern: p, boardIdx, alightIdx };
    }
  }
}

// One greedy pass producing a single Plan. `noise(0..1)` is an rng used to add
// score perturbation for multi-trip diversity (pass () => 0 for deterministic).
function runOnePlan({
  dataset,
  start,
  ridden,
  cap,
  roundTrip,
  end,
  scheduleMode,
  now,
  stopIndex,
  allowFree,
  reachableCache,
  noise,
  noiseRange,
}) {
  const { routes, patterns, stops } = dataset;
  const chain = [];
  const chainSet = new Set();
  const priorStops = [];
  let position = start;
  let currentStopId = null; // null at trip start; populated after first leg

  for (let leg = 0; leg < cap; leg++) {
    const isLastLeg = leg === cap - 1;
    const mustReturnNear = roundTrip && isLastLeg ? start : null;
    const mustReturnRadius = ROUND_TRIP_FT;

    // Step A: reachable from current position (cache key handles both start
    // lat/lon and stopId-anchored positions).
    const cacheKey = currentStopId || `start:${position.lat},${position.lon}`;
    let reachable = reachableCache?.get(cacheKey);
    if (!reachable) {
      reachable = expandReachable({
        point: position,
        dataset,
        ridden,
        scheduleMode,
        now,
        stopIndex,
        allowFree,
      });
      reachableCache?.set(cacheKey, reachable);
    }

    // Step B: pick best unridden bus boarding among reachable stops.
    let best = null;
    for (const [stopId, reach] of reachable) {
      const stop = stops[stopId];
      if (!stop) continue;

      // Don't let a free leg's route get re-used in the next unridden leg.
      const freeRt = reach.viaFreeLeg?.rt;

      for (const rt of stop.routes) {
        if (rt === freeRt) continue;
        if (chainSet.has(rt) || ridden.has(rt)) continue;
        const route = routes[rt];
        if (!route || route.isTrain) continue;
        if (!chooseSchedule(scheduleMode, route.gtfs, now)) continue;

        for (const ride of candidateUnriddenRides(route, stopId, patterns)) {
          const alightStop = ride.pattern.stops[ride.alightIdx];
          const boardStop = ride.pattern.stops[ride.boardIdx];
          const rideFt = Math.max(0, alightStop.pdist - boardStop.pdist);
          if (rideFt < MIN_RIDE_FT) continue;

          if (mustReturnNear) {
            const d = haversineFeet(alightStop, mustReturnNear);
            if (d > mustReturnRadius) continue;
          }

          let backtrack = false;
          for (const prior of priorStops) {
            if (haversineFeet(alightStop, prior) < BACKTRACK_FT) {
              backtrack = true;
              break;
            }
          }
          if (backtrack) continue;

          const opps = isLastLeg
            ? 0
            : transferAccess(
                alightStop,
                stopIndex,
                ridden,
                chainSet,
                rt,
                routes,
                scheduleMode,
                now,
              );
          const rideSec = legTimeSeconds(ride, route.gtfs, now);
          let score = opps - (reach.time + rideSec) * TIME_PENALTY_PER_SEC;
          if (isLastLeg && end) {
            score -= haversineFeet(alightStop, end) * END_BIAS_PENALTY_PER_FT;
          }
          if (noise && noiseRange) score += (noise() - 0.5) * noiseRange;

          if (!best || score > best.score) {
            best = {
              score,
              rt,
              routeName: route.name,
              ride,
              boardStop,
              alightStop,
              rideSeconds: rideSec,
              rideFt,
              reach,
            };
          }
        }
      }
    }

    if (!best) break;

    // Step C: append free leg (if reach used one) + the unridden leg.
    if (best.reach.viaFreeLeg) {
      chain.push({ ...best.reach.viaFreeLeg });
      priorStops.push(best.reach.viaFreeLeg.boardStop, best.reach.viaFreeLeg.alightStop);
    }
    // Walk from end of free leg (or from position if no free leg) to boarding.
    const walkFeet = best.reach.viaFreeLeg ? best.reach.finalWalkFeet : best.reach.walkFromPoint;
    chain.push({
      rt: best.rt,
      routeName: best.routeName,
      pattern: best.ride.pattern,
      boardIdx: best.ride.boardIdx,
      alightIdx: best.ride.alightIdx,
      boardStop: best.boardStop,
      alightStop: best.alightStop,
      walkFeet: walkFeet ?? 0,
      walkSeconds: walkSeconds(walkFeet ?? 0),
      rideSeconds: best.rideSeconds,
      rideFt: best.rideFt,
      free: false,
    });
    chainSet.add(best.rt);
    priorStops.push(best.boardStop, best.alightStop);
    position = best.alightStop;
    currentStopId = best.alightStop.stopId;
  }

  // Bridge to destination: if `end` is set and the chain didn't land near it,
  // append free legs (trains + already-ridden buses, including this trip's own
  // routes) to get closer. This is the "get me to my destination by transit"
  // step — separate from bingo, doesn't count toward newRouteCount.
  if (end) {
    appendBridgeToEnd({
      chain,
      chainSet,
      getPosition: () => position,
      setPosition: (p) => {
        position = p;
      },
      end,
      dataset,
      ridden,
      scheduleMode,
      now,
      stopIndex,
    });
  }

  const totalSeconds = chain.reduce((n, l) => n + l.walkSeconds + l.rideSeconds, 0);
  const newRouteCount = chain.filter((l) => !l.free).length;
  const reachedEnd = end ? haversineFeet(position, end) <= END_NEAR_FT : null;
  return { legs: chain, totalSeconds, newRouteCount, start, end: position, reachedEnd };
}

// Iteratively append free-connector legs that reduce the distance to `end`.
// Free = trains or any bus the user has ridden (including routes used earlier
// in this trip's unridden chain — once you've ridden it in this plan, it's a
// fine connector). Stops when within END_NEAR_FT, no leg makes progress, or
// MAX_BRIDGE_HOPS reached.
function appendBridgeToEnd({
  chain,
  chainSet,
  getPosition,
  setPosition,
  end,
  dataset,
  ridden,
  scheduleMode,
  now,
  stopIndex,
}) {
  const { routes, patterns } = dataset;
  const usedRoutes = new Set([...ridden, ...chainSet]);

  for (let hop = 0; hop < MAX_BRIDGE_HOPS; hop++) {
    const position = getPosition();
    const curDist = haversineFeet(position, end);
    if (curDist <= END_NEAR_FT) return;

    let best = null;
    const nearby = stopsNear(stopIndex, position, MAX_WALK_FT);
    for (const board of nearby) {
      const walkFt1 = haversineFeet(board, position);
      if (walkFt1 > MAX_WALK_FT) continue;
      const walkSec1 = walkSeconds(walkFt1);

      for (const rt of board.routes) {
        const route = routes[rt];
        if (!route) continue;
        if (!route.isTrain && !usedRoutes.has(rt)) continue;
        if (!chooseSchedule(scheduleMode, route.gtfs, now)) continue;
        const headway = headwayMinutes(route.gtfs, now) ?? 8;
        const waitSec = (headway * 60) / 2;

        for (const pid of route.patternIds) {
          const p = patterns[pid];
          if (!p) continue;
          const boardIdx = p.stops.findIndex((s) => s.stopId === board.stopId);
          if (boardIdx < 0) continue;
          const minPerFt = minutesPerFoot(route.gtfs, p, now);

          let strideCount = 0;
          for (const alightIdx of alightsAfter(p, boardIdx, MAX_BRIDGE_RIDE_FT)) {
            strideCount++;
            if (route.isTrain && strideCount % ALIGHT_STRIDE_FREE !== 0) continue;
            const alight = p.stops[alightIdx];
            const distToEnd = haversineFeet(alight, end);
            if (distToEnd >= curDist) continue;
            const rideFt = alight.pdist - p.stops[boardIdx].pdist;
            const rideSec = rideFt * minPerFt * 60;
            const totalTime = walkSec1 + waitSec + rideSec;
            const progress = curDist - distToEnd;
            const score = progress - totalTime * BRIDGE_TIME_PENALTY_PER_SEC;
            if (!best || score > best.score) {
              best = {
                score,
                rt,
                routeName: route.name,
                pattern: p,
                boardIdx,
                alightIdx,
                boardStop: p.stops[boardIdx],
                alightStop: alight,
                walkFeet: walkFt1,
                walkSeconds: walkSec1,
                rideSeconds: rideSec + waitSec,
                rideFt,
              };
            }
          }
        }
      }
    }
    if (!best) return;

    chain.push({
      rt: best.rt,
      routeName: best.routeName,
      pattern: best.pattern,
      boardIdx: best.boardIdx,
      alightIdx: best.alightIdx,
      boardStop: best.boardStop,
      alightStop: best.alightStop,
      walkFeet: best.walkFeet,
      walkSeconds: best.walkSeconds,
      rideSeconds: best.rideSeconds,
      rideFt: best.rideFt,
      free: true,
    });
    usedRoutes.add(best.rt);
    setPosition(best.alightStop);
  }
}

export function planTrips({
  dataset,
  start,
  ridden,
  cap,
  roundTrip,
  end = null,
  scheduleMode,
  now = new Date(),
  stopIndex,
  allowFree = true,
  candidateCount = 3,
  searchRuns = 30,
  noise = Math.random,
}) {
  const planKey = (p) =>
    p.legs
      .filter((l) => !l.free)
      .map((l) => l.rt)
      .sort()
      .join(',');

  // Shared across all searches — same start/ridden/schedule means the same
  // reachable expansions are valid regardless of cap or endMode.
  const reachableCache = new Map();

  function searchOne({ capCount, runs }) {
    const baseline = runOnePlan({
      dataset,
      start,
      ridden,
      cap: capCount,
      roundTrip,
      end,
      scheduleMode,
      now,
      stopIndex,
      allowFree,
      reachableCache,
      noise: () => 0.5,
      noiseRange: 0,
    });
    const seen = new Map();
    if (baseline.newRouteCount > 0) seen.set(planKey(baseline), baseline);
    for (let i = 0; i < runs; i++) {
      const plan = runOnePlan({
        dataset,
        start,
        ridden,
        cap: capCount,
        roundTrip,
        end,
        scheduleMode,
        now,
        stopIndex,
        allowFree,
        reachableCache,
        noise,
        noiseRange: 1.2,
      });
      if (plan.newRouteCount === 0) continue;
      const key = planKey(plan);
      const existing = seen.get(key);
      if (!existing || plan.totalSeconds < existing.totalSeconds) seen.set(key, plan);
    }
    return [...seen.values()];
  }

  let pool;
  if (end) {
    // Cap is a ceiling when a destination is set: search every length 1..cap
    // and pool all candidates. Each runOnePlan appends bridge legs so any
    // chain can potentially "reach" the destination via transit. Partition
    // into reached/not-reached so reached plans dominate ranking.
    const all = [];
    const perCapRuns = Math.max(2, Math.floor(searchRuns / cap));
    for (let c = 1; c <= cap; c++) {
      for (const p of searchOne({ capCount: c, runs: perCapRuns })) all.push(p);
    }
    const reached = all.filter((p) => p.reachedEnd);
    pool = reached.length > 0 ? reached : all;
  } else {
    pool = searchOne({ capCount: cap, runs: searchRuns });
  }

  const scored = pool
    .map((p) => ({
      ...p,
      score: p.newRouteCount * 10000 - p.totalSeconds / 60,
    }))
    .sort((a, b) => b.score - a.score);
  const trips = scored.slice(0, candidateCount);

  let suggestedStart = null;
  if (trips.length === 0) {
    const hit = findNearestUnriddenStop({
      dataset,
      point: start,
      ridden,
      scheduleMode,
      now,
      stopIndex,
    });
    if (hit && hit.distance > MAX_WALK_FT) suggestedStart = hit;
  }
  return { trips, suggestedStart, start, end };
}

// Find the closest stop served by an unridden, in-service route. Used when no
// trip can be built from the user's chosen start.
export function findNearestUnriddenStop({ dataset, point, ridden, scheduleMode, now, stopIndex }) {
  const { routes, stops } = dataset;
  const candidates = stopsNear(stopIndex, point, SUGGEST_MAX_FT);
  let best = null;
  for (const s of candidates) {
    const d = haversineFeet(s, point);
    if (d > SUGGEST_MAX_FT) continue;
    let hasUnridden = false;
    for (const rt of s.routes) {
      if (ridden.has(rt)) continue;
      const route = routes[rt];
      if (!route || route.isTrain) continue;
      if (!chooseSchedule(scheduleMode, route.gtfs, now)) continue;
      hasUnridden = true;
      break;
    }
    if (!hasUnridden) continue;
    if (!best || d < best.distance) best = { stop: stops[s.stopId], distance: d };
  }
  return best;
}

// Backwards-compatible single-plan API (smoke test uses this).
export function planTrip(args) {
  const { trips, suggestedStart, start } = planTrips({ ...args, candidateCount: 1, searchRuns: 0 });
  if (trips.length === 0) {
    return {
      legs: [],
      totalSeconds: 0,
      start,
      end: start,
      suggestedStart,
    };
  }
  return { ...trips[0], suggestedStart };
}

export const _consts = {
  MAX_WALK_FT,
  TRANSFER_FT,
  ROUND_TRIP_FT,
  MIN_RIDE_FT,
  BACKTRACK_FT,
  MAX_FREE_RIDE_FT,
};
