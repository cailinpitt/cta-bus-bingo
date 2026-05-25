import { useMemo, useState } from 'react';

function routeNum(rt) {
  const m = rt.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

// Pick multiple bus routes to draw on the map (full shapes) so you can see where
// they cross. Selection drives the map overlay; each selected route is tinted
// with the same color the map uses for its line.
export default function RouteOverlayPanel({ routes, selected, setSelected, colors }) {
  const [collapsed, setCollapsed] = useState(true);

  const sorted = useMemo(
    () =>
      Object.entries(routes)
        .filter(([, r]) => !r.isTrain)
        .sort(([a], [b]) => routeNum(a) - routeNum(b) || a.localeCompare(b)),
    [routes],
  );

  function toggle(rt) {
    const next = new Set(selected);
    if (next.has(rt)) next.delete(rt);
    else next.add(rt);
    setSelected(next);
  }

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-gh-muted text-xs uppercase tracking-wide">
          Compare routes ({selected.size})
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-gh-muted text-xs hover:text-white"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-gh-muted text-xs hover:text-white"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mb-2 text-gh-muted text-xs">
            Tap routes to draw them on the map and spot where they cross.
          </div>
          <div className="grid max-h-[50vh] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {sorted.map(([rt, r]) => {
              const on = selected.has(rt);
              const color = colors.get(rt);
              return (
                <button
                  type="button"
                  key={rt}
                  onClick={() => toggle(rt)}
                  title={r.name}
                  className={`flex min-h-[44px] items-center justify-center rounded px-2 py-2 font-medium text-sm ${
                    on ? 'text-white' : 'bg-gh-subtle text-gh-muted hover:text-white'
                  }`}
                  style={on ? { backgroundColor: color } : undefined}
                >
                  {rt}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
