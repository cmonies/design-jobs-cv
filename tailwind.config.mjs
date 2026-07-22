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
        muted: '#706F6A',
        line: '#E8E8E6',
        // Tile treatments — typographic poster grounds
        tile: {
          cream: '#F1F1EF',
          ink: '#1A1917',
          invert: '#ECECEA',
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
        // `brand` = ink neutrals (cosmos monochrome). Crust amber is the LOGO's color only.
        brand: {
          50: '#F5F4F1',
          100: '#EAE8E2',
          200: '#D8D5CD',
          300: '#A3A099',
          400: '#55524B',
          500: '#161512',
          600: '#0C0C0A',
          700: '#0C0C0A',
          800: '#000000',
          900: '#000000',
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
        // gray mirrors slate so nothing cool leaks in — Tailwind's preflight
        // uses gray-400 for ::placeholder, which is a blue-gray by default
        gray: {
          50: '#FAFAF9',
          100: '#F2F2F1',
          200: '#E8E8E6',
          300: '#D6D6D3',
          400: '#A3A099',
          500: '#77746B',
          600: '#55524B',
          700: '#26251F',
          800: '#161613',
          900: '#0C0C0A',
          950: '#000000',
        },
        // Warm grays (light) / cool neutrals (dark) — hairlines warmed
        slate: {
          50: '#FAFAF9',
          100: '#F2F2F1',
          200: '#E8E8E6',
          300: '#D6D6D3',
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
          page: '#11110F',
          header: '#11110F',
          footer: '#0C0C0B',
          card: '#1B1B19',
          newsletter: '#181816',
          'card-hover': '#222120',
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
