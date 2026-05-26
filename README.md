# CTA Bus Bingo

Chain together as many CTA bus routes you haven't ridden yet, starting from anywhere in Chicago — optionally ending somewhere specific.

Pick a start (geolocate, address, map click, or stop search), optionally pick a destination, tick off the routes you've already ridden, set a max new-route count, and get an itinerary with map and per-leg times. Trains and already-ridden buses are used as free connectors to stitch new-route legs together, and to bridge to your destination if the chain doesn't quite land there.

## What it does

- **Plan a trip** from any point with up to N new bus routes, optional destination, optional round-trip. Returns up to 3 candidate itineraries, ranked by route count then time.
- **Surprise me** — a random trip from your chosen start, with the map drawing the line from your point to the first boarding stop so you know exactly how far it is.
- **Plan toward my least-covered area** — targets the Chicago community area where you have the most unridden routes (ties broken by nearness to your start). Pairs with the coverage heatmap.
- **Ride mode** — a focused big-text view of the leg you're currently on (route, get-off stop, stops-to-go, scheduled frequency), with the map zoomed to that leg. Persists across reload / PWA relaunch so you don't lose your trip mid-ride.
- **Itinerary timeline** — numbered colored badges connected by a path + arrows, so the bus take-order reads at a glance. Includes a 📋 Share-steps button that emits the trip as plain text via the native share sheet (or clipboard).
- **Bus schedule lookup** — search a route, see today's per-hour frequency (holiday-aware, every-N-min format).
- **Compare routes overlay** — pick any number of buses and see their full shapes on the map (sticky colors that don't reshuffle when you add more) to spot intersections.
- **Achievements** — milestone badges (10/25/50/75/100/all) and per-community-area completions ("rode every route in Pilsen"). Each earned achievement renders a shareable + downloadable PNG card with a progress ring and route-id chips.
- **Coverage heatmap** — colored cells over the map showing where unridden routes cluster.
- **Light/dark theme** with a header toggle (defaults to system preference; map basemap follows along).
- **Fully offline + reload-proof** — service worker precaches app + data; the planned trip and current ride-mode step are snapshotted to `localStorage` so a mid-trip reload, or a PWA relaunch after iOS kills the backgrounded tab, restores the exact itinerary (no re-randomizing).

## Stack

- Vite + React + Tailwind, fully client-side.
- MapLibre + OpenStreetMap tiles (CARTO dark / light basemap, swapped with the theme).
- Pre-baked CTA GTFS index + pattern geometries + Chicago community-area mapping, generated offline.

## Data prep

The static data layer is built offline from CTA's bustime API, the GTFS schedule feed, and the City of Chicago's community-area polygons:

```
CTA_BUS_KEY=... npm run build-index
```

This writes (under `public/data/`):

| File | What it holds |
|---|---|
| `routes.json` | Every route's display name, schedule index (per-hour headways + durations, bucketed by GTFS direction and day-type), and pattern ids. |
| `patterns.json` | Bundled pattern geometries, **slimmed** (5-decimal coords, Douglas–Peucker simplification of waypoint runs between stops; stops + `pdist` preserved). Each bus pattern carries its matched `gtfsDirectionId`. |
| `route-patterns.json` | Route → pattern id map. |
| `neighborhoods.json` | Chicago community area → bus routes serving it (point-in-polygon over the baked stops; build-time fetch of the city's open-data polygons, only the ~10 KB derived mapping ships). |
| `meta.json` | Build / GTFS timestamps + counts. |

Set `CTA_BUS_KEY` in `.env` (see `.env.example`) so you don't have to pass it each time; the GTFS schedule + community-area downloads need no key.

### Schedule-index correctness notes

The GTFS index goes out of its way to produce *typical* per-day-type service, not "what runs the rebuild date":

- Trips are bucketed only when they share the dominant **origin** *and* the dominant **destination** for that `(route, direction)` — short-turn trips that share the dominant origin (e.g., late-night 95th runs to a midpoint) are dropped at the source, instead of pulling the per-hour median way down.
- `calendar_dates.txt` exceptions are *not* applied when bucketing — that prevents a rebuild on a holiday (Memorial Day, etc.) from silently wiping the weekday bucket for the rest of the week.
- Each bus pattern is matched to its GTFS `direction_id` by endpoint stop ids, so the runtime reads headway/duration for the actual ride direction instead of medianing across both. Unmatched patterns fall back to the median.
- Holidays are also handled at the **runtime** level — `dayTypeKey` maps the six CTA Sunday-schedule holidays (New Year's, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas) to the Sunday bucket so weekday-only express routes aren't suggested on a Monday holiday.

### Individual refresh steps

For when you only need to re-bake part of the data:

```
npm run refresh-gtfs         # re-runs the GTFS schedule index + direction tags (no CTA bus key needed)
npm run build-neighborhoods  # re-bakes the community-area → routes mapping
npm run slim-patterns        # re-runs Douglas–Peucker / coord rounding on patterns.json
```

### Automated refresh

`scripts/refresh-schedules.sh` rebuilds the data, runs tests + lint, and commits/pushes `public/data` only if it changed — which triggers the deploy workflow. `cron/crontab.txt` has the ready-to-install weekly entry plus a safe-append one-liner (so it won't clobber other cron jobs).

## Dev

```
npm install
npm run build-index   # one-time, or whenever you want fresh patterns
npm run dev
```

Lint: `npm run lint` · Tests: `npm test` · Smoke planner: `node scripts/smoke-plan.js`

> Note: changing `tailwind.config.js` (colors, plugins) requires restarting `npm run dev` — Vite's hot reload doesn't always reapply the regenerated Tailwind CSS. The same applies after `npm run refresh-gtfs` for the in-page schedule lookup; a hard reload picks up the new `routes.json`.

## What "ridden" means here

A simple checklist stored in `localStorage`. Click a route to toggle. Export/import the JSON to back it up, or turn on **device sync** (below) to keep it in step across your phone and computer automatically.

The ridden set feeds **Achievements**: milestone badges for ridden-route counts (10/25/50/75/100/all), and per-community-area completions ("rode every route in Lincoln Park"). Earned badges produce a 1080×1080 PNG card (progress ring + sampled route-id chips) that you can share via the native share sheet or download directly.

## Sync across devices

Optional. Keeps the ridden-routes set converged across devices with no account — set it up on one device, scan a QR (or open the pairing link) on the others, and from then on they stay in sync.

How it works:

- The ridden set is stored as an **LWW-Map** (last-writer-wins per route) in `src/lib/syncDoc.js` — `{ routes: { [rt]: { r, t } } }`, where un-marking a route leaves a tombstone (`r:0`) so removals propagate instead of getting resurrected on merge. The merge is a convergent CRDT join (commutative/associative/idempotent), so devices converge with no locking.
- A tiny **Cloudflare Worker + KV** (`worker/`) is a dumb blob store: `GET`/`PUT` one JSON doc per random key. The client owns the merge (`src/lib/sync.js`: `GET → merge → PUT`, single-flight + debounced, re-syncing on load / tab focus / a slow poll).
- The **sync key** is an unguessable 128-bit bearer capability addressing exactly one document — no auth. It lives in localStorage and travels via the QR's `#sync=<key>` deep link. Back it up (shown in the Sync panel) to add or recover devices.

### Deploying the worker

Requires a free Cloudflare account. The worker is its own package under `worker/` (wrangler lives there, not in the site's deps, so it's not installed on every site CI run). One-time, from the repo root:

```
npm --prefix worker install
cd worker
npx wrangler login                     # browser OAuth
npx wrangler kv namespace create SYNC  # paste the printed id into wrangler.toml under [[kv_namespaces]]
npx wrangler deploy                    # first deploy registers a *.workers.dev subdomain
```

Then point the app at it: set `VITE_SYNC_URL` to the deployed `https://<worker>.<subdomain>.workers.dev` URL in `.env` for local dev (see `.env.example`), and in `.github/workflows/deploy.yml`'s build step for the deployed site (it's not a secret — it's baked into the public bundle). The Sync panel only appears when `VITE_SYNC_URL` is set. CORS in `worker/src/index.js` is locked to the GitHub Pages origin plus `localhost`; update `ALLOWED_ORIGINS` if you deploy elsewhere.

## Social card

`public/og.svg` is the source for the social-share image. Re-render to `public/og.png` after editing:

```
npm run render-og
```

`index.html` references `/og.png` for OG / Twitter cards.
