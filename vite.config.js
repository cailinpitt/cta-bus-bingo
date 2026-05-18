import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Project page at <user>.github.io/cta-bus-bingo/ in production; root in dev
// so the local server is still served from `/`.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon-32.png',
        'favicon-48.png',
        'apple-touch-icon.png',
        'icon.svg',
        'og.png',
      ],
      manifest: {
        name: 'CTA Bus Bingo',
        short_name: 'Bus Bingo',
        description:
          'Plan a Chicago trip that chains together as many unridden CTA bus routes as possible.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        start_url: command === 'build' ? '/cta-bus-bingo/' : '/',
        scope: command === 'build' ? '/cta-bus-bingo/' : '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The bundled patterns.json is ~6 MB before gzip; bump the precache
        // ceiling so it gets included rather than silently skipped.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // CARTO basemap tiles — cache successful responses so the map keeps
        // working offline once the user has panned around. NetworkFirst with
        // a fallback to cache means online users always get fresh tiles.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('basemaps.cartocdn.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'nominatim.openstreetmap.org',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'geocode',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  base: command === 'build' ? '/cta-bus-bingo/' : '/',
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
