/**
 * The single-file build (`pnpm build:single`), opened from disk: a file:// page has an opaque
 * origin, so the workers have to start from inlined code, and autosave may have no storage.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { cueText, mediaInput, status, vttInput, wav } from './support.ts';

let url = '';

test.beforeAll(async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'microvtt-single-'));
  await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    mode: 'single',
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  });
  url = pathToFileURL(join(outDir, 'microvtt.html')).href;
});

test('works when opened from disk', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);

  // The parsing worker reads and checks the file.
  await vttInput(page).setInputFiles({
    name: 'a.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(
      'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n\n00:02.000 --> 00:01.000\nBad\n',
    ),
  });
  await expect(status(page)).toContainText('a.vtt · 2 cues');
  await expect(page.getByRole('complementary', { name: 'Problems' })).toContainText(
    'The end time must be after the start time.',
  );

  // Autosave either works or says it cannot (a file:// page may have no storage).
  await cueText(page).fill('Edited');
  await expect(status(page)).toContainText(/autosaved|autosave unavailable/, { timeout: 10_000 });
  console.log(`single file autosave: ${await status(page).innerText()}`);

  // The waveform worker decodes media (or says why it cannot, as some WebKit builds do).
  await mediaInput(page).setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav(5) });
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).not.toHaveAttribute('data-waveform', 'loading', { timeout: 15_000 });
  const waveform = await timeline.getAttribute('data-waveform');
  console.log(`single file waveform: ${waveform}`);
  expect(waveform).not.toBe('error');

  expect(errors).toEqual([]);
});
