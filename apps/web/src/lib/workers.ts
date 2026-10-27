/**
 * Where the app's workers come from. The normal build loads each from its own file; the
 * single-file build (vite.config.ts, mode "single") swaps this module for workers.inline.ts,
 * which builds them into the page, as a page opened from disk cannot load worker files.
 */

/** The document worker: import, validation, export. */
export const createVttWorker = (): Worker =>
  new Worker(new URL('./worker/vtt.worker.ts', import.meta.url), { type: 'module' });

/** The media worker: decodes the media and reduces it to peaks; also finds shot changes. */
export const createWaveformWorker = (): Worker =>
  new Worker(new URL('./waveform/waveform.worker.ts', import.meta.url), { type: 'module' });
