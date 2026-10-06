import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the built app also works when opened from disk or a sub-path.
  base: './',
  plugins: [svelte()],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    name: 'web',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
