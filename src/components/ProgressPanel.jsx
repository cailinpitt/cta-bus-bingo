import { useMemo } from 'react';

// Bingo progress at a glance: % of bus routes ridden, milestone, recent ticks,
// and a toggle for the map's coverage-heatmap layer. Bus-only — trains are
// free connectors and don't count toward bingo.
const MILESTONES = [10, 25, 50, 75, 100, 130];

function nextMilestone(count) {
  for (const m of MILESTONES) if (m > count) return m;
  return null;
}

export default function ProgressPanel({ routes, ridden, heatmapOn, setHeatmapOn }) {
  const stats = useMemo(() => {
    let busTotal = 0;
    let busRidden = 0;
    for (const [rt, r] of Object.entries(routes)) {
      if (r.isTrain) continue;
      busTotal++;
      if (ridden.has(rt)) busRidden++;
    }
    return {
      total: busTotal,
      ridden: busRidden,
      pct: busTotal === 0 ? 0 : Math.round((busRidden / busTotal) * 100),
      next: nextMilestone(busRidden),
    };
  }, [routes, ridden]);

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-gh-muted text-xs uppercase tracking-wide">Progress</span>
        <span className="font-medium text-gh-fg">
          {stats.ridden}/{stats.total} · {stats.pct}%
        </span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-gh-canvas">
        <div className="h-full bg-emerald-500" style={{ width: `${stats.pct}%` }} aria-hidden />
      </div>
      {stats.next != null && (
        <div className="mb-2 text-gh-muted text-xs">
          {stats.next - stats.ridden} more to hit {stats.next}.
        </div>
      )}
      {stats.next == null && (
        <div className="mb-2 text-emerald-300 light:text-emerald-700 text-xs">
          You've ridden every bus route. Nice.
        </div>
      )}
      <button
        type="button"
        onClick={() => setHeatmapOn(!heatmapOn)}
        className={`w-full rounded px-2 py-1 text-xs ${
          heatmapOn
            ? 'bg-violet-700 text-white hover:bg-violet-600'
            : 'bg-gh-subtle text-gh-muted hover:text-gh-fg'
        }`}
      >
        {heatmapOn ? 'Hide coverage heatmap' : 'Show coverage heatmap'}
      </button>
    </div>
  );
}
