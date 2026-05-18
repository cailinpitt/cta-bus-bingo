import { useEffect, useMemo, useRef, useState } from 'react';
import Controls from './components/Controls.jsx';
import Itinerary from './components/Itinerary.jsx';
import RiddenList from './components/RiddenList.jsx';
import StartPicker from './components/StartPicker.jsx';
import TripMap from './components/TripMap.jsx';
import TripPicker from './components/TripPicker.jsx';
import { loadDataset } from './lib/data.js';
import { augmentStopsForPlanning, planTrips } from './lib/planner.js';
import { buildStopIndex } from './lib/spatial.js';
import { loadRidden, saveRidden } from './lib/storage.js';

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [ridden, setRiddenState] = useState(() => loadRidden());
  const [cap, setCap] = useState(3);
  const [roundTrip, setRoundTripState] = useState(false);
  const [scheduleMode, setScheduleMode] = useState('now');
  const [result, setResult] = useState(null); // { trips, suggestedStart }
  const [selectedTrip, setSelectedTrip] = useState(0);
  const [busy, setBusy] = useState(false);
  // Which picker is requesting map clicks: 'start' | 'end' | null.
  const [mapClickTarget, setMapClickTarget] = useState(null);
  // Collapse the trip-setup section to give the map and itinerary more room.
  // Auto-collapses when a plan lands and re-opens when the plan is cleared.
  const [setupCollapsed, setSetupCollapsed] = useState(false);

  useEffect(() => {
    setSetupCollapsed(!!result);
  }, [result]);

  const stopIndexRef = useRef(null);

  useEffect(() => {
    loadDataset()
      .then((ds) => {
        stopIndexRef.current = buildStopIndex(ds.stops);
        augmentStopsForPlanning(ds.stops, stopIndexRef.current, ds.routes);
        setDataset(ds);
      })
      .catch((e) => setLoadErr(e.message));
  }, []);

  function setRidden(next) {
    setRiddenState(next);
    saveRidden(next);
  }

  function handlePickStart(p) {
    setStart(p);
    setMapClickTarget(null);
  }

  function handlePickEnd(p) {
    setEnd(p);
    // Mutually exclusive with round-trip.
    setRoundTripState(false);
    setMapClickTarget(null);
  }

  function setRoundTrip(v) {
    setRoundTripState(v);
    // Mutually exclusive: turning round-trip on clears any end destination.
    if (v) setEnd(null);
  }

  function handleMapClick({ lat, lon }) {
    const point = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    if (mapClickTarget === 'end') handlePickEnd(point);
    else handlePickStart(point);
  }

  function handlePlan() {
    if (!dataset || !start) return;
    setBusy(true);
    // Two rAFs guarantee the busy-state paint commits before the planner
    // blocks the main thread. A bare setTimeout(0) can run inside the same
    // frame in React 18 batching and the spinner never appears.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const r = planTrips({
          dataset,
          start: { lat: start.lat, lon: start.lon },
          end: end ? { lat: end.lat, lon: end.lon } : null,
          ridden,
          cap,
          roundTrip,
          scheduleMode,
          now: new Date(),
          stopIndex: stopIndexRef.current,
        });
        setResult(r);
        setSelectedTrip(0);
        setBusy(false);
      });
    });
  }

  const ready = !!dataset && !!stopIndexRef.current;
  const meta = dataset?.meta;
  const gtfsAge = useMemo(() => {
    if (!meta?.gtfsGeneratedAt) return null;
    const days = Math.round((Date.now() - meta.gtfsGeneratedAt) / 86400000);
    return `${days}d old`;
  }, [meta]);

  // The Itinerary component still accepts a single plan; map the selected
  // trip onto that shape and append the dataset's suggestedStart for the
  // empty-state path.
  const currentPlan = useMemo(() => {
    if (!result) return null;
    const trip = result.trips[selectedTrip];
    if (!trip) {
      return {
        legs: [],
        newRouteCount: 0,
        totalSeconds: 0,
        suggestedStart: result.suggestedStart,
      };
    }
    return { ...trip, suggestedStart: result.suggestedStart };
  }, [result, selectedTrip]);

  return (
    <div className="flex h-full flex-col bg-gh-canvas text-white">
      <header className="flex items-baseline justify-between border-gh-border border-b px-4 py-2">
        <h1 className="font-semibold text-lg">CTA Bus Bingo</h1>
        <div className="text-gh-muted text-xs">
          {ready ? `${Object.keys(dataset.routes).length} routes` : 'loading…'}
          {gtfsAge && <> · schedule {gtfsAge}</>}
        </div>
      </header>

      {loadErr && (
        <div className="bg-red-900/50 px-4 py-2 text-sm text-red-200">
          Failed to load data: {loadErr}. Did you run <code>npm run build-index</code>?
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <main className="sticky top-0 z-10 h-[45vh] shrink-0 lg:static lg:order-2 lg:h-auto lg:min-h-0 lg:flex-1">
          <TripMap
            plan={currentPlan}
            routes={dataset?.routes}
            start={start}
            end={end}
            onMapClick={handleMapClick}
            mapClickMode={mapClickTarget !== null}
          />
        </main>
        <aside className="flex w-full shrink-0 flex-col gap-3 p-3 lg:order-1 lg:w-96 lg:overflow-y-auto lg:border-gh-border lg:border-r">
          {ready && (
            <>
              <div className="rounded-lg border border-gh-border bg-gh-surface text-sm">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSetupCollapsed(!setupCollapsed)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  >
                    <span className="text-gh-muted text-xs uppercase tracking-wide">
                      Trip setup
                    </span>
                    {setupCollapsed && (
                      <span className="truncate text-gh-muted/80 text-xs">
                        {start?.label || 'No start'}
                        {end ? ` → ${end.label}` : roundTrip ? ' · round trip' : ''} · ≤{cap} new
                      </span>
                    )}
                  </button>
                  {setupCollapsed ? (
                    <>
                      <button
                        type="button"
                        onClick={handlePlan}
                        disabled={!start || busy}
                        className="shrink-0 rounded bg-emerald-600 px-2 py-0.5 text-white text-xs hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {busy ? '…' : 'Re-plan'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSetupCollapsed(false)}
                        className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-white text-xs hover:bg-gh-border"
                      >
                        Edit
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSetupCollapsed(true)}
                      className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-gh-muted text-xs hover:text-white"
                    >
                      Hide
                    </button>
                  )}
                </div>
                {!setupCollapsed && (
                  <div className="flex flex-col gap-3 border-gh-border border-t p-3">
                    <StartPicker
                      title="Starting point"
                      noun="start"
                      value={start}
                      onPick={handlePickStart}
                      mapClickActive={mapClickTarget === 'start'}
                      setMapClickActive={(on) => setMapClickTarget(on ? 'start' : null)}
                      stops={dataset.stops}
                    />
                    <StartPicker
                      title="Destination (optional)"
                      noun="destination"
                      value={end}
                      onPick={handlePickEnd}
                      onClear={() => setEnd(null)}
                      mapClickActive={mapClickTarget === 'end'}
                      setMapClickActive={(on) => setMapClickTarget(on ? 'end' : null)}
                      stops={dataset.stops}
                    />
                    <Controls
                      cap={cap}
                      setCap={setCap}
                      roundTrip={roundTrip}
                      setRoundTrip={setRoundTrip}
                      roundTripDisabled={!!end}
                      scheduleMode={scheduleMode}
                      setScheduleMode={setScheduleMode}
                      onPlan={handlePlan}
                      busy={busy}
                      canPlan={!!start}
                    />
                  </div>
                )}
              </div>
              {result?.trips?.length > 1 && (
                <TripPicker
                  trips={result.trips}
                  selectedIndex={selectedTrip}
                  onSelect={setSelectedTrip}
                />
              )}
              <Itinerary
                plan={currentPlan}
                routes={dataset.routes}
                onUseSuggestion={(sug) => {
                  setStart({
                    lat: sug.stop.lat,
                    lon: sug.stop.lon,
                    label: sug.stop.stopName,
                    stopId: sug.stop.stopId,
                  });
                  setResult(null);
                }}
              />
              <RiddenList routes={dataset.routes} ridden={ridden} setRidden={setRidden} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
