/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gh: {
          canvas: '#0d1117',
          subtle: '#21262d',
          surface: '#161b22',
          border: '#30363d',
          muted: '#8b949e',
        },
      },
    },
  },
  plugins: [],
};
