import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens backed by CSS variables (see src/index.css) so the
        // whole UI re-themes for light/dark by toggling a class on <html>.
        // RGB-triplet form keeps Tailwind's /opacity modifiers working.
        gh: {
          canvas: 'rgb(var(--gh-canvas) / <alpha-value>)',
          subtle: 'rgb(var(--gh-subtle) / <alpha-value>)',
          surface: 'rgb(var(--gh-surface) / <alpha-value>)',
          border: 'rgb(var(--gh-border) / <alpha-value>)',
          muted: 'rgb(var(--gh-muted) / <alpha-value>)',
          fg: 'rgb(var(--gh-fg) / <alpha-value>)',
        },
      },
    },
  },
  // `light:` applies only in light mode (the app is dark by default; see the
  // html.light tokens in index.css). Used to retune dark accent banners.
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('light', 'html.light &');
    }),
  ],
};
