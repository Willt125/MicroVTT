import { expect, test, type Page } from '@playwright/test';
import {
  SAMPLE_CUES,
  cueList,
  mediaInput,
  mediaTime,
  openSample,
  rows,
  selectedCells,
  status,
  wav,
} from './support.ts';

async function openWithMedia(page: Page): Promise<void> {
  await openSample(page);
  await mediaInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav(20),
  });
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4, { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => openWithMedia(page));

test('shows the document as captions', async ({ page }) => {
  await expect
    .poll(() =>
      page.locator('video').evaluate((v: HTMLVideoElement) => {
        const t = v.textTracks[0];
        return t ? `${t.mode}/${t.cues?.length ?? 0}` : 'none';
      }),
    )
    .toBe(`showing/${SAMPLE_CUES}`);
});

test('seeks to the cue you select', async ({ page }) => {
  await rows(page).nth(2).click();
  expect((await selectedCells(page)).start).toBe('00:00:03.080');
  await expect.poll(() => mediaTime(page)).toBe(3080);
});

test('plays from the keyboard, and the list follows playback', async ({ page }) => {
  await cueList(page).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect.poll(async () => Number((await selectedCells(page)).num)).toBeGreaterThan(2);
  await page.keyboard.press('k');
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
});

test('loops the selected cue', async ({ page }) => {
  await rows(page).nth(2).click(); // 3.08–5.53 s
  await cueList(page).focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await page.waitForTimeout(3500);
  const t = await mediaTime(page);
  expect(t).toBeGreaterThanOrEqual(3080 - 250);
  expect(t).toBeLessThan(5530 + 250);
  expect((await selectedCells(page)).num).toBe('3');
  await page.keyboard.press('Space');
});

test('sets times at the playhead and adds a cue there', async ({ page }) => {
  await rows(page).nth(2).click();
  await cueList(page).focus();
  await page.keyboard.press('l'); // +1 s
  await expect.poll(() => mediaTime(page)).toBe(4080);
  await page.keyboard.press(']');
  expect((await selectedCells(page)).end).toBe('00:00:04.080');
  await page.keyboard.press('Shift+L'); // +5 s
  await page.keyboard.press('n');
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 1} cues`);
  expect(await selectedCells(page)).toMatchObject({ start: '00:00:09.080', end: '00:00:11.080' });
});
