import { useMemo, useState } from 'react';

// Grid of every route, tick to mark ridden. Persisted to localStorage upstream.
export default function RiddenList({ routes, ridden, setRidden }) {
  const [collapsed, setCollapsed] = useState(true);
  const sorted = useMemo(() => {
    return Object.entries(routes)
      .filter(([, r]) => !r.isTrain) // bingo is a bus thing; trains are free connectors regardless
      .sort(([a], [b]) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (na !== nb) return (Number.isNaN(na) ? 9999 : na) - (Number.isNaN(nb) ? 9999 : nb);
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
    file.text().then((txt) => {
      try {
        const arr = JSON.parse(txt);
        if (Array.isArray(arr)) setRidden(new Set(arr.map(String)));
      } catch {
        alert('Bad JSON');
      }
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

          <div className="grid max-h-[50vh] grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6">
            {sorted.map(([rt, r]) => {
              const on = ridden.has(rt);
              return (
                <button
                  type="button"
                  key={rt}
                  onClick={() => toggle(rt)}
                  title={r.name}
                  className={`rounded px-1.5 py-1 text-xs ${
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
