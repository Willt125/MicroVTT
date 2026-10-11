import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Names the single file after the app, so a copy passed around says what it is. */
const singleFileName = (): Plugin => ({
  name: 'microvtt-single-file-name',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const page = bundle['index.html'];
    if (page) page.fileName = 'microvtt.html';
  },
});

/**
 * Two builds. The default one is a folder for a web server. `--mode single` is one HTML file
 * with everything in it (scripts, styles, both workers), to open from disk or pass around.
 */
export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the built app also works when opened from disk or a sub-path.
  base: './',
  plugins: mode === 'single' ? [svelte(), viteSingleFile(), singleFileName()] : [svelte()],
  resolve:
    mode === 'single'
      ? {
          alias: [
            {
              find: /^(.*)\/workers\.ts$/,
              replacement: fileURLToPath(new URL('./src/lib/workers.inline.ts', import.meta.url)),
            },
          ],
        }
      : {},
  build: {
    target: 'es2022',
    ...(mode === 'single' ? { outDir: 'dist-single' } : {}),
  },
  worker: {
    // Classic workers in the single file: a page opened from disk cannot start a module worker
    // from a blob: URL (Chromium refuses it after Vite's fallback could have run).
    format: mode === 'single' ? 'iife' : 'es',
  },
  test: {
    name: 'web',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
}));
