import { useMemo, useState } from 'react';
import { dayTypeKey, frequencyForDay, isCtaHoliday } from '../lib/schedule.js';

// Pull the numeric portion of a route id so "X49" sorts next to "49".
function routeNum(rt) {
  const m = rt.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

function fmtHour(h) {
  const period = h < 12 ? 'a' : 'p';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}

const DAY_TYPE_LABEL = { weekday: 'weekday', saturday: 'Saturday', sunday: 'Sunday' };

// Look up a bus route's scheduled service frequency for today. The baked data is
// hourly headways (not a per-trip timetable), so this shows "every N min" by hour
// plus the span — enough to know when and how often a route runs.
export default function ScheduleLookup({ routes }) {
  const [collapsed, setCollapsed] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  // Today's date, fixed for this mount. Frequency depends only on the day type.
  const now = useMemo(() => new Date(), []);
  const dayType = dayTypeKey(now);
  const holiday = isCtaHoliday(now);

  const busRoutes = useMemo(
    () =>
      Object.entries(routes)
        .filter(([, r]) => !r.isTrain)
        .sort(([a], [b]) => routeNum(a) - routeNum(b) || a.localeCompare(b)),
    [routes],
  );

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return busRoutes;
    return busRoutes.filter(
      ([rt, r]) => rt.toLowerCase().includes(term) || r.name.toLowerCase().includes(term),
    );
  }, [q, busRoutes]);

  const freq = useMemo(
    () => (selected ? frequencyForDay(routes[selected]?.gtfs, now) : null),
    [selected, routes, now],
  );

  const summary = useMemo(() => {
    if (!freq || freq.length === 0) return null;
    const headways = freq.map((f) => f.headwayMin);
    return {
      first: freq[0].hour,
      last: freq[freq.length - 1].hour,
      minHw: Math.round(Math.min(...headways)),
      maxHw: Math.round(Math.max(...headways)),
    };
  }, [freq]);

  const todayLabel = holiday ? 'holiday (Sunday schedule)' : DAY_TYPE_LABEL[dayType];

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-gh-muted text-xs uppercase tracking-wide">Bus schedule</div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-gh-muted text-xs hover:text-white"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a bus (e.g. 22 or Clark)"
            className="w-full rounded border border-gh-border bg-gh-canvas px-2 py-1 text-white placeholder:text-gh-muted/60"
          />

          {!selected && (
            <div className="mt-2 grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
              {matches.map(([rt, r]) => (
                <button
                  type="button"
                  key={rt}
                  onClick={() => setSelected(rt)}
                  title={r.name}
                  className="flex min-h-[40px] items-center justify-center rounded bg-gh-subtle px-2 py-1.5 font-medium text-gh-muted text-sm hover:text-white"
                >
                  {rt}
                </button>
              ))}
              {matches.length === 0 && (
                <div className="col-span-full text-gh-muted text-xs">No matching routes.</div>
              )}
            </div>
          )}

          {selected && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-white">{selected}</span>{' '}
                  <span className="text-gh-muted text-xs">{routes[selected]?.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-gh-muted text-xs hover:text-white"
                >
                  Back
                </button>
              </div>

              {!freq || freq.length === 0 ? (
                <div className="rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-amber-200 text-xs">
                  Not running today ({todayLabel}).
                </div>
              ) : (
                <>
                  <div className="mb-2 text-gh-muted text-xs">
                    Today ({todayLabel}): runs {fmtHour(summary.first)}–{fmtHour(summary.last)} ·
                    every{' '}
                    {summary.minHw === summary.maxHw
                      ? `${summary.minHw}`
                      : `${summary.minHw}–${summary.maxHw}`}{' '}
                    min
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {freq.map((f) => (
                      <div
                        key={f.hour}
                        title={f.durationMin ? `~${Math.round(f.durationMin)} min end-to-end` : ''}
                        className="rounded bg-gh-canvas px-2 py-1 text-center"
                      >
                        <div className="font-medium text-white/80 text-xs">{fmtHour(f.hour)}</div>
                        <div className="text-[11px] text-gh-muted leading-tight">
                          every {Math.round(f.headwayMin)} min
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-gh-muted/70">
                    Scheduled frequency (minutes between buses), not exact departure times.
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
