/** The timeline: waveform peaks from the worker, cue blocks, seeking and selecting. */
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mediaInput, mediaTime, openSample, selectedCells, vttInput, wav } from './support.ts';

const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

async function openMedia(page: Page, name = 'tone.wav'): Promise<void> {
  await mediaInput(page).setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(20) });
}

/** Fraction of the waveform band's pixels that are not the background colour. */
async function inkedFraction(page: Page): Promise<number> {
  return page.locator('.timeline canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const y = Math.round(canvas.height * 0.45);
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    // The background, from the top-right corner of the ruler.
    const bg = ctx.getImageData(canvas.width - 2, 2, 1, 1).data;
    let inked = 0;
    for (let i = 0; i < row.length; i += 4) {
      if (Math.abs((row[i] as number) - (bg[0] as number)) > 24) inked++;
    }
    return inked / (row.length / 4);
  });
}

test.beforeEach(async ({ page }) => {
  await openSample(page);
  await openMedia(page);
});

test('draws the waveform of the loaded media', async ({ page }) => {
  await expect(timeline(page)).toHaveAttribute('data-waveform', 'ready', { timeout: 15_000 });
  await expect(timeline(page)).toHaveAttribute('data-method', 'stream');
  // The tone fills the band from 0 to 20 s; the default view shows 30 s.
  await expect.poll(() => inkedFraction(page)).toBeGreaterThan(0.4);
});

// A persistent profile: Playwright's default (ephemeral) context has no origin-private file
// system in WebKit (like a private window), so the peaks would only be kept in memory there.
test('reuses the peaks when the same file is opened again', async ({
  playwright,
  browserName,
  baseURL,
}, testInfo) => {
  const context = await playwright[browserName].launchPersistentContext(
    testInfo.outputPath('profile'),
    { ...testInfo.project.use.launchOptions, ...(baseURL ? { baseURL } : {}) },
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    // A file on disk keeps its modification time (an in-memory upload gets a new one each
    // time), which, with its name and size, identifies it in the cache.
    const path = testInfo.outputPath('same.wav');
    writeFileSync(path, wav(20));
    await openSample(page);
    await mediaInput(page).setInputFiles(path);
    await expect(timeline(page)).toHaveAttribute('data-waveform', 'ready', { timeout: 15_000 });
    await expect(timeline(page)).toHaveAttribute('data-method', 'stream');
    await expect(timeline(page)).toHaveAttribute('data-where', 'opfs');
    await page.reload();
    await openSample(page);
    await mediaInput(page).setInputFiles(path);
    await expect(timeline(page)).toHaveAttribute('data-waveform', 'ready', { timeout: 15_000 });
    await expect(timeline(page)).toHaveAttribute('data-method', 'cache');
  } finally {
    await context.close();
  }
});

/** The page x of a time on the timeline, from the view it reports. */
async function xOf(page: Page, ms: number): Promise<number> {
  const box = (await page.locator('.timeline canvas').boundingBox()) as { x: number };
  const startMs = Number(await timeline(page).getAttribute('data-start-ms'));
  const msPerPx = Number(await timeline(page).getAttribute('data-ms-per-px'));
  return box.x + 1 + (ms - startMs) / msPerPx;
}

test('selects a cue clicked in the lane, and seeks where clicked', async ({ page }) => {
  const box = (await page.locator('.timeline canvas').boundingBox()) as {
    y: number;
    height: number;
  };
  // The third sample cue runs from 3.08 s to 5.53 s.
  await page.mouse.click(await xOf(page, 4300), box.y + box.height - 8);
  expect((await selectedCells(page)).num).toBe('3');
  await page.mouse.click(await xOf(page, 12_000), box.y + box.height * 0.4);
  // Within a few pixels (ms per pixel is about 15 here).
  await expect.poll(() => mediaTime(page)).toBeCloseTo(12_000, -2);
});

test('zooms with the buttons', async ({ page }) => {
  const before = await inkedFraction(page);
  await timeline(page).getByRole('button', { name: 'Whole file' }).click();
  await timeline(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => inkedFraction(page)).not.toBe(before);
});

test('streams compressed audio (Opus) where the browser can decode it', async ({
  page,
  browserName,
}) => {
  await mediaInput(page).setInputFiles(new URL('./media/tone-opus.webm', import.meta.url).pathname);
  await expect(timeline(page)).not.toHaveAttribute('data-waveform', 'loading', { timeout: 15_000 });
  const state = await timeline(page).getAttribute('data-waveform');
  const method = await timeline(page).getAttribute('data-method');
  if (browserName === 'webkit') {
    // WebKit builds without WebCodecs Opus fall back (or explain why there is no waveform).
    expect(['ready', 'unavailable']).toContain(state);
  } else {
    expect([state, method]).toEqual(['ready', 'stream']);
    await expect.poll(() => inkedFraction(page)).toBeGreaterThan(0.1);
  }
});

test('fits the whole media once its duration is known, even when that comes late', async ({
  page,
}) => {
  // Hold back the media's metadata, as a slow browser or a large file may: the first view is
  // then laid out before the media's length is known.
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'loadedmetadata' && this instanceof HTMLMediaElement && listener) {
        const late = (event: Event): void => {
          setTimeout(() => {
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
          }, 1500);
        };
        return add.call(this, type, late, options);
      }
      return add.call(this, type, listener, options);
    };
  });
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'short.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from('WEBVTT\n\n00:01.000 --> 00:03.000\none\n\n00:09.000 --> 00:11.000\ntwo\n'),
  });
  await mediaInput(page).setInputFiles({
    name: 'long.wav',
    mimeType: 'audio/wav',
    buffer: wav(40),
  });
  await expect(timeline(page)).toHaveAttribute('data-waveform', 'ready', { timeout: 15_000 });
  const width = (await page.locator('.timeline canvas').boundingBox())?.width ?? 0;
  // The default view is 30 s: shown whole, not cut to the 11 s the cues reach.
  await expect
    .poll(async () => Number(await timeline(page).getAttribute('data-ms-per-px')) * width)
    .toBeGreaterThan(29_000);
});
