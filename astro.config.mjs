import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  site: 'https://oss.cver.net',
  base: '/vectorize',
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
