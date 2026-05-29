// MapLibre map with OSM raster tiles. Renders:
//   - the chosen start as a yellow dot
//   - each leg's pattern segment (board -> alight along pdist) in a unique color
//   - board/alight stop markers
//   - dashed walk lines between legs

import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';

export const LEG_COLORS = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#f97316', // orange-500
  '#a78bfa', // violet-400
  '#f472b6', // pink-400
  '#facc15', // yellow-400
];

// Distinct colors for the "compare routes" overlay (full route shapes drawn to
// spot intersections). Kept separate from LEG_COLORS so an overlay and a planned
// trip don't read as the same thing.
export const OVERLAY_PALETTE = [
  '#60a5fa',
  '#f87171',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f472b6',
  '#a3e635',
  '#e879f9',
];

// Train legs use the official CTA line color; bus legs cycle through LEG_COLORS.
// `i` is the leg index used to deterministically pick a bus color.
export function colorForLeg(leg, i, routes) {
  const route = routes?.[leg.rt];
  if (route?.isTrain && route.color) return route.color;
  return LEG_COLORS[i % LEG_COLORS.length];
}

// CARTO basemaps: "dark matter" for dark mode, "positron" (light_all) for light
// — both low-contrast so colored leg polylines and stop dots stay legible.
const basemapTiles = (dark) => {
  const set = dark ? 'dark_all' : 'light_all';
  return ['a', 'b', 'c', 'd'].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${set}/{z}/{x}/{y}.png`,
  );
};

const makeStyle = (dark) => ({
  version: 8,
  // Required for symbol layers with text-field — using MapLibre's public
  // demotiles glyph server (free, no key). Without this, route-id labels on
  // leg polylines render as blank.
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    basemap: {
      type: 'raster',
      tiles: basemapTiles(dark),
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
});

function legGeoJSON(plan, routes) {
  const features = [];
  for (let i = 0; i < plan.legs.length; i++) {
    const l = plan.legs[i];
    // CTA pattern waypoints (type 'W') have pdist=0 even though their seq is
    // ordered; slice by seq so the polyline follows the actual street/track.
    const pts = l.pattern.points
      .filter((p) => p.seq >= l.boardStop.seq && p.seq <= l.alightStop.seq)
      .map((p) => [p.lon, p.lat]);
    if (pts.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pts },
      properties: {
        color: colorForLeg(l, i, routes),
        rt: l.rt,
        // Display label for the symbol layer: route id for buses, but the
        // full route name for trains (e.g. "Red Line" instead of "train-red"
        // since train ids are internal synthetic keys).
        label: routes?.[l.rt]?.isTrain ? routes[l.rt].name : l.rt,
        idx: i,
        free: l.free ? 1 : 0,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function walkGeoJSON(plan, end) {
  const features = [];
  // Start -> first board
  if (plan.legs[0]) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [plan.start.lon, plan.start.lat],
          [plan.legs[0].boardStop.lon, plan.legs[0].boardStop.lat],
        ],
      },
    });
  }
  // Between legs: alight[i] -> board[i+1]
  for (let i = 0; i < plan.legs.length - 1; i++) {
    const a = plan.legs[i].alightStop;
    const b = plan.legs[i + 1].boardStop;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    });
  }
  // Last alight -> destination. Mirrors the start->first-board walk so the
  // final leg of the journey (off the bus, on foot to the goal) is visible.
  const lastLeg = plan.legs[plan.legs.length - 1];
  if (end && lastLeg) {
    const a = lastLeg.alightStop;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [end.lon, end.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function stopGeoJSON(plan, routes) {
  const features = [];
  for (let i = 0; i < plan.legs.length; i++) {
    const l = plan.legs[i];
    const color = colorForLeg(l, i, routes);
    const prefix = l.free ? 'Connector' : l.rt;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.boardStop.lon, l.boardStop.lat] },
      properties: { color, label: `Board ${prefix}: ${l.boardStop.stopName}` },
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.alightStop.lon, l.alightStop.lat] },
      properties: { color, label: `Off ${prefix}: ${l.alightStop.stopName}` },
    });
  }
  return { type: 'FeatureCollection', features };
}

function startGeoJSON(start) {
  if (!start) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [start.lon, start.lat] },
      },
    ],
  };
}

// Reuse the single-point shape for the live "you are here" dot.
const pointGeoJSON = (p) =>
  p
    ? {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }],
      }
    : { type: 'FeatureCollection', features: [] };

export default function TripMap({
  plan,
  routes,
  start,
  end,
  onMapClick,
  mapClickMode,
  heatmap,
  overlay,
  dark = true,
  focusLegIdx = null,
  me = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // Latest theme, read by the once-created map's init without re-running it.
  const darkRef = useRef(dark);
  darkRef.current = dark;

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(darkRef.current),
      center: [-87.6298, 41.8781],
      zoom: 11,
      // Force the attribution into the collapsed "i" button. MapLibre's auto
      // mode expands it when the container is wide enough, which on our
      // sticky-mobile map covers the route start/end markers.
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('heatmap', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Coverage heatmap goes under everything else so leg polylines stay on top.
      map.addLayer({
        id: 'heatmap-fill',
        type: 'fill',
        source: 'heatmap',
        paint: {
          // Violet, opacity scaled by fraction-unridden. fraction 1.0 -> 0.5 alpha;
          // fraction 0.0 cells aren't emitted at all.
          'fill-color': '#a855f7',
          'fill-opacity': ['*', ['get', 'frac'], 0.5],
          'fill-outline-color': 'rgba(0,0,0,0)',
        },
      });
      // Compare-routes overlay: full route shapes, drawn under the planned trip
      // (added before the leg layers) so a trip on top still stands out.
      map.addSource('overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'overlay-line',
        type: 'line',
        source: 'overlay',
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      map.addLayer({
        id: 'overlay-label',
        type: 'symbol',
        source: 'overlay',
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'symbol-spacing': 300,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0d1117',
          'text-halo-width': 2,
        },
      });
      map.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('walks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('stops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('startpt', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('endpt', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Live device location ("you are here") — only populated in ride mode.
      map.addSource('me', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Two leg layers: solid for unridden (bingo-counting) legs, slim dashed
      // for free connectors (trains / already-ridden buses) so they read as
      // "you're using this to get there" vs "this is the actual bingo ride".
      map.addLayer({
        id: 'legs-line',
        type: 'line',
        source: 'legs',
        filter: ['==', ['get', 'free'], 0],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
          'line-opacity': 0.95,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      map.addLayer({
        id: 'legs-free-line',
        type: 'line',
        source: 'legs',
        filter: ['==', ['get', 'free'], 1],
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.85,
          'line-dasharray': [3, 2],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      // Route-id labels along each leg polyline. symbol-placement:line draws
      // text following the line and skips labels that don't fit.
      map.addLayer({
        id: 'legs-label',
        type: 'symbol',
        source: 'legs',
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
          'text-anchor': 'center',
          'symbol-spacing': 250,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0d1117',
          'text-halo-width': 2.5,
        },
      });
      map.addLayer({
        id: 'walks-line',
        type: 'line',
        source: 'walks',
        paint: {
          'line-color': '#9ca3af',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: 'stops-dot',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#0d1117',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'start-dot',
        type: 'circle',
        source: 'startpt',
        paint: {
          'circle-radius': 8,
          'circle-color': '#facc15',
          'circle-stroke-color': '#0d1117',
          'circle-stroke-width': 2,
        },
      });
      // Destination: two stacked circles render as a target/bullseye so it
      // reads as "the goal" instead of just another stop dot.
      map.addLayer({
        id: 'end-halo',
        type: 'circle',
        source: 'endpt',
        paint: {
          'circle-radius': 14,
          'circle-color': '#ef4444',
          'circle-opacity': 0.25,
          'circle-stroke-color': '#ef4444',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'end-dot',
        type: 'circle',
        source: 'endpt',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ef4444',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
      // Live location: a soft blue halo + a solid blue dot (the familiar
      // "you are here" marker), drawn above everything so it's never hidden
      // behind a leg polyline while you're riding.
      map.addLayer({
        id: 'me-halo',
        type: 'circle',
        source: 'me',
        paint: {
          'circle-radius': 16,
          'circle-color': '#3b82f6',
          'circle-opacity': 0.2,
          'circle-stroke-color': '#3b82f6',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.4,
        },
      });
      map.addLayer({
        id: 'me-dot',
        type: 'circle',
        source: 'me',
        paint: {
          'circle-radius': 7,
          'circle-color': '#3b82f6',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });

      // Tailwind's preflight zeroes out `.maplibregl-popup-content`'s padding/bg,
      // so set them explicitly via setHTML rather than relying on the default style.
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: 'bingo-popup',
      });
      const escapeHtml = (s) =>
        String(s).replace(
          /[&<>"']/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
        );
      map.on('mouseenter', 'stops-dot', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (!f) return;
        const label = f.properties?.label ?? '';
        // Theme the tooltip to match light/dark (read live via the ref).
        const t = darkRef.current
          ? { bg: '#161b22', fg: '#ffffff', bd: '#30363d' }
          : { bg: '#ffffff', fg: '#0f172a', bd: '#cbd5e1' };
        popup
          .setLngLat(f.geometry.coordinates)
          .setHTML(
            `<div style="background:${t.bg};color:${t.fg};border:1px solid ${t.bd};padding:4px 8px;border-radius:4px;font-size:12px;white-space:nowrap;">${escapeHtml(label)}</div>`,
          )
          .addTo(map);
      });
      map.on('mouseleave', 'stops-dot', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    });
    mapRef.current = map;

    // Keep the canvas sized to its container. Essential for the collapsible
    // mobile map: when the container goes display:none → block again, MapLibre
    // needs a resize() or it renders blank / wrong-sized until the next pan.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Swap the basemap raster tiles when the theme changes (light ↔ dark).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.getSource('basemap')?.setTiles(basemapTiles(dark));
    if (map.getSource('basemap')) apply();
    else map.once('load', apply);
  }, [dark]);

  // Click handler — re-bind whenever the mapClickMode toggles so we don't run when off.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function handler(e) {
      onMapClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    }
    if (mapClickMode) {
      map.getCanvas().style.cursor = 'crosshair';
      map.on('click', handler);
    }
    return () => {
      map.off('click', handler);
      if (mapClickMode) map.getCanvas().style.cursor = '';
    };
  }, [mapClickMode, onMapClick]);

  // Sync plan + start to map sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const empty = { type: 'FeatureCollection', features: [] };
    const apply = () => {
      map.getSource('startpt')?.setData(startGeoJSON(start));
      map.getSource('endpt')?.setData(startGeoJSON(end));
      map.getSource('heatmap')?.setData(heatmap ?? empty);
      map.getSource('overlay')?.setData(overlay ?? empty);
      if (plan) {
        map.getSource('legs')?.setData(legGeoJSON(plan, routes));
        map.getSource('walks')?.setData(walkGeoJSON(plan, end));
        map.getSource('stops')?.setData(stopGeoJSON(plan, routes));

        // Ride mode: zoom to just the current leg's polyline.
        const focus = focusLegIdx != null ? plan.legs[focusLegIdx] : null;
        if (focus) {
          const pts = focus.pattern.points
            .filter((p) => p.seq >= focus.boardStop.seq && p.seq <= focus.alightStop.seq)
            .map((p) => [p.lon, p.lat]);
          if (pts.length >= 2) {
            const b = pts.reduce(
              (acc, p) => acc.extend(p),
              new maplibregl.LngLatBounds(pts[0], pts[0]),
            );
            map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 600 });
          }
        } else {
          // Fit to the whole plan.
          const allPts = [];
          if (start) allPts.push([start.lon, start.lat]);
          if (end) allPts.push([end.lon, end.lat]);
          for (const l of plan.legs) {
            allPts.push([l.boardStop.lon, l.boardStop.lat]);
            allPts.push([l.alightStop.lon, l.alightStop.lat]);
          }
          if (allPts.length >= 2) {
            const bounds = allPts.reduce(
              (acc, p) => acc.extend(p),
              new maplibregl.LngLatBounds(allPts[0], allPts[0]),
            );
            map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
          }
        }
      } else {
        map.getSource('legs')?.setData(empty);
        map.getSource('walks')?.setData(empty);
        map.getSource('stops')?.setData(empty);
        if (start && end) {
          const bounds = new maplibregl.LngLatBounds(
            [start.lon, start.lat],
            [start.lon, start.lat],
          );
          bounds.extend([end.lon, end.lat]);
          map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 600 });
        } else if (start) {
          map.flyTo({ center: [start.lon, start.lat], zoom: 13 });
        } else if (end) {
          map.flyTo({ center: [end.lon, end.lat], zoom: 13 });
        } else if (overlay?.features?.length) {
          // No trip — frame the overlaid routes so intersections are visible.
          const bounds = new maplibregl.LngLatBounds();
          for (const f of overlay.features)
            for (const c of f.geometry.coordinates) bounds.extend(c);
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 600 });
        }
      }
    };
    // Use source existence (not map.loaded()) as the readiness check —
    // map.loaded() returns false while tiles stream in, even after sources
    // are created. And once('load') silently no-ops if load already fired,
    // which is exactly what happens on the auto-plan-from-URL path: the
    // dataset arrives after load, so the first plan-update fires past load
    // and gets stuck waiting for an event that's never coming again.
    if (map.getSource('legs')) apply();
    else map.once('load', apply);
  }, [plan, start, end, routes, heatmap, overlay, focusLegIdx]);

  // Live-location updates on their own effect so a moving GPS dot never triggers
  // the bounds-fitting in the main sync effect (which would make the map jump on
  // every position update while you ride).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.getSource('me')?.setData(pointGeoJSON(me));
    if (map.getSource('me')) apply();
    else map.once('load', apply);
  }, [me]);

  return <div ref={containerRef} className="h-full w-full" />;
}
