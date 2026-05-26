import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Project page at <user>.github.io/cta-bus-bingo/ in production; root in dev
// so the local server is still served from `/`.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + the useRegisterSW hook in UpdateToast.jsx surfaces a visible
      // "Reload" instead of updating silently (which on iOS PWAs required a
      // force-quit to notice). injectRegister:false so the hook is the sole
      // registrant (no duplicate auto-injected registration).
      registerType: 'prompt',
      injectRegister: false,
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
        // Precache the app shell AND the baked data JSON so the app works fully
        // offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
        // The bundled patterns.json is a few MB; bump the precache ceiling so it
        // gets included rather than silently skipped.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // Per-pattern files under data/patterns/ are legacy — runtime only
        // fetches the bundled data/patterns.json. Skip them so the install
        // doesn't ship megabytes of duplicate data.
        globIgnores: ['**/data/patterns/**'],
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
