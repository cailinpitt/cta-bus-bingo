// Focused "you're riding it" view: one big card per leg, advance manually as
// you arrive. Pairs with the map (zoomed to the current leg). Persists via the
// plan snapshot so a reload / PWA-relaunch drops you back on the same step.

import { headwayMinutes } from '../lib/schedule.js';
import { fmtMin, fmtWalkDistance } from '../lib/units.js';
import { colorForLeg } from './TripMap.jsx';

export default function RideMode({ plan, routes, legIdx, onPrev, onNext, onExit }) {
  if (!plan?.legs?.length) return null;
  const total = plan.legs.length;
  const idx = Math.max(0, Math.min(legIdx ?? 0, total - 1));
  const leg = plan.legs[idx];
  const route = routes?.[leg.rt];
  const isTrain = !!route?.isTrain;
  const color = colorForLeg(leg, idx, routes);
  const stopsToGo = Math.max(1, (leg.alightIdx ?? 0) - (leg.boardIdx ?? 0));
  const routeLabel = isTrain
    ? route?.name || leg.rt
    : `${leg.rt}${route?.name ? ` ${route.name}` : ''}`;
  const headway =
    !leg.free && route?.gtfs ? headwayMinutes(route.gtfs, leg.pattern, new Date()) : null;

  const isFirst = idx === 0;
  const isLast = idx === total - 1;

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-gh-muted text-xs uppercase tracking-wide">
          Riding · step {idx + 1} of {total}
        </span>
        <button
          type="button"
          onClick={onExit}
          className="rounded bg-gh-subtle px-2 py-0.5 text-gh-fg text-xs hover:bg-gh-border"
          title="Exit ride mode"
        >
          Exit
        </button>
      </div>

      {/* Big colored route badge (matches the map leg's color). */}
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-bold text-white shadow"
          style={{ backgroundColor: color }}
        >
          {isTrain ? '🚆' : <span className="text-base">{leg.rt}</span>}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-gh-fg text-xl leading-tight">{routeLabel}</div>
          {leg.free && (
            <div className="text-gh-muted text-[11px] uppercase tracking-wide">
              {isTrain ? 'train connector' : 'ridden connector'}
            </div>
          )}
        </div>
      </div>

      {leg.walkFeet > 50 && (
        <div className="mb-3 rounded bg-gh-canvas p-3">
          <div className="text-gh-muted text-xs uppercase tracking-wide">Walk</div>
          <div className="font-medium text-gh-fg">
            {fmtWalkDistance(leg.walkFeet)} to{' '}
            <span className="font-bold">{leg.boardStop.stopName}</span>
          </div>
          <div className="text-gh-muted text-xs">{fmtMin(leg.walkSeconds)}</div>
        </div>
      )}

      <div className="mb-3 rounded bg-gh-canvas p-3">
        <div className="text-gh-muted text-xs uppercase tracking-wide">Ride</div>
        <div className="font-bold text-gh-fg text-xl leading-tight">
          {stopsToGo} {stopsToGo === 1 ? 'stop' : 'stops'} · {fmtMin(leg.rideSeconds)}
        </div>
        <div className="mt-1 text-gh-fg">
          Get off at <span className="font-bold">{leg.alightStop.stopName}</span>
        </div>
        {leg.walkFeet <= 50 && !leg.free && (
          <div className="mt-1 text-gh-muted text-xs">
            Board at <span className="text-gh-fg">{leg.boardStop.stopName}</span>
          </div>
        )}
        {headway && (
          <div className="mt-2 text-gh-muted text-xs">
            Comes ~every {Math.round(headway)} min (scheduled)
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={isFirst}
          className="rounded bg-gh-subtle px-3 py-2 text-gh-fg text-sm hover:bg-gh-border disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous leg"
        >
          ← Prev
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={onExit}
            className="flex-1 rounded bg-emerald-600 px-3 py-3 font-medium text-white hover:bg-emerald-500"
          >
            Trip complete 🎉
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex-1 rounded bg-emerald-600 px-3 py-3 font-medium text-white hover:bg-emerald-500"
          >
            Next leg →
          </button>
        )}
      </div>
    </div>
  );
}
