import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  site: 'https://vectorize.cver.net',
  integrations: [svelte()],
  vite: {
    plugins: [wasm()],
    optimizeDeps: {
      exclude: ['wasm_vtracer'],
    },
    worker: {
      format: 'es',
      plugins: () => [wasm()],
    },
  },
});
