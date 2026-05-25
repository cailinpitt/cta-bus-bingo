// Per-leg list with times. Colors must match TripMap's palette.
import { useEffect, useState } from 'react';
import { fmtMin, fmtWalkDistance } from '../lib/units.js';
import { colorForLeg } from './TripMap.jsx';

export default function Itinerary({ plan, routes, onUseSuggestion, ridden, onMarkRidden }) {
  // Undo target — snapshot of the ridden set immediately *before* the most
  // recent mark action. Cleared on any subsequent plan change (parent unmounts
  // or re-renders with a new plan key).
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  // Reset undo state when the plan identity changes — re-planning shouldn't
  // leave a stale "Marked N — Undo" banner pointing at the previous trip.
  const planKey = plan?.legs?.map((l) => l.rt).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: planKey is a derived string identity for the legs
  useEffect(() => {
    setUndoSnapshot(null);
  }, [planKey]);
  if (!plan) return null;
  if (plan.legs.length === 0) {
    const sug = plan.suggestedStart;
    return (
      <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
        <div className="text-gh-muted">
          No unridden routes within walking distance of your start.
        </div>
        {sug ? (
          <button
            type="button"
            onClick={() => onUseSuggestion?.(sug)}
            className="mt-2 w-full rounded bg-blue-600 px-3 py-2 text-left text-white hover:bg-blue-500"
          >
            <div className="text-xs uppercase tracking-wide opacity-80">Try starting at</div>
            <div className="font-medium">{sug.stop.stopName}</div>
            <div className="text-xs opacity-80">{fmtWalkDistance(sug.distance)} away</div>
          </button>
        ) : (
          <div className="mt-1 text-gh-muted text-xs">
            Nothing workable within 2 mi either — try a different start.
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-gh-muted uppercase tracking-wide">
          {plan.newRouteCount} new {plan.newRouteCount === 1 ? 'route' : 'routes'}
          {plan.legs.length > plan.newRouteCount && (
            <span className="ml-1 text-gh-muted/60">
              + {plan.legs.length - plan.newRouteCount} ridden
            </span>
          )}
        </span>
        <span className="font-medium text-white">~{fmtMin(plan.totalSeconds)} total</span>
      </div>
      {onMarkRidden &&
        ridden &&
        (() => {
          const unmarked = plan.legs.filter((l) => !l.free && !ridden.has(l.rt)).map((l) => l.rt);
          const uniqueUnmarked = [...new Set(unmarked)];
          if (uniqueUnmarked.length === 0 && !undoSnapshot) return null;
          if (undoSnapshot) {
            return (
              <div className="mb-2 flex items-center justify-between rounded border border-emerald-700/60 bg-emerald-900/30 px-2 py-1 text-emerald-200 text-xs">
                <span>Marked {undoSnapshot.added.length} as ridden.</span>
                <button
                  type="button"
                  onClick={() => {
                    onMarkRidden(undoSnapshot.previous);
                    setUndoSnapshot(null);
                  }}
                  className="rounded bg-emerald-800/60 px-2 py-0.5 hover:bg-emerald-700"
                >
                  Undo
                </button>
              </div>
            );
          }
          return (
            <button
              type="button"
              onClick={() => {
                const next = new Set(ridden);
                for (const rt of uniqueUnmarked) next.add(rt);
                setUndoSnapshot({ added: uniqueUnmarked, previous: new Set(ridden) });
                onMarkRidden(next);
              }}
              className="mb-2 w-full rounded bg-emerald-700 px-2 py-1.5 text-white text-xs hover:bg-emerald-600"
            >
              Mark {uniqueUnmarked.length} {uniqueUnmarked.length === 1 ? 'route' : 'routes'} as
              ridden
            </button>
          );
        })()}
      {plan.reachedEnd === false && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-amber-200 text-xs">
          Couldn't fully reach your destination via transit — this is the closest we could get.
        </div>
      )}
      {plan.reachedStart === false && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-amber-200 text-xs">
          Couldn't loop back near your start — this is the closest round trip we could build.
        </div>
      )}
      <ol className="space-y-2">
        {plan.legs.map((l, i) => {
          const color = colorForLeg(l, i, routes);
          return (
            <li key={`${i}-${l.rt}-${l.boardStop.stopId}`} className="flex gap-2">
              <span
                aria-hidden
                className={`mt-1 h-3 w-3 shrink-0 ${l.free ? 'rounded-sm' : 'rounded-full'}`}
                style={{ backgroundColor: color }}
              />
              <div className="flex-1">
                <div className="font-medium text-white">
                  {l.free && (
                    <span className="mr-1 rounded bg-gh-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gh-muted">
                      {routes?.[l.rt]?.isTrain ? 'train' : 'ridden'}
                    </span>
                  )}
                  {routes?.[l.rt]?.isTrain ? null : l.rt}{' '}
                  <span className="text-gh-muted font-normal">{l.routeName}</span>
                </div>
                <div className="text-gh-muted text-xs">
                  {l.walkFeet > 50 && (
                    <>
                      Walk {fmtWalkDistance(l.walkFeet)} ({fmtMin(l.walkSeconds)}) to{' '}
                      <span className="text-white/80">{l.boardStop.stopName}</span>, then{' '}
                    </>
                  )}
                  {l.walkFeet <= 50 && (
                    <>
                      Board at <span className="text-white/80">{l.boardStop.stopName}</span>, then{' '}
                    </>
                  )}
                  ride {fmtMin(l.rideSeconds)} to{' '}
                  <span className="text-white/80">{l.alightStop.stopName}</span>.
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
