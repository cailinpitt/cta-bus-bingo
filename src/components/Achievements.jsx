import { useMemo, useState } from 'react';
import { countAchievements, countCardContent } from '../lib/achievements.js';
import { downloadImage, renderShareCard, shareImage } from '../lib/shareCard.js';
import { OVERLAY_PALETTE } from './TripMap.jsx';

function routeNum(rt) {
  const m = rt.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

// A spread of up to 8 ridden routes, colored, for the card's "marked squares".
function sampleChips(ridden, routes) {
  const rs = [...ridden].filter((rt) => routes[rt] && !routes[rt].isTrain);
  rs.sort((a, b) => routeNum(a) - routeNum(b) || a.localeCompare(b));
  const n = Math.min(8, rs.length);
  if (n === 0) return [];
  const step = rs.length / n;
  return Array.from({ length: n }, (_, i) => ({
    label: rs[Math.floor(i * step)],
    color: OVERLAY_PALETTE[i % OVERLAY_PALETTE.length],
  }));
}

// Milestone badges with shareable cards. Earned badges share a generated PNG via
// the native share sheet; locked ones show how many routes remain.
export default function Achievements({ routes, ridden }) {
  const [collapsed, setCollapsed] = useState(true);
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
  const earnedCount = milestones.filter((m) => m.earned).length;

  const chips = useMemo(() => sampleChips(ridden, routes), [ridden, routes]);

  async function makeCard(m, mode) {
    setBusyId(m.id);
    try {
      const content = countCardContent(m.threshold, { total, isAll: m.id === 'count-all' });
      const footer = typeof window !== 'undefined' ? window.location.host : 'CTA Bus Bingo';
      const blob = await renderShareCard({ ...content, chips, footer });
      const filename = `bus-bingo-${m.threshold}.png`;
      if (mode === 'download') downloadImage(blob, filename);
      else await shareImage(blob, { filename, title: 'CTA Bus Bingo', text: content.title });
    } finally {
      setBusyId(null);
    }
  }

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
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => makeCard(m, 'share')}
                    disabled={busyId === m.id}
                    className="flex-1 rounded bg-emerald-700 px-2 py-1 text-white text-xs hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {busyId === m.id ? '…' : 'Share'}
                  </button>
                  <button
                    type="button"
                    onClick={() => makeCard(m, 'download')}
                    disabled={busyId === m.id}
                    className="rounded bg-gh-subtle px-2 py-1 text-gh-fg text-xs hover:bg-gh-border disabled:opacity-50"
                    title="Download image"
                    aria-label="Download image"
                  >
                    ⬇
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-gh-muted text-xs">{m.remaining} to go</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
