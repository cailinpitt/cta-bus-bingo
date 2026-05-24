# CTA Bus Bingo

Chain together as many CTA bus routes you haven't ridden yet, starting from anywhere in Chicago — optionally ending somewhere specific.

Pick a start (geolocate, address, map click, or stop search), optionally pick a destination, tick off the routes you've already ridden, set a max new-route count, and get an itinerary with map and per-leg times. Trains and already-ridden buses are used as free connectors to stitch new-route legs together, and to bridge to your destination if the chain doesn't quite land there.

## Stack

- Vite + React + Tailwind, fully client-side.
- MapLibre + OpenStreetMap tiles (CARTO dark basemap).
- Pre-baked CTA GTFS index + pattern geometries, generated offline.

## Data prep

The data layer is built offline from CTA's bustime API and the GTFS schedule feed:

```
CTA_BUS_KEY=... npm run build-index
```

This writes `public/data/{routes.json, route-patterns.json, patterns/*.json}`. After it runs, the app is fully offline / static. Set `CTA_BUS_KEY` in `.env` (see `.env.example`) so you don't have to pass it each time; the GTFS schedule download itself needs no key.

### Automated refresh

`scripts/refresh-schedules.sh` rebuilds the data, runs tests + lint, and commits/pushes `public/data` only if it changed — which triggers the deploy workflow. `cron/crontab.txt` has the ready-to-install weekly entry plus a safe-append one-liner (so it won't clobber other cron jobs).

## Dev

```
npm install
npm run build-index   # one-time, or whenever you want fresh patterns
npm run dev
```

Lint: `npm run lint` · Tests: `npm test` · Smoke planner: `node scripts/smoke-plan.js`

## What "ridden" means here

A simple checklist stored in localStorage. Click a route to toggle. Export/import the JSON to back it up, or turn on **device sync** (below) to keep it in step across your phone and computer automatically.

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
