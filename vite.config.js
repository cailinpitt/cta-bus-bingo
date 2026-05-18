import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Project page at <user>.github.io/cta-bus-bingo/ in production; root in dev
// so the local server is still served from `/`.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/cta-bus-bingo/' : '/',
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
