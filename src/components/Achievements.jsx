import { useMemo, useState } from 'react';
import {
  countAchievements,
  countCardContent,
  neighborhoodAchievements,
  neighborhoodCardContent,
} from '../lib/achievements.js';
import { downloadImage, renderShareCard, shareImage } from '../lib/shareCard.js';
import { OVERLAY_PALETTE } from './TripMap.jsx';

function routeNum(rt) {
  const m = rt.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

// Up to 8 route ids spread across `routeIds`, colored — the card's "marked squares".
// Returns the truncated chip set + the count of routes that didn't fit, so the
// renderer can append a "+N more" pill (otherwise a "25 routes" card showing 8
// chips reads like only those 8 were ridden).
function chipsFrom(routeIds) {
  const max = 8;
  const n = Math.min(max, routeIds.length);
  if (n === 0) return { chips: [], extra: 0 };
  const step = routeIds.length / n;
  const chips = Array.from({ length: n }, (_, i) => ({
    label: routeIds[Math.floor(i * step)],
    color: OVERLAY_PALETTE[i % OVERLAY_PALETTE.length],
  }));
  return { chips, extra: Math.max(0, routeIds.length - n) };
}

// Earned badge: Share (native sheet) + ⬇ (direct download). Renders the same card.
function ShareButtons({ id, busyId, onAct }) {
  return (
    <div className="mt-1 flex gap-1">
      <button
        type="button"
        onClick={() => onAct('share')}
        disabled={busyId === id}
        className="flex-1 rounded bg-emerald-700 px-2 py-1 text-white text-xs hover:bg-emerald-600 disabled:opacity-50"
      >
        {busyId === id ? '…' : 'Share'}
      </button>
      <button
        type="button"
        onClick={() => onAct('download')}
        disabled={busyId === id}
        className="rounded bg-gh-subtle px-2 py-1 text-gh-fg text-xs hover:bg-gh-border disabled:opacity-50"
        title="Download image"
        aria-label="Download image"
      >
        ⬇
      </button>
    </div>
  );
}

// Milestone + neighborhood achievements with shareable/downloadable cards.
export default function Achievements({ routes, ridden, neighborhoods = [] }) {
  const [collapsed, setCollapsed] = useState(true);
  const [showAllHoods, setShowAllHoods] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const { count, total } = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const [rt, r] of Object.entries(routes)) {
      if (r.isTrain) continue;
      total++;
      if (ridden.has(rt)) count++;
    }
    return { count, total };
  }, [routes, ridden]);

  const milestones = useMemo(() => countAchievements(count, total), [count, total]);
  // Sorted list of ridden bus routes — clamped per-milestone below so a
  // "25 routes" card built from a 49-ride history shows only 25 routes' worth.
  const riddenSorted = useMemo(() => {
    const rs = [...ridden].filter((rt) => routes[rt] && !routes[rt].isTrain);
    rs.sort((a, b) => routeNum(a) - routeNum(b) || a.localeCompare(b));
    return rs;
  }, [ridden, routes]);

  const hoods = useMemo(
    () => neighborhoodAchievements(ridden, neighborhoods),
    [ridden, neighborhoods],
  );
  const doneHoods = hoods.filter((h) => h.earned);
  const nearHoods = hoods
    .filter((h) => !h.earned && h.riddenCount > 0)
    .sort((a, b) => a.remaining - b.remaining || b.riddenCount - a.riddenCount);
  const earnedCount = milestones.filter((m) => m.earned).length;

  async function produce(content, chipBundle, kind, filenameBase, mode, id) {
    setBusyId(id);
    try {
      const footer = 'cailinpitt.github.io/cta-bus-bingo';
      const blob = await renderShareCard({
        ...content,
        chips: chipBundle.chips,
        extra: chipBundle.extra,
        kind,
        footer,
      });
      const filename = `${filenameBase}.png`;
      if (mode === 'download') downloadImage(blob, filename);
      else await shareImage(blob, { filename, title: 'CTA Bus Bingo', text: content.title });
    } finally {
      setBusyId(null);
    }
  }

  const shareMilestone = (m, mode) => {
    const isAll = m.id === 'count-all';
    const clamped = isAll ? riddenSorted : riddenSorted.slice(0, m.threshold);
    produce(
      countCardContent(m.threshold, { total, isAll }),
      chipsFrom(clamped),
      isAll ? 'all' : 'count',
      `bus-bingo-${m.threshold}`,
      mode,
      m.id,
    );
  };

  const shareHood = (h, mode) => {
    const area = { name: h.name, routes: h.routes };
    const slug = h.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    produce(
      neighborhoodCardContent(area),
      chipsFrom(h.routes),
      'hood',
      `bus-bingo-${slug}`,
      mode,
      h.id,
    );
  };

  const shownHoods = showAllHoods
    ? [...hoods].sort((a, b) => Number(b.earned) - Number(a.earned) || a.remaining - b.remaining)
    : [...doneHoods, ...nearHoods.slice(0, 6)];

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-gh-muted text-xs uppercase tracking-wide">
          Achievements ({earnedCount}/{milestones.length})
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-gh-muted text-xs hover:text-gh-fg"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {milestones.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col rounded border p-2 ${
                  m.earned
                    ? 'border-emerald-600/50 bg-emerald-900/20 light:bg-emerald-50'
                    : 'border-gh-border bg-gh-canvas'
                }`}
              >
                <div className={`font-semibold ${m.earned ? 'text-gh-fg' : 'text-gh-muted'}`}>
                  {m.label}
                </div>
                {m.earned ? (
                  <ShareButtons
                    id={m.id}
                    busyId={busyId}
                    onAct={(mode) => shareMilestone(m, mode)}
                  />
                ) : (
                  <div className="mt-1 text-gh-muted text-xs">{m.remaining} to go</div>
                )}
              </div>
            ))}
          </div>

          {hoods.length > 0 && (
            <div className="mt-3 border-gh-border border-t pt-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-gh-muted text-xs uppercase tracking-wide">
                  Neighborhoods ({doneHoods.length}/{hoods.length})
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllHoods((v) => !v)}
                  className="text-gh-muted text-xs hover:text-gh-fg"
                >
                  {showAllHoods ? 'Show less' : 'Show all'}
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {shownHoods.map((h) => (
                  <div
                    key={h.id}
                    className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
                      h.earned
                        ? 'border-emerald-600/50 bg-emerald-900/20 light:bg-emerald-50'
                        : 'border-gh-border bg-gh-canvas'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gh-fg">{h.name}</div>
                      <div className="text-gh-muted text-xs">
                        {h.earned ? `all ${h.total} routes` : `${h.riddenCount}/${h.total} routes`}
                      </div>
                    </div>
                    {h.earned ? (
                      <div className="w-28 shrink-0">
                        <ShareButtons
                          id={h.id}
                          busyId={busyId}
                          onAct={(mode) => shareHood(h, mode)}
                        />
                      </div>
                    ) : (
                      <div className="text-gh-muted text-xs">{h.remaining} to go</div>
                    )}
                  </div>
                ))}
                {shownHoods.length === 0 && (
                  <div className="text-gh-muted text-xs">
                    Ride routes to start completing neighborhoods.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
