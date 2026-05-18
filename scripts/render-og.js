// Render public/og.svg -> public/og.png (1200x630, the OG card size socials use).
// Run via `npm run render-og` whenever you change og.svg.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const svgPath = resolve('public/og.svg');
const pngPath = resolve('public/og.png');

const svg = readFileSync(svgPath);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: {
    // Resvg can't fetch web fonts; let the system pick a sans fallback for
    // the Inter stack referenced in og.svg.
    loadSystemFonts: true,
  },
});
const png = resvg.render().asPng();
writeFileSync(pngPath, png);
console.log(`wrote ${pngPath} (${png.length} bytes)`);
