import { useMemo, useState } from 'react';

// Pull the numeric portion of a route id so "X49" sorts next to "49", "N5" next to "5", etc.
function routeNum(rt) {
  const m = rt.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

// Grid of every route, tick to mark ridden. Persisted to localStorage upstream.
export default function RiddenList({ routes, ridden, setRidden }) {
  const [collapsed, setCollapsed] = useState(true);
  const [importError, setImportError] = useState('');
  const sorted = useMemo(() => {
    return Object.entries(routes)
      .filter(([, r]) => !r.isTrain) // bingo is a bus thing; trains are free connectors regardless
      .sort(([a], [b]) => {
        const na = routeNum(a);
        const nb = routeNum(b);
        if (na !== nb) return na - nb;
        return a.localeCompare(b);
      });
  }, [routes]);

  function toggle(rt) {
    const next = new Set(ridden);
    if (next.has(rt)) next.delete(rt);
    else next.add(rt);
    setRidden(next);
  }

  function clearAll() {
    setRidden(new Set());
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify([...ridden].sort(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cta-bus-bingo-ridden.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    file.text().then((txt) => {
      let arr;
      try {
        arr = JSON.parse(txt);
      } catch {
        setImportError(`Couldn't import ${file.name}: not valid JSON.`);
        return;
      }
      if (
        !Array.isArray(arr) ||
        !arr.every((x) => typeof x === 'string' || typeof x === 'number')
      ) {
        setImportError(`Couldn't import ${file.name}: expected a JSON array of route ids.`);
        return;
      }
      setRidden(new Set(arr.map(String)));
    });
    e.target.value = '';
  }

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-gh-muted text-xs uppercase tracking-wide">
          Ridden routes ({ridden.size}/{sorted.length})
        </div>
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
          <div className="mb-2 flex flex-wrap gap-1 text-xs">
            <button
              type="button"
              onClick={clearAll}
              className="rounded bg-gh-subtle px-2 py-1 hover:bg-gh-border"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="rounded bg-gh-subtle px-2 py-1 hover:bg-gh-border"
            >
              Export
            </button>
            <label className="cursor-pointer rounded bg-gh-subtle px-2 py-1 hover:bg-gh-border">
              Import
              <input
                type="file"
                accept="application/json"
                onChange={importJson}
                className="hidden"
              />
            </label>
          </div>

          {importError && (
            <div
              role="alert"
              className="mb-2 rounded border border-red-700 bg-red-950/40 px-2 py-1 text-xs text-red-300"
            >
              {importError}
            </div>
          )}

          <div className="grid max-h-[60vh] grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {sorted.map(([rt, r]) => {
              const on = ridden.has(rt);
              return (
                <button
                  type="button"
                  key={rt}
                  onClick={() => toggle(rt)}
                  title={r.name}
                  className={`flex min-h-[44px] items-center justify-center rounded px-2 py-2 text-sm font-medium ${
                    on ? 'bg-emerald-700 text-white' : 'bg-gh-subtle text-gh-muted hover:text-white'
                  }`}
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
