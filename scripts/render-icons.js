// Render public/icon.svg to all the favicon/PWA sizes the app references.
// Run via `npm run render-icons` whenever you change icon.svg.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const SRC = readFileSync(resolve('public/icon.svg'));

function renderPng(size, outPath) {
  const resvg = new Resvg(SRC, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  writeFileSync(resolve(outPath), png);
  console.log(`wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
}

// Standard browser favicon sizes
renderPng(32, 'public/favicon-32.png');
renderPng(48, 'public/favicon-48.png');

// iOS home-screen icon
renderPng(180, 'public/apple-touch-icon.png');

// PWA manifest icons
renderPng(192, 'public/icon-192.png');
renderPng(512, 'public/icon-512.png');
