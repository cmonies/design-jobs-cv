import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';
export default defineConfig({
  site: 'https://designjobs.cv',
  output: 'static',
  adapter: vercel(),
  integrations: [tailwind()],
});
