import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Achievements from './components/Achievements.jsx';
import Controls from './components/Controls.jsx';
import Itinerary from './components/Itinerary.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import RiddenList from './components/RiddenList.jsx';
import RouteOverlayPanel from './components/RouteOverlayPanel.jsx';
import ScheduleLookup from './components/ScheduleLookup.jsx';
import StartPicker from './components/StartPicker.jsx';
import SyncPanel from './components/SyncPanel.jsx';
import TripMap, { OVERLAY_PALETTE } from './components/TripMap.jsx';
import TripPicker from './components/TripPicker.jsx';
import { useTheme } from './hooks/useTheme.js';
import { loadDataset } from './lib/data.js';
import { augmentStopsForPlanning, planTrips } from './lib/planner.js';
import { rehydratePlan, serializePlan } from './lib/planSnapshot.js';
import { buildStopIndex } from './lib/spatial.js';
import {
  clearSyncKey,
  loadDoc,
  loadLastPlan,
  loadSyncKey,
  STORAGE_KEYS,
  saveDoc,
  saveLastPlan,
  saveSyncKey,
} from './lib/storage.js';
import { createSyncEngine, fetchTransport, generateSyncKey } from './lib/sync.js';
import { applyDelta, docToSet } from './lib/syncDoc.js';
import { readSyncKey, readUrlState, writeUrlState } from './lib/urlState.js';

const initialUrl = readUrlState();
// A sync key carried in a #sync= deep link (a freshly-scanned device). Captured
// at module load, before writeUrlState strips it from the hash.
const initialSyncKey = readSyncKey();

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [dark, toggleTheme] = useTheme();
  const [start, setStart] = useState(initialUrl.start ?? null);
  const [end, setEnd] = useState(initialUrl.end ?? null);
  // The ridden set is backed by a sync doc (LWW-Map) in localStorage so it can
  // converge across devices. The doc is the source of truth; `ridden` is the
  // derived Set the rest of the app consumes.
  const [doc, setDoc] = useState(loadDoc);
  const ridden = useMemo(() => docToSet(doc), [doc]);

  // Keep a ref to the latest doc so the long-lived sync engine (created once)
  // always reads current state instead of closing over a stale doc.
  const docRef = useRef(doc);
  docRef.current = doc;

  // The cross-device sync engine. Built once, only when a worker URL is
  // configured; it stays a no-op until a sync key exists (set via the UI in a
  // later step), so there's no network activity for users who haven't paired.
  const [syncKey, setSyncKey] = useState(() => loadSyncKey());
  const [syncStatus, setSyncStatus] = useState(() => ({
    state: loadSyncKey() ? 'idle' : 'disabled',
  }));

  const syncRef = useRef(null);
  if (syncRef.current === null && import.meta.env.VITE_SYNC_URL) {
    syncRef.current = createSyncEngine({
      baseUrl: import.meta.env.VITE_SYNC_URL,
      getKey: () => loadSyncKey(),
      getLocalDoc: () => docRef.current,
      onMergedDoc: (merged) => {
        setDoc(merged);
        saveDoc(merged);
      },
      onStatus: setSyncStatus,
      transport: fetchTransport,
    });
  }

  // Start the engine on mount. If we arrived via a #sync= deep link, persist
  // that key first so start() picks it up and merges this device into the group.
  useEffect(() => {
    const engine = syncRef.current;
    if (!engine) return;
    if (initialSyncKey) {
      saveSyncKey(initialSyncKey);
      setSyncKey(initialSyncKey);
    }
    engine.start();
    return () => engine.stop();
  }, []);

  // Pairing link the QR encodes: the current page URL with the key in the hash,
  // so scanning opens this same deployment already configured.
  const syncDeepLink = useMemo(() => {
    if (!syncKey || typeof window === 'undefined') return null;
    return `${window.location.origin}${window.location.pathname}#sync=${syncKey}`;
  }, [syncKey]);

  function enableSync() {
    const key = loadSyncKey() ?? generateSyncKey();
    saveSyncKey(key);
    setSyncKey(key);
    syncRef.current?.start();
  }

  // Join an existing sync group by entering its code — the path for contexts that
  // can't receive the #sync= deep link, notably an iOS home-screen PWA (its
  // storage is sandboxed from Safari). Local marks merge into the group.
  function joinSync(code) {
    saveSyncKey(code);
    setSyncKey(code);
    syncRef.current?.start();
  }

  // Rotate to a fresh key (e.g. the old one leaked). start() pushes the local
  // doc into the new key's slot, so your routes carry over; other devices must
  // re-pair with the new code. The old key's KV doc is simply abandoned.
  function rotateSync() {
    const key = generateSyncKey();
    saveSyncKey(key);
    setSyncKey(key);
    syncRef.current?.start();
  }

  // Reflect edits made in another tab of the same browser: localStorage is
  // shared, but each tab's React state isn't, so mirror doc/key changes here.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === null || e.key === STORAGE_KEYS.doc) setDoc(loadDoc());
      if (e.key === null || e.key === STORAGE_KEYS.syncKey) setSyncKey(loadSyncKey());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function disconnectSync() {
    clearSyncKey();
    setSyncKey(null);
    syncRef.current?.stop();
    setSyncStatus({ state: 'disabled' });
  }
  const [cap, setCap] = useState(initialUrl.cap ?? 3);
  const [roundTrip, setRoundTripState] = useState(initialUrl.roundTrip ?? false);
  const [scheduleMode, setScheduleMode] = useState(initialUrl.scheduleMode ?? 'now');
  const [scheduleAt, setScheduleAt] = useState(initialUrl.scheduleAt ?? null);
  const [result, setResult] = useState(null); // { trips, suggestedStart }
  const [selectedTrip, setSelectedTrip] = useState(0);
  const [busy, setBusy] = useState(false);
  // Which picker is requesting map clicks: 'start' | 'end' | null.
  const [mapClickTarget, setMapClickTarget] = useState(null);
  // Collapse the trip-setup section to give the map and itinerary more room.
  // Auto-collapses when a plan lands and re-opens when the plan is cleared.
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [heatmapOn, setHeatmapOn] = useState(false);
  // Collapse the map on mobile so the route list / itinerary can use the full
  // screen. Desktop keeps the side-by-side map regardless.
  const [mapCollapsed, setMapCollapsed] = useState(false);
  // Routes drawn on the map for visual comparison (spotting intersections),
  // independent of any planned trip. Each route keeps the color it was given on
  // first selection (held in overlayColors) until it's deselected, so adding or
  // removing routes never reshuffles the colors of ones already on the map.
  const [overlayRoutes, setOverlayRoutes] = useState(() => new Set());
  const [overlayColors, setOverlayColors] = useState(() => new Map());

  function setOverlay(next) {
    setOverlayRoutes(next);
    setOverlayColors((prev) => {
      const m = new Map(prev);
      for (const rt of [...m.keys()]) if (!next.has(rt)) m.delete(rt); // free deselected
      const used = new Set(m.values());
      for (const rt of next) {
        if (m.has(rt)) continue; // keep an existing route's color
        const color =
          OVERLAY_PALETTE.find((c) => !used.has(c)) ??
          OVERLAY_PALETTE[m.size % OVERLAY_PALETTE.length];
        m.set(rt, color);
        used.add(color);
      }
      return m;
    });
    // Comparing routes and viewing a trip are mutually exclusive — entering
    // compare mode clears the trip (and vice versa, in planFromStart).
    if (next.size > 0 && (result || start)) clearTrip();
  }

  useEffect(() => {
    setSetupCollapsed(!!result);
  }, [result]);

  // Persist planning context to the URL hash so refreshes restore state and
  // the URL is shareable. Ridden set stays in localStorage — private.
  useEffect(() => {
    writeUrlState({ start, end, cap, roundTrip, scheduleMode, scheduleAt });
  }, [start, end, cap, roundTrip, scheduleMode, scheduleAt]);

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

  // On cold load, once the dataset is ready, decide what to show:
  //   1. Restore the last plan EXACTLY if one was saved recently and it isn't
  //      contradicted by the URL (the reload / PWA-relaunch case — this is what
  //      keeps you from losing your trip mid-ride). A relaunch also loses the
  //      URL hash, so restore the trip-setup inputs too.
  //   2. Otherwise, if the URL hash specified a start (a shared link), auto-plan
  //      against the recipient's own ridden set.
  const autoPlannedRef = useRef(false);
  const sameStart = (a, b) =>
    a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires exactly once when the dataset becomes available; autoPlannedRef guards against re-runs even though it closes over more state
  useEffect(() => {
    if (autoPlannedRef.current || !dataset) return;

    const saved = loadLastPlan();
    // A shared link with a *different* start than the snapshot should win.
    const urlContradicts = initialUrl.start && !sameStart(saved?.inputs?.start, initialUrl.start);
    if (saved && !urlContradicts) {
      const rehydrated = rehydratePlan(saved, dataset);
      if (rehydrated && (rehydrated.trips.length > 0 || rehydrated.suggestedStart)) {
        autoPlannedRef.current = true;
        // Restore setup inputs (covers a relaunch where the URL hash was lost).
        const inp = saved.inputs || {};
        if (inp.start) setStart(inp.start);
        setEnd(inp.end ?? null);
        if (inp.cap != null) setCap(inp.cap);
        setRoundTripState(!!inp.roundTrip);
        if (inp.scheduleMode) setScheduleMode(inp.scheduleMode);
        setScheduleAt(inp.scheduleAt ?? null);
        setResult(rehydrated);
        setSelectedTrip(
          Math.min(saved.selectedTrip || 0, Math.max(0, rehydrated.trips.length - 1)),
        );
        return;
      }
    }

    if (initialUrl.start) {
      autoPlannedRef.current = true;
      handlePlan();
    }
  }, [dataset]);

  // Persist the current plan so a reload / PWA relaunch can restore it.
  useEffect(() => {
    if (!result) return;
    saveLastPlan(
      serializePlan({
        result,
        selectedTrip,
        inputs: { start, end, cap, roundTrip, scheduleMode, scheduleAt },
      }),
    );
  }, [result, selectedTrip, start, end, cap, roundTrip, scheduleMode, scheduleAt]);

  // Translate a full next-Set from the UI into timestamped LWW-Map updates:
  // routes newly present become { r:1 }, routes dropped become { r:0 } tombstones
  // so removals propagate across devices instead of getting resurrected on merge.
  function setRidden(next) {
    const added = [...next].filter((rt) => !ridden.has(rt));
    const removed = [...ridden].filter((rt) => !next.has(rt));
    if (added.length === 0 && removed.length === 0) return;
    const nextDoc = applyDelta(doc, added, removed, Date.now());
    setDoc(nextDoc);
    saveDoc(nextDoc);
    syncRef.current?.scheduleSync();
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

  async function handleShare() {
    const url = window.location.href;
    try {
      // Prefer the native share sheet on mobile so the user can send to
      // Messages/Mail/etc. directly. Falls back to clipboard.
      if (navigator.share && /Mobi|Android/.test(navigator.userAgent)) {
        await navigator.share({ title: 'CTA Bus Bingo', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // User cancelled the share sheet, or clipboard blocked — no-op.
    }
  }

  // Stable across renders so TripMap doesn't rebind its map click listener
  // on every parent re-render (it would otherwise churn through register/
  // unregister cycles whenever any unrelated App state changes).
  const handleMapClick = useCallback(
    ({ lat, lon }) => {
      const point = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
      // Inline the pick handlers' core state updates so this callback's deps
      // stay limited to mapClickTarget — handlePickStart/End are recreated
      // every render and would re-trigger the map's click-listener rebind.
      if (mapClickTarget === 'end') {
        setEnd(point);
        setRoundTripState(false);
      } else {
        setStart(point);
      }
      setMapClickTarget(null);
    },
    [mapClickTarget],
  );

  // Plan with an explicit start so callers like "Surprise me" can plan
  // against a freshly chosen point without waiting for setState to flush.
  // `randomTrip` selects a random candidate instead of the top-ranked one — the
  // "surprise" in Surprise me.
  function planFromStart(startPt, { randomTrip = false } = {}) {
    if (!dataset || !startPt) return;
    setBusy(true);
    // Starting a trip exits compare-routes mode (mutually exclusive views).
    setOverlayRoutes(new Set());
    setOverlayColors(new Map());
    // Two rAFs guarantee the busy-state paint commits before the planner
    // blocks the main thread. A bare setTimeout(0) can run inside the same
    // frame in React 18 batching and the spinner never appears.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 'later' = an explicit future timestamp; under the hood the planner
        // still uses the runsAtHour ('now') schedule check, just against that
        // future moment instead of wall-clock now.
        const futureDate = scheduleMode === 'later' && scheduleAt ? new Date(scheduleAt) : null;
        const effectiveNow =
          futureDate && !Number.isNaN(futureDate.getTime()) ? futureDate : new Date();
        const effectiveMode = scheduleMode === 'later' ? 'now' : scheduleMode;
        const r = planTrips({
          dataset,
          start: { lat: startPt.lat, lon: startPt.lon },
          end: end ? { lat: end.lat, lon: end.lon } : null,
          ridden,
          cap,
          roundTrip,
          scheduleMode: effectiveMode,
          now: effectiveNow,
          stopIndex: stopIndexRef.current,
        });
        setResult(r);
        setSelectedTrip(
          randomTrip && r.trips.length > 0 ? Math.floor(Math.random() * r.trips.length) : 0,
        );
        setBusy(false);
      });
    });
  }

  function handlePlan() {
    if (!start) return;
    planFromStart(start);
  }

  // "Surprise me": plan a random trip from the user's chosen start (an
  // open-ended wander, so any destination/round-trip is cleared). Anchoring to
  // the specified start means the map's start→first-stop line shows how far the
  // surprise route's first boarding is from where you are. Requires a start —
  // the button is disabled until one is set.
  function handleSurprise() {
    if (!dataset || !start) return;
    setEnd(null);
    setRoundTripState(false);
    planFromStart(start, { randomTrip: true });
  }

  // Clear the current trip back to a clean slate: drop the itinerary and the
  // start/destination, and forget the saved snapshot so a reload doesn't bring
  // it back. (Clearing the result re-opens the trip-setup panel automatically.)
  function clearTrip() {
    setResult(null);
    setSelectedTrip(0);
    setStart(null);
    setEnd(null);
    setRoundTripState(false);
    saveLastPlan(null);
  }

  const ready = !!dataset && !!stopIndexRef.current;
  const meta = dataset?.meta;
  const gtfsAge = useMemo(() => {
    if (!meta?.gtfsGeneratedAt) return null;
    const mins = Math.floor((Date.now() - meta.gtfsGeneratedAt) / 60000);
    if (mins < 60) return `${mins}m old`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h old`;
    return `${Math.floor(hours / 24)}d old`;
  }, [meta]);

  // The Itinerary component still accepts a single plan; map the selected
  // trip onto that shape and append the dataset's suggestedStart for the
  // empty-state path.
  // Coverage heatmap: bin stops into ~0.01° cells; per cell, compute the
  // fraction of in-cell bus routes the user hasn't ridden yet. Cells where
  // everything's ridden don't get a feature (transparent).
  const heatmap = useMemo(() => {
    if (!heatmapOn || !dataset) return null;
    const CELL = 100;
    const cells = new Map();
    for (const s of Object.values(dataset.stops)) {
      const key = `${Math.floor(s.lat * CELL)},${Math.floor(s.lon * CELL)}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { la: Math.floor(s.lat * CELL), lo: Math.floor(s.lon * CELL), routes: new Set() };
        cells.set(key, cell);
      }
      for (const rt of s.routes) {
        const r = dataset.routes[rt];
        if (r && !r.isTrain) cell.routes.add(rt);
      }
    }
    const features = [];
    for (const cell of cells.values()) {
      let total = 0;
      let unridden = 0;
      for (const rt of cell.routes) {
        total++;
        if (!ridden.has(rt)) unridden++;
      }
      if (total === 0 || unridden === 0) continue;
      const frac = unridden / total;
      const latLo = cell.la / CELL;
      const latHi = (cell.la + 1) / CELL;
      const lonLo = cell.lo / CELL;
      const lonHi = (cell.lo + 1) / CELL;
      features.push({
        type: 'Feature',
        properties: { frac },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lonLo, latLo],
              [lonHi, latLo],
              [lonHi, latHi],
              [lonLo, latHi],
              [lonLo, latLo],
            ],
          ],
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [heatmapOn, dataset, ridden]);

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

  // Full route shapes for the selected overlay routes, as map-ready GeoJSON.
  const overlay = useMemo(() => {
    if (!dataset || overlayRoutes.size === 0) return null;
    const features = [];
    for (const rt of overlayRoutes) {
      const route = dataset.routes[rt];
      if (!route) continue;
      const color = overlayColors.get(rt);
      for (const pid of route.patternIds) {
        const p = dataset.patterns[pid];
        if (!p) continue;
        const coordinates = p.points.map((pt) => [pt.lon, pt.lat]);
        if (coordinates.length < 2) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { color, label: rt },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [dataset, overlayRoutes, overlayColors]);

  return (
    <div className="flex h-full flex-col bg-gh-canvas text-gh-fg">
      <header className="flex items-center justify-between border-gh-border border-b px-4 py-2">
        <h1 className="font-semibold text-lg">CTA Bus Bingo</h1>
        <div className="flex items-center gap-3">
          <div className="text-gh-muted text-xs">
            {ready ? `${Object.keys(dataset.routes).length} routes` : 'loading…'}
            {gtfsAge && <> · schedule {gtfsAge}</>}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded bg-gh-subtle px-2 py-1 text-gh-fg text-xs hover:bg-gh-border"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle light/dark mode"
          >
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button
            type="button"
            onClick={handleSurprise}
            disabled={!ready || !start || busy}
            className="rounded bg-violet-700 px-2 py-1 text-white text-xs hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              start ? 'Plan a random trip from your starting point' : 'Pick a starting point first'
            }
          >
            Surprise me
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={!start}
            className="rounded bg-gh-subtle px-2 py-1 text-gh-fg text-xs hover:bg-gh-border disabled:cursor-not-allowed disabled:opacity-40"
            title={start ? 'Copy a link that restores this trip' : 'Pick a starting point first'}
          >
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </header>

      {loadErr && (
        <div className="bg-red-900/50 light:border light:border-red-300 light:bg-red-100 px-4 py-2 text-sm text-red-200 light:text-red-800">
          Failed to load data: {loadErr}. Did you run <code>npm run build-index</code>?
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <main
          className={`shrink-0 lg:static lg:order-2 lg:h-auto lg:min-h-0 lg:flex-1 ${
            mapCollapsed ? 'sticky top-0 z-20' : 'sticky top-0 z-10 h-[45vh]'
          }`}
        >
          {/* Mobile: a sticky bar to bring the map back when it's collapsed. */}
          {mapCollapsed && (
            <button
              type="button"
              onClick={() => setMapCollapsed(false)}
              className="flex w-full items-center justify-center gap-1 border-gh-border border-b bg-gh-surface px-3 py-2 text-gh-muted text-xs hover:text-gh-fg lg:hidden"
            >
              Show map ▾
            </button>
          )}
          <div
            className={`relative h-full w-full ${mapCollapsed ? 'hidden lg:block lg:h-full' : ''}`}
          >
            <TripMap
              plan={currentPlan}
              routes={dataset?.routes}
              start={start}
              end={end}
              onMapClick={handleMapClick}
              mapClickMode={mapClickTarget !== null}
              heatmap={heatmap}
              overlay={overlay}
              dark={dark}
            />
            {/* Mobile-only: collapse the map to free the screen for the list. */}
            <button
              type="button"
              onClick={() => setMapCollapsed(true)}
              className="absolute top-2 left-2 z-30 rounded-full bg-gh-surface/90 px-2.5 py-1 text-gh-fg text-xs shadow-lg hover:bg-gh-border lg:hidden"
            >
              Hide map ▴
            </button>
            {mapClickTarget && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-2">
                <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-600/95 px-3 py-1.5 text-white text-xs shadow-lg">
                  <span>
                    Tap the map to set {mapClickTarget === 'end' ? 'destination' : 'starting point'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMapClickTarget(null)}
                    className="rounded-full bg-amber-800/70 px-2 py-0.5 text-[11px] hover:bg-amber-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
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
                  {(result || start) && (
                    <button
                      type="button"
                      onClick={clearTrip}
                      className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-gh-muted text-xs hover:text-red-300 light:hover:text-red-600"
                      title="Clear the current trip and start over"
                    >
                      Clear
                    </button>
                  )}
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
                        className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-gh-fg text-xs hover:bg-gh-border"
                      >
                        Edit
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSetupCollapsed(true)}
                      className="shrink-0 rounded bg-gh-subtle px-2 py-0.5 text-gh-muted text-xs hover:text-gh-fg"
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
                      scheduleAt={scheduleAt}
                      setScheduleAt={setScheduleAt}
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
                ridden={ridden}
                onMarkRidden={setRidden}
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
              <ProgressPanel
                routes={dataset.routes}
                ridden={ridden}
                heatmapOn={heatmapOn}
                setHeatmapOn={setHeatmapOn}
              />
              <Achievements routes={dataset.routes} ridden={ridden} />
              <ScheduleLookup routes={dataset.routes} />
              <RouteOverlayPanel
                routes={dataset.routes}
                selected={overlayRoutes}
                setSelected={setOverlay}
                colors={overlayColors}
              />
              {import.meta.env.VITE_SYNC_URL && (
                <SyncPanel
                  enabled={!!syncKey}
                  status={syncStatus}
                  deepLink={syncDeepLink}
                  syncKey={syncKey}
                  onEnable={enableSync}
                  onJoin={joinSync}
                  onRotate={rotateSync}
                  onDisconnect={disconnectSync}
                />
              )}
              <RiddenList routes={dataset.routes} ridden={ridden} setRidden={setRidden} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
