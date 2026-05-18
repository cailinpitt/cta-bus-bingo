// Per-leg list with times. Colors must match TripMap's palette.
import { fmtWalkDistance } from '../lib/units.js';
import { colorForLeg } from './TripMap.jsx';

function fmtMin(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function Itinerary({ plan, routes, onUseSuggestion }) {
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
      {plan.reachedEnd === false && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-amber-200 text-xs">
          Couldn't fully reach your destination via transit — this is the closest we could get.
        </div>
      )}
      <ol className="space-y-2">
        {plan.legs.map((l, i) => {
          const color = colorForLeg(l, i, routes);
          return (
            <li key={i} className="flex gap-2">
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
