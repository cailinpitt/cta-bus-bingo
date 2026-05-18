import { useState } from 'react';
import { geocode } from '../lib/geocode.js';

// Compact tabbed picker for setting a trip endpoint (start or end). Calls
// onPick({lat, lon, label}) when the user makes a choice. Map-click is handled
// by the parent via mapClickActive/setMapClickActive — the parent tracks which
// picker is requesting clicks so multiple pickers can coexist.
export default function StartPicker({
  value,
  onPick,
  onClear,
  mapClickActive,
  setMapClickActive,
  stops,
  title = 'Starting point',
  noun = 'start',
}) {
  const [tab, setTab] = useState('geo');
  const [addr, setAddr] = useState('');
  const [stopQ, setStopQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function doGeolocate() {
    setBusy(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onPick({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Current location' });
      },
      (e) => {
        setBusy(false);
        setErr(e.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function doAddress(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await geocode(addr);
      if (!r) setErr('No match found');
      else onPick({ lat: r.lat, lon: r.lon, label: r.display.split(',').slice(0, 2).join(',') });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const stopMatches =
    stopQ.trim().length < 2
      ? []
      : Object.values(stops)
          .filter((s) => s.stopName.toLowerCase().includes(stopQ.toLowerCase()))
          .slice(0, 8);

  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-gh-muted text-xs uppercase tracking-wide">{title}</div>
        <div className="flex min-w-0 items-center gap-2">
          {value && (
            <div className="truncate text-gh-muted/80 text-xs" title={value.label}>
              {value.label || `${value.lat.toFixed(4)}, ${value.lon.toFixed(4)}`}
            </div>
          )}
          {value && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded px-1.5 py-0.5 text-gh-muted text-xs hover:bg-gh-subtle hover:text-white"
              title={`Clear ${noun}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="mb-2 flex gap-1 text-xs">
        {[
          ['geo', 'Use location'],
          ['addr', 'Address'],
          ['map', 'Map click'],
          ['stop', 'Bus stop'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded px-2 py-1 ${
              tab === k ? 'bg-blue-600 text-white' : 'bg-gh-subtle text-gh-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'geo' && (
        <button
          type="button"
          onClick={doGeolocate}
          disabled={busy}
          className="w-full rounded bg-gh-subtle px-3 py-2 text-white hover:bg-gh-border disabled:opacity-50"
        >
          {busy ? 'Locating…' : 'Use my current location'}
        </button>
      )}

      {tab === 'addr' && (
        <form onSubmit={doAddress} className="flex gap-2">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="e.g. Belmont & Clark"
            className="flex-1 rounded border border-gh-border bg-gh-canvas px-2 py-1 text-white placeholder:text-gh-muted/60"
          />
          <button
            type="submit"
            disabled={busy || !addr.trim()}
            className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? '…' : 'Go'}
          </button>
        </form>
      )}

      {tab === 'map' && (
        <button
          type="button"
          onClick={() => setMapClickActive(!mapClickActive)}
          className={`w-full rounded px-3 py-2 text-white ${
            mapClickActive ? 'bg-amber-600 hover:bg-amber-500' : 'bg-gh-subtle hover:bg-gh-border'
          }`}
        >
          {mapClickActive
            ? `Click the map to set ${noun} (cancel)`
            : `Click the map to set ${noun}`}
        </button>
      )}

      {tab === 'stop' && (
        <div>
          <input
            value={stopQ}
            onChange={(e) => setStopQ(e.target.value)}
            placeholder="Search stops by name"
            className="w-full rounded border border-gh-border bg-gh-canvas px-2 py-1 text-white placeholder:text-gh-muted/60"
          />
          {stopMatches.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-gh-border bg-gh-canvas">
              {stopMatches.map((s) => (
                <li key={s.stopId}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({ lat: s.lat, lon: s.lon, label: s.stopName, stopId: s.stopId })
                    }
                    className="w-full px-2 py-1 text-left text-white hover:bg-gh-subtle"
                  >
                    <span>{s.stopName}</span>{' '}
                    <span className="text-gh-muted text-xs">({[...s.routes].join(', ')})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {err && <div className="mt-2 text-red-400 text-xs">{err}</div>}
    </div>
  );
}
