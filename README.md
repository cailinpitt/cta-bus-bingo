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

This writes `public/data/{routes.json, route-patterns.json, patterns/*.json}`. After it runs, the app is fully offline / static.

## Dev

```
npm install
npm run build-index   # one-time, or whenever you want fresh patterns
npm run dev
```

Lint: `npm run lint` · Tests: `npm test` · Smoke planner: `node scripts/smoke-plan.js`

## What "ridden" means here

A simple checklist in localStorage. Click a route to toggle. Export/import the JSON to back it up across browsers.

## Social card

`public/og.svg` is the source for the social-share image. Re-render to `public/og.png` after editing:

```
npm run render-og
```

`index.html` references `/og.png` for OG / Twitter cards.
