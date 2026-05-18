// Render public/og.svg -> public/og.png (1200x630, the OG card size socials use).
// Substitutes {{BUS_MORE}} (bus routes minus the three shown as sample badges)
// from public/data/meta.json so the card stays accurate after build-index runs.
// Run via `npm run render-og` whenever you change og.svg or the data.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const SAMPLE_BADGES = 3; // count of route badges hardcoded in og.svg

const svgPath = resolve('public/og.svg');
const pngPath = resolve('public/og.png');
const metaPath = resolve('public/data/meta.json');

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const busRouteCount = meta.routeCount - (meta.trainLineCount ?? 0);
const busMore = Math.max(0, busRouteCount - SAMPLE_BADGES);

const svg = readFileSync(svgPath, 'utf8').replace(/\{\{BUS_MORE\}\}/g, String(busMore));

const resvg = new Resvg(Buffer.from(svg), {
  fitTo: { mode: 'width', value: 1200 },
  font: {
    // Resvg can't fetch web fonts; let the system pick a sans fallback for
    // the Inter stack referenced in og.svg.
    loadSystemFonts: true,
  },
});
const png = resvg.render().asPng();
writeFileSync(pngPath, png);
console.log(`wrote ${pngPath} (${png.length} bytes, "+ ${busMore} more")`);
