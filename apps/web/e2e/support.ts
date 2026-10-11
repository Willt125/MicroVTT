/** Shared helpers for the end-to-end tests. */
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

const FIXTURES = new URL('../../../packages/core/test/fixtures/', import.meta.url);

/** The committed synthetic auto-caption fixture (11 cues, about 15 s). */
export const SAMPLE = {
  name: 'autocaption-sample.vtt',
  mimeType: 'text/vtt',
  buffer: readFileSync(new URL('autocaption-sample.vtt', FIXTURES)),
};
export const SAMPLE_CUES = 11;

/** A mono 16-bit PCM WAV of a quiet tone, made in memory so no media file is committed. */
export function wav(seconds: number, sampleRate = 16_000): Buffer {
  const samples = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
      44 + i * 2,
    );
  return buffer;
}

export const vttInput = (page: Page): Locator => page.locator('input[type="file"][accept*=".vtt"]');
export const mediaInput = (page: Page): Locator => page.locator('input[accept="audio/*,video/*"]');
export const cueList = (page: Page): Locator => page.getByRole('listbox', { name: 'Cues' });
export const rows = (page: Page): Locator => cueList(page).getByRole('option');
export const selectedRow = (page: Page): Locator =>
  page.locator('[role=option][aria-selected=true]');
export const cueText = (page: Page): Locator => page.locator('#cue-text');
export const status = (page: Page): Locator => page.locator('header .status');

/** The number of errors the Problems panel reports, once validation has settled. */
export async function errorCount(page: Page): Promise<number> {
  const summary = page.locator('.summary');
  await expect(summary).not.toContainText('Checking');
  const text = await summary.innerText();
  return Number(/(\d+) errors/.exec(text)?.[1] ?? 0);
}

/** Opens the sample through the file input and waits for the table. */
export async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles(SAMPLE);
  await expect(status(page)).toContainText(`${SAMPLE_CUES} cues`);
}

/** The selected row's number, times and text, as shown. */
export async function selectedCells(
  page: Page,
): Promise<{ num: string; start: string; end: string; text: string }> {
  const row = selectedRow(page);
  const [start, end] = await row.locator('.time').allInnerTexts();
  return {
    num: await row.locator('.num').innerText(),
    start: start ?? '',
    end: end ?? '',
    text: await row.locator('.text').innerText(),
  };
}

/** The media element's current time in milliseconds. */
export const mediaTime = (page: Page): Promise<number> =>
  page.locator('video').evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 1000));
