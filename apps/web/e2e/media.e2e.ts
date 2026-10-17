import { expect, test, type Page } from '@playwright/test';
import {
  SAMPLE_CUES,
  cueList,
  cueText,
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
  // Metadata is all the editor needs (WebKit stays below HAVE_ENOUGH_DATA with preload=metadata).
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);
}

test.beforeEach(async ({ page }) => openWithMedia(page));

test('draws the captions with the spec renderer', async ({ page }) => {
  await rows(page).nth(2).click(); // 3.08–5.53 s
  const captions = page.getByTestId('spec-captions');
  await expect(captions.locator('.vtt-cue')).toHaveCount(1);
  await expect(captions).toContainText('Welcome back to the workshop. Today we');
  await expect(captions).toContainText('bench from A&B lumber.');
  // Text after the playhead is in the future (::cue(:future)).
  await expect(captions.locator('.vtt-future').first()).toBeAttached();
  // The browser draws none.
  expect(
    await page
      .locator('video')
      .evaluate((v: HTMLVideoElement) => [...v.textTracks].some((t) => t.mode === 'showing')),
  ).toBe(false);
});

test('updates the spec renderer as you edit, with the default colour classes', async ({ page }) => {
  await rows(page).nth(2).click();
  await cueText(page).fill('<c.red.yellow.bg_blue>Edited</c>');
  const node = page.getByTestId('spec-captions').locator('c');
  await expect(node).toHaveText('Edited');
  // The later class wins (§5); both are presentational hints.
  await expect(node).toHaveCSS('color', 'rgb(255, 255, 0)');
  await expect(node).toHaveCSS('background-color', 'rgb(0, 0, 255)');
});

test('shows the document with the browser’s renderer instead', async ({ page }) => {
  await page.getByLabel('Caption renderer').selectOption('browser');
  await expect(page.getByTestId('spec-captions')).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('video').evaluate((v: HTMLVideoElement) => {
        const t = v.textTracks[0];
        return t ? `${t.mode}/${t.cues?.length ?? 0}` : 'none';
      }),
    )
    .toBe(`showing/${SAMPLE_CUES}`);
  // The choice is kept.
  await page.reload();
  await openWithMedia(page);
  await expect(page.getByLabel('Caption renderer')).toHaveValue('browser');
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

test('Space plays after a button, checkbox or section was clicked, not pressing it again', async ({
  page,
}) => {
  const video = page.locator('video');
  await page.getByRole('button', { name: 'Add cue' }).click();
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 1} cues`);
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', false);
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', true);
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 1} cues`);

  const loop = page.getByLabel('Loop cue');
  await loop.click();
  await expect(loop).toBeChecked();
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', false);
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', true);
  await expect(loop).toBeChecked();

  const settings = page.locator('details.settings');
  await settings.locator('summary').click();
  await expect(settings).toHaveJSProperty('open', true);
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', false);
  await page.keyboard.press('Space');
  await expect(settings).toHaveJSProperty('open', true);

  // From the keyboard, a button keeps focus and Space presses it, as usual.
  const add = page.getByRole('button', { name: 'Add cue' });
  await add.focus();
  await page.keyboard.press('Space');
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 2} cues`);
  await expect(add).toBeFocused();
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
