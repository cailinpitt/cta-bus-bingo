// Per-leg list with times. Colors must match TripMap's palette.
import { useEffect, useState } from 'react';
import { itineraryToText, shareText } from '../lib/shareItinerary.js';
import { directionOf, fmtMin, fmtWalkDistance, terminusOf } from '../lib/units.js';
import { colorForLeg } from './TripMap.jsx';

export default function Itinerary({
  plan,
  routes,
  onUseSuggestion,
  ridden,
  onMarkRidden,
  start,
  end,
  onStartRiding,
  onRemoveLeg,
  onRequestSwap,
  onApplySwap,
  onCancelSwap,
  swapState,
  editError,
  lockedRoutes,
  onToggleLock,
}) {
  // Undo target — snapshot of the ridden set immediately *before* the most
  // recent mark action. Cleared on any subsequent plan change (parent unmounts
  // or re-renders with a new plan key).
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [shareStatus, setShareStatus] = useState(null); // null | 'shared' | 'copied'

  async function handleShareSteps() {
    const text = itineraryToText(plan, routes, { start, end });
    if (!text) return;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const status = await shareText({ text, url });
    if (status === 'shared' || status === 'copied') {
      setShareStatus(status);
      setTimeout(() => setShareStatus(null), 1500);
    }
  }
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
  // Bingo (non-free) legs are the ones the rider can remove / swap / lock; never
  // let the last one be removed (that would empty the trip).
  const bingoCount = plan.legs.filter((l) => !l.free).length;
  const canEdit = !!(onRemoveLeg || onRequestSwap || onToggleLock);
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
        <div className="flex items-center gap-2">
          <span className="font-medium text-gh-fg">~{fmtMin(plan.totalSeconds)} total</span>
          <button
            type="button"
            onClick={handleShareSteps}
            className="rounded bg-gh-subtle px-2 py-0.5 text-gh-muted text-xs hover:text-gh-fg"
            title="Share the itinerary as text (with the trip link)"
          >
            {shareStatus === 'copied'
              ? 'Copied!'
              : shareStatus === 'shared'
                ? 'Shared!'
                : '📋 Share steps'}
          </button>
        </div>
      </div>
      {onMarkRidden &&
        ridden &&
        (() => {
          const unmarked = plan.legs.filter((l) => !l.free && !ridden.has(l.rt)).map((l) => l.rt);
          const uniqueUnmarked = [...new Set(unmarked)];
          if (uniqueUnmarked.length === 0 && !undoSnapshot) return null;
          if (undoSnapshot) {
            return (
              <div className="mb-2 flex items-center justify-between rounded border border-emerald-700/60 bg-emerald-900/30 light:border-emerald-300 light:bg-emerald-50 px-2 py-1 text-emerald-200 light:text-emerald-800 text-xs">
                <span>Marked {undoSnapshot.added.length} as ridden.</span>
                <button
                  type="button"
                  onClick={() => {
                    onMarkRidden(undoSnapshot.previous);
                    setUndoSnapshot(null);
                  }}
                  className="rounded bg-emerald-800/60 px-2 py-0.5 hover:bg-emerald-700 light:bg-emerald-200"
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
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 light:border-amber-300 light:bg-amber-50 px-2 py-1 text-amber-200 light:text-amber-800 text-xs">
          Couldn't fully reach your destination via transit — this is the closest we could get.
        </div>
      )}
      {plan.reachedStart === false && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 light:border-amber-300 light:bg-amber-50 px-2 py-1 text-amber-200 light:text-amber-800 text-xs">
          Couldn't loop back near your start — this is the closest round trip we could build.
        </div>
      )}
      {editError && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/30 light:border-amber-300 light:bg-amber-50 px-2 py-1 text-amber-200 light:text-amber-800 text-xs">
          {editError}
        </div>
      )}
      {onStartRiding && (
        <button
          type="button"
          onClick={onStartRiding}
          className="mb-2 w-full rounded bg-blue-600 px-2 py-2 font-medium text-white text-sm hover:bg-blue-500"
        >
          🚌 Start riding
        </button>
      )}
      {/* Numbered timeline: each step's badge is the take-order, connected by a
          path with a down-arrow so the bus sequence reads at a glance. */}
      <ol>
        {plan.legs.map((l, i) => {
          const color = colorForLeg(l, i, routes);
          const isLast = i === plan.legs.length - 1;
          const terminus = terminusOf(l);
          const direction = directionOf(l);
          const isBingo = !l.free;
          const locked = !!lockedRoutes?.has(l.rt);
          const swapOpen = swapState?.legIdx === i;
          return (
            <li key={`${i}-${l.rt}-${l.boardStop.stopId}`} className="flex gap-3">
              {/* Left rail: step number + connecting path/arrow to the next leg. */}
              <div className="flex w-6 shrink-0 flex-col items-center">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full font-semibold text-[11px] text-white ring-2 ring-gh-surface"
                  style={{ backgroundColor: color }}
                >
                  {i + 1}
                </span>
                {!isLast && (
                  <>
                    <span className="w-0.5 flex-1 bg-gh-border" aria-hidden />
                    <svg
                      viewBox="0 0 12 12"
                      className="-mt-1 h-3 w-3 text-gh-border"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      role="img"
                      aria-label="then"
                    >
                      <path d="M3 5l3 3 3-3" />
                    </svg>
                  </>
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 font-medium text-gh-fg">
                    {l.free && (
                      <span className="mr-1 rounded bg-gh-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gh-muted">
                        {routes?.[l.rt]?.isTrain ? 'train' : 'ridden'}
                      </span>
                    )}
                    {routes?.[l.rt]?.isTrain ? null : l.rt}{' '}
                    <span className="text-gh-muted font-normal">{l.routeName}</span>
                    {locked && <span className="ml-1 text-[11px]">🔒</span>}
                    {terminus && (
                      <span className="block truncate font-normal text-gh-muted text-xs">
                        → {terminus}
                      </span>
                    )}
                    {direction && (
                      <span className="block font-normal text-[11px] text-gh-muted/80">
                        {direction}
                      </span>
                    )}
                  </div>
                  {canEdit && isBingo && (
                    <div className="flex shrink-0 items-center gap-1">
                      {onToggleLock && (
                        <button
                          type="button"
                          onClick={() => onToggleLock(l.rt)}
                          title={
                            locked
                              ? 'Unlock — allow re-planning to change this'
                              : 'Lock this bus so re-planning keeps it'
                          }
                          aria-pressed={locked}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${locked ? 'bg-amber-600 text-white' : 'bg-gh-subtle text-gh-muted hover:text-gh-fg'}`}
                        >
                          {locked ? '🔒' : '🔓'}
                        </button>
                      )}
                      {onRequestSwap && (
                        <button
                          type="button"
                          onClick={() => (swapOpen ? onCancelSwap?.() : onRequestSwap(i))}
                          title="Swap this bus for a different route"
                          className={`rounded px-1.5 py-0.5 text-[11px] ${swapOpen ? 'bg-blue-600 text-white' : 'bg-gh-subtle text-gh-muted hover:text-gh-fg'}`}
                        >
                          ⇄ Swap
                        </button>
                      )}
                      {onRemoveLeg && (
                        <button
                          type="button"
                          onClick={() => onRemoveLeg(i)}
                          disabled={bingoCount <= 1}
                          title={
                            bingoCount <= 1
                              ? 'Can’t remove the only bus'
                              : 'Remove this bus and close the gap'
                          }
                          className="rounded bg-gh-subtle px-1.5 py-0.5 text-[11px] text-gh-muted hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 light:hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-gh-muted text-xs">
                  {l.walkFeet > 50 && (
                    <>
                      Walk {fmtWalkDistance(l.walkFeet)} ({fmtMin(l.walkSeconds)}) to{' '}
                      <span className="text-gh-fg/80">{l.boardStop.stopName}</span>, then{' '}
                    </>
                  )}
                  {l.walkFeet <= 50 && (
                    <>
                      Board at <span className="text-gh-fg/80">{l.boardStop.stopName}</span>, then{' '}
                    </>
                  )}
                  ride {fmtMin(l.rideSeconds)} to{' '}
                  <span className="text-gh-fg/80">{l.alightStop.stopName}</span>.
                </div>

                {/* Swap candidate picker, opened for this leg. */}
                {swapOpen && (
                  <div className="mt-2 rounded border border-blue-700/50 bg-blue-950/30 light:border-blue-300 light:bg-blue-50 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-gh-muted text-[11px] uppercase tracking-wide">
                        Swap {l.rt} for
                      </span>
                      <button
                        type="button"
                        onClick={() => onCancelSwap?.()}
                        className="text-gh-muted text-[11px] hover:text-gh-fg"
                      >
                        Cancel
                      </button>
                    </div>
                    {swapState.loading ? (
                      <div className="py-1 text-gh-muted text-xs">Finding routes that fit…</div>
                    ) : swapState.candidates?.length ? (
                      <div className="flex flex-col gap-1">
                        {swapState.candidates.map((c) => (
                          <button
                            type="button"
                            key={c.rt}
                            onClick={() => onApplySwap?.(c)}
                            className="flex items-center justify-between gap-2 rounded bg-gh-surface px-2 py-1.5 text-left hover:bg-gh-border"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-semibold text-gh-fg">{c.rt}</span>{' '}
                              <span className="text-gh-muted text-xs">{c.name}</span>
                            </span>
                            <span className="shrink-0 text-gh-muted text-[11px]">
                              {fmtMin(c.totalSeconds)} · walk {fmtWalkDistance(c.walkFt)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-1 text-gh-muted text-xs">
                        No other route fits cleanly between these stops.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
