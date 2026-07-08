/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Gallery canvas + warm ink (cosmos-style: white ground, content carries color)
        paper: '#FFFFFF',
        ink: {
          DEFAULT: '#161512',
          soft: '#3C3A34',
        },
        muted: '#77746B',
        line: '#EAE8E2',
        // Tile treatments — typographic poster grounds
        tile: {
          cream: '#F1EFE8',
          olive: '#575A45',
          ink: '#1A1917',
          invert: '#EDEBE4',
        },
        // Crust amber — the single accent. Semantic: contract roles + brand mark.
        crust: {
          50: '#FBF3E9',
          100: '#F6E4CE',
          200: '#ECC89D',
          300: '#E0A96A',
          400: '#D18C43',
          500: '#C0722A',
          600: '#A05C1F',
          700: '#7E4718',
          800: '#5C3312',
          900: '#3B200B',
        },
        // `brand` remapped to crust so untouched pages inherit the new palette
        brand: {
          50: '#FBF3E9',
          100: '#F6E4CE',
          200: '#ECC89D',
          300: '#E0A96A',
          400: '#D18C43',
          500: '#C0722A',
          600: '#A05C1F',
          700: '#7E4718',
          800: '#5C3312',
          900: '#3B200B',
        },
        // Legacy alias: pages still using warm-50 as page bg now get pure white
        warm: {
          50: '#FFFFFF',
          100: '#F6E4CE',
          200: '#ECC89D',
          300: '#E0A96A',
          400: '#D18C43',
          500: '#C0722A',
        },
        // Warm grays (light) / cool neutrals (dark) — hairlines warmed
        slate: {
          50: '#FAFAF9',
          100: '#F1F0EC',
          200: '#EAE8E2',
          300: '#D8D5CD',
          400: '#A3A099',
          500: '#77746B',
          600: '#55524B',
          700: '#26251F',
          800: '#161613',
          900: '#0C0C0A',
          950: '#000000',
        },
        // Dark mode surfaces
        surface: {
          page: '#111110',
          header: '#111110',
          footer: '#0C0C0B',
          card: '#181816',
          newsletter: '#181816',
          'card-hover': '#1F1E1A',
        },
      },
      fontFamily: {
        sans: ['Be Vietnam Pro', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Be Vietnam Pro', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgba(22, 21, 18, 0.04), 0 1px 2px -1px rgba(22, 21, 18, 0.03)',
        'soft-md': '0 4px 6px -1px rgba(22, 21, 18, 0.05), 0 2px 4px -2px rgba(22, 21, 18, 0.03)',
        'soft-lg': '0 10px 15px -3px rgba(22, 21, 18, 0.05), 0 4px 6px -4px rgba(22, 21, 18, 0.03)',
        'warm': '0 2px 8px 0 rgba(120, 113, 108, 0.08)',
        'warm-lg': '0 8px 24px 0 rgba(120, 113, 108, 0.1)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
